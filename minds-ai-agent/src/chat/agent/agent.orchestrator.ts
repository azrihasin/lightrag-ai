import { Injectable } from '@nestjs/common';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
} from 'ai';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ToolRegistry } from '../tools/tool-registry';
import { ModelProvider } from '../providers/model.provider';
import { UiDiscoveryService } from '../discovery/ui-discovery.service';
import type { ChatRequestDto } from '../dto/chat-request.dto';
import type { DataSpecPayload } from '../dto/sse-event.dto';

const SYSTEM_PROMPT = `You are a precise AI agent. Follow this pipeline strictly for every request:

PIPELINE ORDER:
1. Call retrieve_context (always first — never skip this)
2. If retrieved context is sufficient: call answer_from_context → STOP
3. If query is ambiguous and you cannot proceed: call clarification_request → STOP
4. Decide path:
   - Data query (needs a database): generate_sql → validate_sql → execute_sql
   - Calculation/search/data-gen: generate_action → validate_action → execute_system_action
5. If validate_sql or validate_action returns "invalid_recoverable": regenerate (max 2 retries per action)
6. If validate returns "invalid_blocking" or riskLevel is "high": call human_review_gate → STOP
7. Call inspect_result on the execution output
8. If inspect_result.complete is false and steps remain: loop back to step 4 with refined intent
9. Call prepare_visualization_data if result has rows or numeric data
10. If prepare_visualization_data.suitable is true: call render_visualization
11. If not suitable: call summarize_result
12. Call compose_final_response → STOP

RULES:
- ALWAYS start with retrieve_context
- NEVER call execute_sql without a preceding validate_sql with status "valid"
- NEVER call execute_system_action without a preceding validate_action with status "valid"
- Keep internal reasoning private; stream only safe, user-facing content`;

@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly uiDiscovery: UiDiscoveryService,
  ) {}

  run(dto: ChatRequestDto, enableUiDiscovery: boolean, res: Response): void {
    const model = this.modelProvider.getChatModel();
    const tools = this.toolRegistry.asList();

    const agent = createReactAgent({
      llm: model,
      tools,
      messageModifier: SYSTEM_PROMPT,
    });

    const lcMessages = dto.messages.map((m) => {
      if (m.role === 'user') return new HumanMessage(m.content);
      if (m.role === 'system') return new SystemMessage(m.content);
      return new AIMessage(m.content);
    });

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        let openTextId: string | null = null;

        try {
          const agentStream = await agent.stream(
            { messages: lcMessages },
            { streamMode: 'messages' },
          );

          for await (const [chunk, metadata] of agentStream as AsyncIterable<[{ content: unknown; tool_calls?: unknown[] }, Record<string, unknown>]>) {
            const node = metadata?.langgraph_node as string | undefined;
            if (node !== 'agent') continue;

            // Emit UI discovery annotations for tool outputs when enabled
            if (enableUiDiscovery && Array.isArray((chunk as any).tool_calls)) {
              for (const tc of (chunk as any).tool_calls as Array<{ name: string; id: string }>) {
                const discovery = this.uiDiscovery.inspect({
                  toolName: tc.name,
                  toolCallId: tc.id ?? randomUUID(),
                  output: null,
                  sanitized: true,
                  durationMs: 0,
                });
                if (discovery) {
                  const dataSpec = this.uiDiscovery.buildDataSpec(discovery) as DataSpecPayload;
                  writer.write({ type: 'data-spec', data: { componentType: dataSpec.componentType, props: dataSpec.props } });
                }
              }
            }

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
