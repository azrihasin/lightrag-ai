import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import { checkSchemaGrounding } from '../sql-grounding';
import { buildTextToSqlSystemPrompt } from './lightrag-sql.agent';

/**
 * Subagent #3 — generate_sql. Writes a single read-only MariaDB SELECT from the
 * retrieved LightRAG context following the Enterprise Text-to-SQL procedure
 * (shared with the standalone {@link import('./lightrag-sql.agent')} agent), then
 * records the final query on the run blackboard via `record_sql` so the validate
 * and execute steps use the exact query (not an LLM paraphrase).
 *
 * The enterprise mega-prompt drives the reasoning; the TOOL CONTRACT below adapts
 * its markdown "## SQL" output into a record_sql tool call and enforces a
 * deterministic grounding check against the retrieved context.
 */
const TOOL_CONTRACT = [
  '',
  '---',
  '',
  '## TOOL CONTRACT (this deployment)',
  '',
  'You run as the generate_sql step of an automated pipeline. In ADDITION to the response format above, you MUST hand the final query to the pipeline:',
  '',
  '- After you determine the single final SELECT (the contents of your "## SQL" block), call the record_sql tool with that exact SQL string. The validate and execute steps run ONLY the SQL you record — not the SQL in your prose — so the recorded string must match exactly.',
  '- AUTOMATIC GROUNDING CHECK: record_sql parses your SQL and verifies every table and column identifier against the retrieved context below. If any identifier is not present verbatim, the tool REJECTS the query (recorded:false) and returns the offending names. When that happens, do not repeat the same names — replace each rejected identifier with the correct one from the context (or drop it), then call record_sql again until it returns recorded:true.',
  '- If the question cannot be answered from the retrieved context (a "## Context gap" or "## Clarification needed" case), call record_sql with an empty string ("") and briefly state what is missing. Do NOT guess a name and do NOT record a best-effort query.',
  '- Build the query using ONLY table and column names you can point to verbatim in the retrieved context, copying their exact spelling (including underscores and casing).',
  '- SELECT/WITH only. No INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/GRANT/REVOKE/MERGE/CALL/EXEC.',
  '- Use explicit column names; avoid SELECT *.',
  '- When the user asks for a LIST of rows (not an aggregate), ALWAYS add `LIMIT 10`, UNLESS the user explicitly requested a different number of rows. Pure aggregates (COUNT/SUM/AVG with no row listing) need no LIMIT.',
  '- Begin your reply with ONE short sentence telling the user what you are about to do (e.g. "Writing the SQL query for this.").',
  'You MUST call record_sql with the final SQL string, and it must pass the grounding check (recorded:true) before you finish.',
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
      // context the LightRAG tool wrote to the run blackboard (`run.retrievedContext`,
      // the SAME source the record_sql grounding guard checks against) directly as
      // the prompt's {lightrag_context}. This resolves within the analyticsRunStore
      // async context, like the record_sql tool's currentRun() call.
      instructions: () => {
        const base = buildTextToSqlSystemPrompt() + TOOL_CONTRACT;
        const schema = currentRun()?.retrievedContext?.trim();
        if (!schema) return base;
        return (
          `${base}\n\n---\n\n## {lightrag_context} — retrieved from LightRAG\n\n` +
          `This is the authoritative whitelist of the ONLY table and column names you may use ` +
          `(copy them verbatim, including underscores and casing). It is the SAME context the ` +
          `record_sql grounding check validates against:\n${schema}`
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
