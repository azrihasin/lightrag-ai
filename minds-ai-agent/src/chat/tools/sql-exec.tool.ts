import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class SqlExecTool {
  asTool() {
    return tool({
      description: 'Execute a SQL SELECT query and return rows.',
      inputSchema: z.object({
        sql: z.string(),
        maxRows: z.number().int().min(1).max(500).optional().default(50),
      }),
      execute: async ({ sql, maxRows }) => {
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
    });
  }
}
