import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';

const FORBIDDEN_SQL_WORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate',
  'create', 'grant', 'revoke', 'merge', 'call', 'exec',
];

/** Deterministic read-only safety check shared by validate_sql and run_sql. */
export function validateReadOnlySql(rawSql: string): { valid: boolean; reason?: string } {
  const normalized = rawSql.trim().toLowerCase();
  if (!normalized) return { valid: false, reason: 'No SQL was recorded.' };
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return { valid: false, reason: 'Query must start with SELECT or WITH.' };
  }
  for (const word of FORBIDDEN_SQL_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) {
      return { valid: false, reason: `Query contains forbidden keyword: ${word}.` };
    }
  }
  return { valid: true };
}

/**
 * Subagent #4 — validate_sql. Runs a deterministic read-only safety check on
 * the recorded SQL (the LLM does not get to decide safety).
 */
@Injectable()
export class ValidateSqlAgentService {
  readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    this.agent = new Agent({
      id: 'validate_sql',
      name: 'ValidateSqlAgent',
      description:
        'Validate that the recorded SQL is a safe read-only query. Run AFTER generate_sql and BEFORE execute_sql.',
      instructions: [
        'You confirm the recorded SQL is safe to run.',
        'Begin your reply with ONE short sentence (e.g. "Checking the query is read-only and safe.").',
        'Call the validate_sql tool. If it reports invalid, clearly state the query cannot be run and why; do NOT proceed to execution.',
        'If valid, say it passed read-only safety validation.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
      tools: { validate_sql: this.validateTool() },
    });
  }

  private validateTool() {
    return createTool({
      id: 'validate_sql',
      description: 'Run the deterministic read-only safety check on the recorded SQL.',
      inputSchema: z.object({}),
      outputSchema: z.object({ valid: z.boolean(), reason: z.string().optional() }),
      execute: async () => {
        const run = currentRun();
        const result = validateReadOnlySql(run?.sql ?? '');
        if (run) run.sqlValid = result.valid;
        return result;
      },
    });
  }
}
