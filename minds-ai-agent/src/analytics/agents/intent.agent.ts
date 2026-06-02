import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../../chat/providers/model.provider';

/**
 * Subagent #1 — analyze_intent. Pure-reasoning agent: restates the user's data
 * question in business terms (metric, dimensions, time grain, filters, implied
 * visualization) without inventing table/column names.
 */
@Injectable()
export class IntentAgentService {
  readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    this.agent = new Agent({
      id: 'analyze_intent',
      name: 'AnalyzeIntentAgent',
      description:
        'Analyze the user data question and restate the requested metric, dimensions/grouping, ' +
        'time grain, filters, and the kind of visualization implied. Run this FIRST. Do not write SQL.',
      instructions: [
        'You analyze a user data question and extract structured intent for downstream SQL generation.',
        'Begin your reply with ONE short sentence telling the user what you are about to do (e.g. "Let me figure out what you are asking for.").',
        'Then describe: the metric requested, the dimensions/groupings, any time grain, filters, and the best visualization type (bar, line, area, pie, table, map).',
        'If the question implies a list of records rather than an aggregate, say so explicitly.',
        'Do NOT invent or mention specific table or column names — that is the SQL agent\'s job.',
        'Keep it concise (a few sentences).',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
    });
  }
}
