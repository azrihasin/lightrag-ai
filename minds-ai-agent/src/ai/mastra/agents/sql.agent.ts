import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { ModelProvider } from '../../../chat/providers/model.provider';

const sqlOutputSchema = z.object({
  sql: z.string(),
  explanation: z.string(),
  assumptions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

/**
 * The single source of truth for SQL schema grounding. Shared by BOTH SQL
 * generators — the workflow path (SqlAgentService, below) and the multi-agent
 * chat path (GenerateSqlAgentService) — so they cannot drift apart. These rules
 * are output-mechanism neutral; each agent appends its own "what to do when the
 * context is insufficient" line (empty `sql` field vs. empty `record_sql` call).
 */
export const SQL_SCHEMA_GROUNDING_RULES: string[] = [
  'STRICT SCHEMA GROUNDING (highest priority):',
  '- You may ONLY reference table names and column names that appear verbatim in the LightRAG schema context provided in the conversation/prompt.',
  '- You are FORBIDDEN from inventing, guessing, assuming, or inferring any table name or column name that is not explicitly present in that context.',
  '- Do not rename, pluralize, singularize, abbreviate, or otherwise modify any table or column name from the context — copy them exactly as written, including underscores (e.g. never turn `cell_5g` into `cell5g`).',
  '- Do not rely on prior knowledge, common naming conventions, or typical schema patterns to fill in missing tables or columns.',
  '- Do NOT introspect the catalog (information_schema, SHOW TABLES, etc.) to discover names — if a needed name is not in the context, the context is insufficient.',
  '- If a table or column needed to answer the question is not present in the context, treat the context as insufficient and do NOT attempt a best-effort query.',
];

@Injectable()
export class SqlAgentService {
  private readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    const model = this.modelProvider.getModel() as any;
    this.agent = new Agent({
      id: 'sql-agent',
      name: 'SqlAgent',
      instructions: [
        'You generate read-only MariaDB SELECT queries from schema context and user intent.',
        ...SQL_SCHEMA_GROUNDING_RULES,
        '- If the context is missing, empty, insufficient, or ambiguous for any required table or column, set sql to an empty string and explain exactly which table/column was missing in the explanation field. Do NOT attempt a best-effort query.',
        'Other rules:',
        '- Generate SELECT only. No INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, MERGE, CALL, or EXEC.',
        '- Use explicit column names (each must exist in the context). Avoid SELECT *.',
        '- Only use joins and relationships that are described in the context.',
        '- Add appropriate date filters when the user asks for time-based analysis.',
        '- Include a LIMIT clause unless the query is a pure aggregate (e.g. COUNT, SUM with no GROUP BY).',
        'Output JSON: sql, explanation, assumptions (array), confidence (0.0 to 1.0). List every table/column you used in assumptions and confirm each came from the context.',
      ].join('\n'),
      model,
    });
  }

  async generate(params: {
    question: string;
    lightragContext: string;
    previousAttempt?: { sql: string; failReason: string };
  }): Promise<{ sql: string; explanation: string; assumptions: string[]; confidence: number }> {
    const prompt = this.buildPrompt(params);
    const result = await this.agent.generate(prompt, {
      structuredOutput: {
        schema: sqlOutputSchema,
        jsonPromptInjection: this.modelProvider.needsJsonPromptInjection,
      },
    });
    return sqlOutputSchema.parse(result.object);
  }

  private buildPrompt(params: {
    question: string;
    lightragContext: string;
    previousAttempt?: { sql: string; failReason: string };
  }): string {
    let prompt =
      `User question: "${params.question}"\n\n` +
      `Schema context from LightRAG — this is the ONLY source of truth for table names, ` +
      `column names, joins, and relationships. You may use ONLY the table and column names that ` +
      `appear verbatim below. Do NOT invent, guess, assume, rename, or infer any table or column ` +
      `that is not explicitly listed here:\n` +
      `${params.lightragContext}\n\n` +
      `Generate a read-only MariaDB SELECT query using only the tables and columns above. ` +
      `If a required table or column is not present in the context, return an empty sql string and ` +
      `explain which table/column was missing. ` +
      `Return JSON with sql, explanation, assumptions, and confidence.`;

    if (params.previousAttempt) {
      prompt +=
        `\n\nPrevious attempt failed — correct the query:\n` +
        `SQL: ${params.previousAttempt.sql}\n` +
        `Reason: ${params.previousAttempt.failReason}`;
    }

    return prompt;
  }
}
