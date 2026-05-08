import { Injectable, Inject } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class ExecuteSqlTool {
  constructor(@Inject(DRIZZLE) private readonly db: MySql2Database) {}

  asTool() {
    return tool(
      async ({ actionId, sql: rawSql }) => {
        const t0 = Date.now();

        const [rawRows] = await this.db.execute(sql.raw(rawSql));

        const rows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        return {
          actionId,
          sql: rawSql,
          rows,
          columns,
          rowCount: rows.length,
          durationMs: Date.now() - t0,
          success: true,
        };
      },
      {
        name: 'execute_sql',
        description:
          'Execute a validated SQL SELECT query. Requires a validated actionId from validate_sql (status must be "valid").',
        schema: z.object({
          actionId: z.string(),
          sql: z.string(),
          params: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    );
  }
}
