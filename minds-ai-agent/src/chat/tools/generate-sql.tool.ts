import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

@Injectable()
export class GenerateSqlTool {
  asTool() {
    return tool({
      description:
        'Convert a natural-language data intent into a SQL SELECT query. ' +
        'Always follow with validate_sql before executing.',
      inputSchema: z.object({
        intent: z.string().describe('Natural-language description of the data to retrieve'),
        dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('postgres'),
        schemaHint: z.string().optional().describe('Relevant table/column hints from context'),
        rationale: z.string().optional().describe('Why this SQL satisfies the intent'),
      }),
      execute: async ({ intent, dialect, schemaHint, rationale }) => ({
        actionId: randomUUID(),
        sql: `SELECT * FROM example_table WHERE description ILIKE '%${intent.slice(0, 30).replace(/'/g, "''")}%' LIMIT 100`,
        dialect,
        schemaHint: schemaHint ?? null,
        rationale: rationale ?? `Generated SQL to satisfy: ${intent}`,
        requiresValidation: true,
      }),
    });
  }
}
