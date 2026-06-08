import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../../chat/providers/model.provider';
import { LancedbRetrievalTool } from '../../ai/mastra/tools/lancedb-retrieve.tool';

/**
 * Subagent #2 — retrieve_context. Owns the LanceDB hybrid-retrieval tool and
 * surfaces the database schema context (tables, columns) needed to write SQL.
 * Its text output carries that context forward so the SQL agent (which receives
 * the conversation) can rely on it.
 */
@Injectable()
export class ContextAgentNetworkService {
  readonly agent: Agent;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly retrievalTool: LancedbRetrievalTool,
  ) {
    this.agent = new Agent({
      id: 'retrieve_context',
      name: 'RetrieveContextAgent',
      description:
        'Retrieve database schema context from a local LanceDB hybrid search for the analyzed intent. ' +
        'Run AFTER analyze_intent and BEFORE generate_sql.',
      instructions: [
        'You retrieve database schema context from a local LanceDB hybrid search (dense vector similarity + BM25 full-text search) so the SQL agent can write a correct query.',
        'The retrieval returns schema context only (a JSON whitelist of exact table names and their columns) — it does NOT generate prose, summaries, or SQL. Do not ask it to.',
        'Begin your reply with ONE short sentence telling the user what you are about to do (e.g. "Looking up the relevant database schema.").',
        'Call the harness_retrieve_context tool with a schema-oriented query derived from the analyzed intent.',
        'Then forward the retrieved schema context VERBATIM — the exact table and column names from the tool result — so the generate_sql agent has accurate names to write a correct query on the first attempt.',
        'Do not paraphrase, summarize, rename, or invent tables/columns; copy the schema text as-is. Add no analysis of your own.',
        'If the tool returns an empty schema, say so plainly and do not fabricate schema.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
      tools: { harness_retrieve_context: this.retrievalTool.asTool() },
    });
  }
}
