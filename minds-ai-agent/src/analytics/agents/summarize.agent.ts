import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../../chat/providers/model.provider';

/**
 * Subagent #6 — summarize_result. Writes a concise business-language summary of
 * the query result. Privacy: it only ever sees the result *structure* (row count
 * + column names/types) — never raw row values — so it describes the shape of the
 * result, not specific data points.
 */
@Injectable()
export class SummarizeAgentService {
  readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    this.agent = new Agent({
      id: 'summarize_result',
      name: 'SummarizeResultAgent',
      description:
        'Write a concise business-language summary of the executed query result. Run AFTER execute_sql.',
      instructions: [
        'You summarize what the query result represents, in business language.',
        'Begin your reply with ONE short sentence (e.g. "Summarizing what the data shows.").',
        'You only have the result STRUCTURE — the row count and the column names/types. ' +
          'You do NOT have the raw row values, and they must never be requested or invented.',
        'Describe what the columns represent and how many rows matched. Do not state specific data values.',
        'If no rows were returned, say that no matching data was found.',
        'Keep the summary under 3 sentences.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
    });
  }
}
