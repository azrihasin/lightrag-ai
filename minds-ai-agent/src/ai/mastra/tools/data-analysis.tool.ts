import { Injectable, Inject } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { sql as drizzleSql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../../database/database.module';
import { DuckdbService, type DuckdbRunScope } from '../../../duckdb/duckdb.service';
import { FileStoreService, readerExpression } from '../../../files/file-store.service';
import { DataAnalysisAgentService } from '../agents/data-analysis.agent';
import { dataAnalysisRunStore, type DataAnalysisRunContext } from '../agents/data-analysis-run.store';
import { validateReadOnlySql } from '../../../analytics/agents/validate-sql.agent';
import { currentRun } from '../../../analytics/analytics-run.store';

const outputSchema = z.object({
  answer: z.string(),
  rowCount: z.number(),
  sql: z.string(),
});

/** Preview shown to the interpreter agent so it knows the shape of table `t`. */
interface LoadedTable {
  label: string;
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

/** JSON-safe coercion for values DuckDB / JSON.stringify can't handle raw (bigint, Date, Buffer). */
function toJsonSafe(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}

/**
 * Tool exposed directly on analyticsMaster (not a subagent). A general
 * "code interpreter" over a dataset the user supplied: an uploaded file
 * (`fileId`), pasted JSON (registered as an inline dataset → also a `fileId`),
 * or the result set of a read-only MariaDB SELECT (`sql`). It loads that data
 * into a fresh DuckDB scratch table `t`, lets DataAnalysisAgentService iterate
 * SQL against it, then publishes the final table + chart onto the same
 * analyticsRunStore blackboard the MariaDB pipeline uses — so ChatService's
 * existing emitRender renders it identically, with no separate streaming path.
 */
@Injectable()
export class DataAnalysisTool {
  constructor(
    @InjectPinoLogger(DataAnalysisTool.name) private readonly logger: PinoLogger,
    @Inject(DRIZZLE) private readonly db: MySql2Database,
    private readonly duckdb: DuckdbService,
    private readonly fileStore: FileStoreService,
    private readonly dataAnalysisAgent: DataAnalysisAgentService,
  ) {}

  asTool() {
    return createTool({
      id: 'analyze_data',
      description:
        'Run iterative "code interpreter" analysis over a dataset the user supplied — inspect, clean, ' +
        'filter, group, aggregate, compute statistics — and return a table plus (when useful) a chart. ' +
        'Use this whenever the user provides their own data to analyze, from ANY of these sources: ' +
        '(1) an uploaded file (CSV/JSON/XLSX/Parquet) — pass its fileId; ' +
        '(2) raw JSON they pasted into the chat (registered as an inline dataset with a fileId — pass that fileId); ' +
        '(3) a read-only MariaDB SELECT whose result set they want analyzed further — pass that SELECT as sql. ' +
        'Provide EXACTLY ONE of fileId or sql. Do NOT use the normal database SQL subagent pipeline for these.',
      inputSchema: z.object({
        question: z.string().describe("The user's full analysis question, in natural language"),
        fileId: z
          .string()
          .optional()
          .describe('fileId of an uploaded file OR an inline dataset registered from pasted JSON'),
        sql: z
          .string()
          .optional()
          .describe('A read-only MariaDB SELECT whose result set becomes the dataset to analyze'),
      }),
      outputSchema,
      execute: async (input: { question: string; fileId?: string; sql?: string }) => {
        this.logger.info(
          { fileId: input.fileId, hasSql: Boolean(input.sql), question: input.question },
          'analyze_data invoked',
        );

        const scope = await this.duckdb.createScope();
        try {
          let loaded: LoadedTable;
          let sourceKind: 'file' | 'json' | 'sql';
          try {
            if (input.sql?.trim()) {
              loaded = await this.loadFromSql(scope, input.sql);
              sourceKind = 'sql';
            } else if (input.fileId) {
              const res = await this.loadFromFile(scope, input.fileId);
              loaded = res.loaded;
              sourceKind = res.sourceKind;
            } else {
              return {
                answer: 'No dataset was provided. Supply either a fileId (uploaded file or pasted JSON) or a read-only SQL query.',
                rowCount: 0,
                sql: '',
              };
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load the dataset.';
            return { answer: message, rowCount: 0, sql: '' };
          }

          if (loaded.rowCount === 0) {
            return { answer: `The dataset (${loaded.label}) is empty — there is nothing to analyze.`, rowCount: 0, sql: '' };
          }

          const dataRun: DataAnalysisRunContext = { table: 't', scope, iterations: 0 };

          const prompt = [
            `Dataset: ${loaded.label} (${loaded.rowCount} rows)`,
            `Columns: ${loaded.columns.map((c) => `${c.name} (${c.type})`).join(', ')}`,
            `Sample rows: ${JSON.stringify(loaded.sampleRows.slice(0, 5))}`,
            '',
            `Question: ${input.question}`,
          ].join('\n');

          await dataAnalysisRunStore.run(dataRun, async () => {
            await this.dataAnalysisAgent.agent.generate(prompt, { maxSteps: 12 });
          });

          const final = dataRun.final;
          if (!final) {
            return { answer: 'The analysis did not produce a final result.', rowCount: 0, sql: '' };
          }

          // Publish onto the master's blackboard so ChatService's existing
          // emitRender() renders the table/chart exactly like a SQL turn.
          const masterRun = currentRun();
          if (masterRun) {
            masterRun.sql = final.sql;
            masterRun.columns = final.columns;
            masterRun.rows = final.rows;
            masterRun.rowCount = final.rowCount;
            masterRun.spec = final.spec;
            masterRun.interpreterSource = sourceKind;
          }

          return { answer: final.answer, rowCount: final.rowCount, sql: final.sql };
        } finally {
          await scope.dispose();
        }
      },
    });
  }

  /** Load an uploaded file / inline dataset into table `t` and describe it. */
  private async loadFromFile(
    scope: DuckdbRunScope,
    fileId: string,
  ): Promise<{ loaded: LoadedTable; sourceKind: 'file' | 'json' }> {
    const record = this.fileStore.get(fileId);
    if (!record) {
      throw new Error(`No dataset found for fileId ${fileId}. Ask the user to re-upload or re-paste it.`);
    }
    await scope.run(`CREATE TABLE t AS SELECT * FROM ${readerExpression(record)}`);
    return {
      loaded: {
        label: record.originalName,
        columns: record.preview.columns,
        rowCount: record.preview.rowCount,
        sampleRows: record.preview.sampleRows,
      },
      // Inline JSON pasted in chat is stored as a synthesized .json upload; the
      // store marks these with a `pasted-` name prefix (see FileStoreService).
      sourceKind: record.originalName.startsWith('pasted-') ? 'json' : 'file',
    };
  }

  /** Run a read-only MariaDB SELECT, materialize its rows into `t`, and describe it. */
  private async loadFromSql(scope: DuckdbRunScope, rawSql: string): Promise<LoadedTable> {
    const safety = validateReadOnlySql(rawSql);
    if (!safety.valid) throw new Error(safety.reason ?? 'The provided SQL is not a read-only query.');

    const [raw] = await this.db.execute(drizzleSql.raw(rawSql));
    const rows = (Array.isArray(raw) ? raw : []).map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) out[k] = toJsonSafe(v);
      return out;
    });

    await this.materializeRows(scope, rows);
    const columns =
      rows.length > 0 ? Object.keys(rows[0]).map((name) => ({ name, type: typeof rows[0][name] })) : [];
    return { label: 'SQL result set', columns, rowCount: rows.length, sampleRows: rows.slice(0, 20) };
  }

  /**
   * Materialize JS rows into DuckDB table `t` by writing a scratch JSON file and
   * loading it with read_json_auto (robust type inference for arbitrary shapes).
   * The file is read fully during CREATE TABLE AS, so it is deleted right after.
   */
  private async materializeRows(scope: DuckdbRunScope, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) {
      await scope.run('CREATE TABLE t (placeholder INTEGER)');
      return;
    }
    const dir = path.join(os.tmpdir(), 'minds-analysis');
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${randomUUID()}.json`);
    await fs.writeFile(tmp, JSON.stringify(rows));
    try {
      const lit = `'${tmp.replace(/\\/g, '/').replace(/'/g, "''")}'`;
      await scope.run(`CREATE TABLE t AS SELECT * FROM read_json_auto(${lit})`);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }
}
