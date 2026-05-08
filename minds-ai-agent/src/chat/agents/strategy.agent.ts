import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import { randomUUID } from 'node:crypto';
import { ToolRegistry } from '../tools/tool-registry';
import { ModelProvider } from '../providers/model.provider';
import { UiDiscoveryService } from '../discovery/ui-discovery.service';
import { MessageDto } from '../dto/chat-request.dto';

const SYSTEM_PROMPT = `You are a helpful data-gathering assistant. Follow this pipeline:
1. retrieve_context — always start here
2. If context is sufficient: answer_from_context and stop
3. If ambiguous: clarification_request and stop
4. Data query: generate_sql → validate_sql → execute_sql
5. Calculation/search: generate_action → validate_action → execute_system_action
6. After execution: inspect_result
7. If visualization makes sense: prepare_visualization_data → render_visualization
8. Otherwise: summarize_result
9. compose_final_response`;

@Injectable()
export class StrategyAgent {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly modelProvider: ModelProvider,
    private readonly uiDiscovery: UiDiscoveryService,
  ) {}

  run(messages: MessageDto[], enableUiDiscovery: boolean, res: Response): void {
    const model = this.modelProvider.getChatModel();
    const tools = this.toolRegistry.asList();

    const agent = createReactAgent({
      llm: model,
      tools,
      messageModifier: SYSTEM_PROMPT,
    });

    const lcMessages = messages.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    );

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        let openTextId: string | null = null;

        try {
          const agentStream = await agent.stream(
            { messages: lcMessages },
            { streamMode: 'messages' },
          );

          for await (const [chunk, metadata] of agentStream as AsyncIterable<[{ content: unknown }, Record<string, unknown>]>) {
            const node = metadata?.langgraph_node as string | undefined;
            if (node !== 'agent') continue;

            const content = typeof chunk.content === 'string' ? chunk.content : '';
            if (!content) continue;

            if (!openTextId) {
              openTextId = randomUUID();
              writer.write({ type: 'text-start', id: openTextId });
            }
            writer.write({ type: 'text-delta', id: openTextId, delta: content });
          }
        } finally {
          if (openTextId) writer.write({ type: 'text-end', id: openTextId });
        }
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream });
  }
}
