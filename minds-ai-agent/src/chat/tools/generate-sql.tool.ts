import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { ModelProvider } from '../providers/model.provider';

@Injectable()
export class GenerateSqlTool {
  constructor(private readonly modelProvider: ModelProvider) {}

  asTool() {
    return createTool({
      id: 'generate_sql',
      description: 'Convert a natural-language data intent into a SQL SELECT query. Always follow with validate_sql.',
      inputSchema: z.object({
        intent: z.string(),
        dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('mysql'),
        schemaHint: z.string().optional(),
        rationale: z.string().optional(),
      }),
      execute: async (input) => {
        if (!input.schemaHint?.trim()) {
          throw new Error('Cannot generate SQL: no schema context retrieved.');
        }

        const model = this.modelProvider.getModel();

        const { text: extractionRaw } = await generateText({
          model,
          system:
            'Extract the database schema from the provided text.\n' +
            'Return ONLY: {"tables":[{"name":"table_name","columns":["col1","col2"]}]}\n' +
            'Include ONLY explicitly mentioned tables/columns. Raw JSON only, no markdown.',
          prompt: `Schema text:\n${input.schemaHint}`,
        });

        const extractionText = extractionRaw.trim().replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '').trim();
        let structuredSchema: { tables: { name: string; columns: string[] }[] };
        try {
          structuredSchema = JSON.parse(extractionText);
        } catch {
          throw new Error('Cannot generate SQL: schema could not be parsed.');
        }

        if (!structuredSchema.tables?.length) {
          throw new Error('Cannot generate SQL: no tables found in schema context.');
        }

        const formattedSchema = structuredSchema.tables
          .map(t => `TABLE: ${t.name}\n  COLUMNS: ${t.columns.length ? t.columns.join(', ') : '(unknown — use SELECT *)'}`)
          .join('\n\n');

        const { text: rawSql } = await generateText({
          model,
          system:
            `Strict SQL query builder. Use ONLY these tables/columns:\n\n${formattedSchema}\n\n` +
            `Rules: SELECT only, LIMIT 50, dialect ${input.dialect ?? 'mysql'}, return raw SQL only — no markdown, no explanation.`,
          prompt: `Intent: ${input.intent}`,
        });

        const sql = rawSql.trim().replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '').trim();
        if (sql.toUpperCase().startsWith('ERROR:')) {
          throw new Error(`SQL generation refused: ${sql}`);
        }

        return { actionId: randomUUID(), sql, dialect: input.dialect ?? 'mysql', requiresValidation: true };
      },
    });
  }
}
