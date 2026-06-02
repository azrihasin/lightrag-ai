import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../../chat/providers/model.provider';
import { LightragHarnessTool } from '../../ai/mastra/tools/lightrag.tool';

/**
 * Subagent #2 — retrieve_context. Owns the LightRAG retrieval tool and surfaces
 * the database schema/business context (tables, columns, relationships) needed
 * to write SQL. Its text output carries that context forward so the SQL agent
 * (which receives the conversation) can rely on it.
 */
@Injectable()
export class ContextAgentNetworkService {
  readonly agent: Agent;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly lightragTool: LightragHarnessTool,
  ) {
    this.agent = new Agent({
      id: 'retrieve_context',
      name: 'RetrieveContextAgent',
      description:
        'Retrieve database schema and business context from LightRAG for the analyzed intent. ' +
        'Run AFTER analyze_intent and BEFORE generate_sql.',
      instructions: [
        'You retrieve database schema context from LightRAG so the SQL agent can write a correct query.',
        'LightRAG returns retrieved context only (table names, columns with data types, foreign keys/relationships) — it does NOT generate prose, summaries, or SQL. Do not ask it to.',
        'Begin your reply with ONE short sentence telling the user what you are about to do (e.g. "Looking up the relevant database schema.").',
        'Call the harness_retrieve_context tool with a schema-oriented query derived from the analyzed intent.',
        'Then forward the retrieved schema context VERBATIM — the exact table names, columns with their data types, and relationships from the tool result — so the generate_sql agent has accurate names to write a correct query on the first attempt.',
        'Do not paraphrase, summarize, rename, or invent tables/columns; copy the schema text as-is. Add no analysis of your own.',
        'If the tool reports insufficient context (sufficient = false or empty schema), say so plainly and do not fabricate schema.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
      tools: { harness_retrieve_context: this.lightragTool.asTool() },
    });
  }
}
