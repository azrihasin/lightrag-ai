import { Injectable, Inject } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql as drizzleSql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../database/database.module';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import { validateReadOnlySql } from './validate-sql.agent';

/**
 * Subagent #5 — execute_sql. Runs the validated read-only query against the
 * MariaDB business database and records the rows/columns on the blackboard.
 * Privacy: ONLY the result structure (row count + column names/types) is
 * returned to the LLM — never the row values. The full result set reaches the
 * frontend out-of-band via the blackboard.
 */
@Injectable()
export class ExecuteSqlAgentService {
  readonly agent: Agent;

  constructor(
    private readonly modelProvider: ModelProvider,
    @Inject(DRIZZLE) private readonly db: MySql2Database,
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
