import { Injectable, Inject } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class ExecuteSqlTool {
  constructor(@Inject(DRIZZLE) private readonly db: MySql2Database) {}

  asTool() {
    return createTool({
      id: 'execute_sql',
      description: 'Execute a validated SQL SELECT query.',
      inputSchema: z.object({
        actionId: z.string(),
        sql: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async (input) => {
        const t0 = Date.now();
        const [rawRows] = await this.db.execute(sql.raw(input.sql));
        const rows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
          actionId: input.actionId,
          sql: input.sql,
          rows,
          columns,
          rowCount: rows.length,
          durationMs: Date.now() - t0,
          success: true,
        };
      },
    });
  }
}
