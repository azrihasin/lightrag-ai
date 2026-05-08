import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ModelProvider } from '../providers/model.provider';

async function streamToText(
  model: ReturnType<ModelProvider['getChatModel']>,
  messages: (SystemMessage | HumanMessage)[],
): Promise<string> {
  let text = '';
  for await (const chunk of await model.stream(messages)) {
    const c = chunk.content;
    if (typeof c === 'string') {
      text += c;
    } else if (Array.isArray(c)) {
      for (const block of c as Array<{ type?: string; text?: string }>) {
        if (block.type === 'text' && block.text) text += block.text;
      }
    }
  }
  return text;
}

@Injectable()
export class GenerateSqlTool {
  constructor(private readonly modelProvider: ModelProvider) {}

  asTool() {
    return tool(
      async ({ intent, dialect, schemaHint, rationale }) => {
        const model = this.modelProvider.getChatModel(['generateSql']);

        if (!schemaHint || schemaHint.trim().length === 0) {
          throw new Error(
            'Cannot generate SQL: no schema context was retrieved. ' +
            'The knowledge base did not return any table or column information for this query.',
          );
        }

        const extractionRaw = await streamToText(model, [
          new SystemMessage(
            'Extract the database schema from the provided text.\n' +
            'Return ONLY a JSON object with this exact structure:\n' +
            '{"tables":[{"name":"table_name","columns":["col1","col2"]}]}\n\n' +
            'Rules:\n' +
            '- Include ONLY tables and columns that are explicitly mentioned in the text.\n' +
            '- Do NOT invent, infer, or guess any table or column name.\n' +
            '- Each column must be listed under the exact table it belongs to.\n' +
            '- If no tables or columns are found, return {"tables":[]}.\n' +
            '- Return raw JSON only — no markdown fences, no explanation.',
          ),
          new HumanMessage(`Schema text:\n${schemaHint}`),
        ]);

        const extractionText = extractionRaw
          .trim()
          .replace(/^```[\w]*\n?/i, '')
          .replace(/\n?```$/i, '')
          .trim();

        let structuredSchema: { tables: { name: string; columns: string[] }[] };
        try {
          structuredSchema = JSON.parse(extractionText);
        } catch {
          throw new Error(
            'Cannot generate SQL: schema context could not be parsed into a table/column structure. ' +
            'Ensure the knowledge base contains explicit table and column definitions.',
          );
        }

        if (!structuredSchema.tables || structuredSchema.tables.length === 0) {
          throw new Error(
            'Cannot generate SQL: no tables were found in the retrieved schema context. ' +
            'The knowledge base did not return any table definitions for this query.',
          );
        }

        const formattedSchema = structuredSchema.tables
          .map((t) => `TABLE: ${t.name}\n  COLUMNS: ${t.columns.length > 0 ? t.columns.join(', ') : '(unknown — use SELECT *)'}`)
          .join('\n\n');

        const rawSql = await streamToText(model, [
          new SystemMessage(
            `You are a strict SQL query builder. Your ONLY job is to construct a safe SELECT query using EXCLUSIVELY the tables and columns listed in the schema below.\n\n` +
            `ABSOLUTE RULES — violating any of these makes the query invalid:\n` +
            `1. Use ONLY table names that appear under "TABLE:" in the schema below.\n` +
            `2. Use ONLY column names listed under "COLUMNS:" for the specific table they belong to. A column from one table MUST NOT be used with a different table.\n` +
            `3. If the required table or column is NOT listed below, respond with exactly: ERROR: Required schema not found in context.\n` +
            `4. Copy table names and column names character-for-character — spelling, casing, and underscores must match exactly.\n` +
            `5. SELECT only — no INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, or any other mutating statement.\n` +
            `6. Always include a LIMIT clause (maximum 50 rows).\n` +
            `7. Dialect: ${dialect ?? 'mysql'}.\n` +
            `8. Return ONLY the raw SQL — no markdown fences, no explanation, no semicolon at the end.\n` +
            `9. If the user's intent does not explicitly name specific columns, use SELECT * to return all columns for that table. Only list specific columns when the user explicitly requests them.\n\n` +
            `AVAILABLE SCHEMA (ONLY these tables and columns exist — nothing else):\n${formattedSchema}`,
          ),
          new HumanMessage(`Intent: ${intent}`),
        ]);

        let sql = rawSql.trim().replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '').trim();

        if (sql.toUpperCase().startsWith('ERROR:')) {
          throw new Error(`SQL generation refused: ${sql}`);
        }

        return {
          actionId: randomUUID(),
          sql,
          dialect: dialect ?? 'mysql',
          schemaHint: schemaHint ?? null,
          rationale: rationale ?? `Generated SQL to satisfy: ${intent}`,
          requiresValidation: true,
        };
      },
      {
        name: 'generate_sql',
        description:
          'Convert a natural-language data intent into a SQL SELECT query. ' +
          'Always follow with validate_sql before executing.',
        schema: z.object({
          intent: z.string().describe('Natural-language description of the data to retrieve'),
          dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('mysql'),
          schemaHint: z.string().optional().describe('Relevant table/column hints from context'),
          rationale: z.string().optional().describe('Why this SQL satisfies the intent'),
        }),
      },
    );
  }
}
