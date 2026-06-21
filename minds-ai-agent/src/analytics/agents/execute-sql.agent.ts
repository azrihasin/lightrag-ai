import { Injectable, Inject } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql as drizzleSql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../database/database.module';
import { ModelProvider } from '../../chat/providers/model.provider';
import { DuckdbService } from '../../duckdb/duckdb.service';
import { currentRun } from '../analytics-run.store';
import type { AnalyticsRunContext } from '../analytics.types';
import { DatasetIngestService } from '../profile/dataset-ingest.service';
import { ResultProfilerService } from '../profile/result-profiler.service';
import { SafeInsightsService } from '../profile/safe-insights.service';
import { validateReadOnlySql } from './validate-sql.agent';

/**
 * Hard cap on how many times run_sql may execute in a single turn. The master
 * agent retries the recover loop (retrieve_context → generate_sql → validate_sql
 * → execute_sql) when a query fails; without a deterministic ceiling a query that
 * keeps failing would spin that loop indefinitely and waste tokens. After this
 * many attempts run_sql refuses to run again and tells the agent to stop.
 */
const MAX_EXECUTE_ATTEMPTS = 2;

/**
 * Subagent #5 — execute_sql. Runs the validated read-only query against the
 * MariaDB business database (via Drizzle), records the rows/columns on the
 * blackboard, then loads those rows into the per-run DuckDB scratch scope so the
 * profiler / viz compiler can shape the visualization. DuckDB never touches the
 * source DB — retrieval is pure MariaDB SQL; DuckDB only ingests the result.
 *
 * Privacy: ONLY the result structure (row count + column names/types) is
 * returned to the LLM — never the row values. The full result set reaches the
 * frontend out-of-band via the blackboard.
 */
@Injectable()
export class ExecuteSqlAgentService {
  readonly agent: Agent;

  constructor(
    @InjectPinoLogger(ExecuteSqlAgentService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    @Inject(DRIZZLE) private readonly db: MySql2Database,
    private readonly duckdb: DuckdbService,
    private readonly ingest: DatasetIngestService,
    private readonly profiler: ResultProfilerService,
    private readonly safeInsights: SafeInsightsService,
  ) {
    this.agent = new Agent({
      id: 'execute_sql',
      name: 'ExecuteSqlAgent',
      description:
        'Execute the validated read-only SQL against MariaDB and report the row count and columns. ' +
        'Run AFTER validate_sql.',
      instructions: [
        'You execute the validated query and report the outcome.',
        'Begin your reply with ONE short sentence (e.g. "Running the query against the database.").',
        'Call the run_sql tool. Then report how many rows came back and the column names and types.',
        'If run_sql returns an error, report it plainly and do not fabricate results.',
        'NEVER include actual row values in your reply — only the row count and the column names/types. ' +
          'The raw data is shown to the user separately and must not pass through you.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
      tools: { run_sql: this.runSqlTool() },
    });
  }

  /** Get-or-create the per-run DuckDB scratch scope (rows are ingested here). */
  private async ensureScope(run: AnalyticsRunContext) {
    if (!run.duckdb) run.duckdb = await this.duckdb.createScope();
    return run.duckdb;
  }

  /**
   * Load the retrieved rows into DuckDB and build the metadata-only profile +
   * safe insights the viz / summarize steps consume. Best-effort: a failure here
   * leaves the data table intact (it renders from run.rows) and degrades to no
   * chart rather than failing the whole retrieval.
   */
  private async ingestAndProfile(run: AnalyticsRunContext): Promise<void> {
    try {
      const scope = await this.ensureScope(run);
      const outputs = await this.ingest.ingest(scope, run.columns, run.rows);
      run.datasetOutputs = outputs;
      run.analysisDatasetReady = true;
      run.resultProfile = await this.profiler.profile(scope, outputs);
      run.safeInsights = await this.safeInsights.build(scope, run.resultProfile);
    } catch (err) {
      this.logger.warn({ err }, 'failed to ingest/profile retrieved rows in DuckDB');
      run.analysisDatasetReady = false;
      run.resultProfile = undefined;
      run.safeInsights = undefined;
    }
  }

  private runSqlTool() {
    return createTool({
      id: 'run_sql',
      description: 'Execute the recorded read-only SELECT and capture the result rows.',
      inputSchema: z.object({}),
      // Privacy: this tool returns ONLY the result structure to the LLM — the
      // row count and the column names/types. Raw row values are kept on the
      // blackboard (run.rows) and never surfaced to the model.
      outputSchema: z.object({
        ok: z.boolean(),
        error: z.string().optional(),
        rowCount: z.number().optional(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
      }),
      execute: async () => {
        const run = currentRun();
        const query = run?.sql ?? '';

        // Deterministic retry ceiling: count every attempt and refuse once the
        // cap is exceeded. The terminal message tells the agent to stop retrying
        // and report failure, so a query that keeps failing can't loop forever.
        if (run) {
          run.executeAttempts = (run.executeAttempts ?? 0) + 1;
          if (run.executeAttempts > MAX_EXECUTE_ATTEMPTS) {
            return {
              ok: false,
              error:
                `Retry limit reached: the query was attempted ${MAX_EXECUTE_ATTEMPTS} times ` +
                `without success. Stop retrying and report plainly that the data could not be retrieved.`,
            };
          }
        }

        const safety = validateReadOnlySql(query);
        if (!safety.valid) {
          return { ok: false, error: safety.reason ?? 'SQL failed read-only validation.' };
        }

        try {
          const [rawRows] = await this.db.execute(drizzleSql.raw(query));
          const rows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
          const columns =
            rows.length > 0
              ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
              : [];

          if (run) {
            run.rows = rows;
            run.columns = columns;
            run.rowCount = rows.length;
            // Load the retrieved rows into DuckDB for profiling + chart shaping.
            if (rows.length > 0) await this.ingestAndProfile(run);
          }

          return {
            ok: true,
            rowCount: rows.length,
            columns,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'SQL execution failed.';
          return { ok: false, error: message };
        }
      },
    });
  }
}
