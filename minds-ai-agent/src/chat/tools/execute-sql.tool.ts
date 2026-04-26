import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class ExecuteSqlTool {
  asTool() {
    return tool({
      description:
        'Execute a validated SQL SELECT query. Requires a validated actionId from validate_sql (status must be "valid").',
      inputSchema: z.object({
        actionId: z.string(),
        sql: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ actionId, sql }) => {
        const t0 = Date.now();
        // Stub: replace with real DB client
        const columns = ['id', 'name', 'value', 'created_at'];
        const rows = Array.from({ length: 5 }, (_, i) => ({
          id: i + 1,
          name: `Record ${i + 1}`,
          value: Math.round(Math.random() * 1000),
          created_at: new Date(Date.now() - i * 86_400_000).toISOString().split('T')[0],
        }));
        return {
          actionId,
          sql,
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
