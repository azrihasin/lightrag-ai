import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import { SQL_SCHEMA_GROUNDING_RULES } from '../../ai/mastra/agents/sql.agent';
import { checkSchemaGrounding } from '../sql-grounding';

/**
 * Subagent #3 — generate_sql. Writes a read-only MariaDB SELECT from the schema
 * context, then records it on the run blackboard via `record_sql` so the
 * execute step uses the exact query (not an LLM paraphrase).
 *
 * LIMIT rule: list/row questions always get `LIMIT 10` unless the user asked
 * for a specific count or it is a pure aggregate.
 */
const BASE_INSTRUCTIONS = [
  'You generate a single read-only MariaDB SELECT query from the schema context in the conversation.',
  'Begin your reply with ONE short sentence telling the user what you are about to do (e.g. "Writing the SQL query for this.").',
  ...SQL_SCHEMA_GROUNDING_RULES,
  '- If a required table or column is not present in the context, call record_sql with an empty string and briefly say which table/column was missing. Do NOT guess a name and do NOT attempt a best-effort query.',
  'Build the query using ONLY table and column names you can point to verbatim in the schema context, copying their exact spelling (including underscores and casing).',
  'AUTOMATIC GROUNDING CHECK: when you call record_sql, the tool parses your SQL and verifies every table and column identifier against the retrieved schema context. If any identifier is not in the context, the tool REJECTS the query (recorded:false) and returns the offending names. When that happens, do not repeat the same names — re-read the context, replace each rejected identifier with the correct one from the context (or drop it), and call record_sql again. If the correct name genuinely does not exist in the context, call record_sql with an empty string and say what was missing.',
  'Other rules:',
  '- SELECT only. No INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/GRANT/REVOKE/MERGE/CALL/EXEC.',
  '- Use explicit column names; avoid SELECT *.',
  '- When the user asks for a LIST of records/rows (not an aggregate), ALWAYS add `LIMIT 10`, UNLESS the user explicitly requested a different number of rows.',
  '- Pure aggregates (COUNT/SUM/AVG with no row listing) do not need a LIMIT.',
  '- Add sensible date filters when the question is time-based (only using date columns that appear in the context).',
  'You MUST call the record_sql tool with the final SQL string, and it must pass the grounding check (recorded:true) before you finish.',
  'Then briefly explain the query in plain language. Do not dump large schema text back.',
].join('\n');

@Injectable()
export class GenerateSqlAgentService {
  readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    this.agent = new Agent({
      id: 'generate_sql',
      name: 'GenerateSqlAgent',
      description:
        'Generate a read-only MariaDB SELECT query from the retrieved schema context and user intent, ' +
        'then record it. Run AFTER retrieve_context.',
      // Dynamic instructions: the master relaying the schema verbatim from
      // retrieve_context into this subagent's prompt is unreliable — when it fails,
      // this agent sees no schema and (correctly per its grounding rule) records
      // empty SQL even though the context was sufficient. So we inject the exact
      // schema the LightRAG tool wrote to the run blackboard (`run.retrievedContext`,
      // the SAME source the record_sql grounding guard checks against) directly into
      // the prompt. This resolves within the analyticsRunStore async context, like
      // the record_sql tool's currentRun() call.
      instructions: () => {
        const schema = currentRun()?.retrievedContext?.trim();
        if (!schema) return BASE_INSTRUCTIONS;
        return (
          `${BASE_INSTRUCTIONS}\n\n` +
          `RETRIEVED SCHEMA CONTEXT — this is the authoritative whitelist of the ONLY table and ` +
          `column names you may use (copy them verbatim, including underscores and casing). It is ` +
          `the SAME context the grounding check validates against:\n${schema}`
        );
      },
      model: this.modelProvider.getModel() as any,
      tools: { record_sql: this.recordSqlTool() },
    });
  }

  private recordSqlTool() {
    return createTool({
      id: 'record_sql',
      description: 'Record the final read-only SELECT query so it can be validated and executed.',
      inputSchema: z.object({
        sql: z.string().describe('The final read-only MariaDB SELECT query'),
      }),
      outputSchema: z.object({
        recorded: z.boolean(),
        sql: z.string(),
        error: z.string().optional(),
        missingIdentifiers: z.array(z.string()).optional(),
      }),
      execute: async (input: { sql: string }) => {
        const run = currentRun();
        const sql = input.sql.trim();

        // Deterministic anti-hallucination guard: reject any table/column that is
        // not present verbatim in the retrieved schema context, so a made-up name
        // never reaches the blackboard (and never gets executed).
        const grounding = checkSchemaGrounding(sql, run?.retrievedContext ?? '');
        if (grounding.grounded === false) {
          return {
            recorded: false,
            sql,
            error: grounding.reason,
            missingIdentifiers: grounding.missing,
          };
        }

        if (run) run.sql = sql;
        return { recorded: true, sql };
      },
    });
  }
}
