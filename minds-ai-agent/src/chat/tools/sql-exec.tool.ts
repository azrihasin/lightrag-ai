import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class SqlExecTool {
  asTool() {
    return tool(
      async ({ sql, maxRows }: { sql: string; maxRows?: number }) => {
        if (/^\s*(insert|update|delete|drop|alter|create|truncate)/i.test(sql.trim())) {
          return { error: 'Only SELECT queries are allowed.' };
        }
        const rows = Array.from({ length: Math.min(3, maxRows ?? 50) }, (_, i) => ({
          id: i + 1,
          name: `Row ${i + 1}`,
          value: parseFloat((Math.random() * 1000).toFixed(2)),
        }));
        return { rows, rowCount: rows.length, sql, columns: ['id', 'name', 'value'] };
      },
      {
        name: 'sql_exec',
        description: 'Execute a SQL SELECT query and return rows.',
        schema: z.object({
          sql: z.string(),
          maxRows: z.number().int().min(1).max(500).optional().default(50),
        }),
      },
    );
  }
}
