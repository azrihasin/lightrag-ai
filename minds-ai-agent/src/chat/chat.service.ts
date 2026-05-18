import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ModelProvider } from './providers/model.provider';
import { ToolRegistry } from './tools/tool-registry';
import type { ChatRequestDto } from './dto/chat-request.dto';
import type { DataSpecPayload } from './dto/sse-event.dto';
import type { CompiledStateGraph } from '@langchain/langgraph';
import type { AgentState } from './utils/agent-state';
import type { NodeCustomEvent } from './utils/agent-types';
import { terminalLog } from './utils/agent.utils';
import { buildGraph } from './utils/agent-graph';
import {
  STREAMING_NODES,
  TOOL_STREAMING_NODES,
  resolveToolName,
  resolveStartingMessage,
  extractNodeArgs,
  summarizeNodeOutput,
} from './utils/stream.utils';
import { ChatHistoryService } from '../chat-history/chat-history.service';
import type { NewMessage } from '../chat-history/chat-history.types';

@Injectable()
export class ChatService implements OnModuleInit {
  private app!: CompiledStateGraph<AgentState, Partial<AgentState>, any>;

  constructor(
    @InjectPinoLogger(ChatService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly chatHistoryService: ChatHistoryService,
  ) {}

  onModuleInit(): void {
    const tools = this.toolRegistry.getAll();
    this.app = buildGraph(tools, this.logger, this.modelProvider);
    this.logger.info('Agent graph compiled and ready');
  }

  stream(dto: ChatRequestDto, res: Response): void {
    const messages = dto.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const initialState: AgentState = { messages, retryCount: 0 };
    const threadId = randomUUID();
    const config = { configurable: { thread_id: threadId }, recursionLimit: 50 };

    this.logger.info({ threadId, messageCount: messages.length }, 'Chat stream started');

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        const openTextParts = new Map<string, string>();
        const openToolGroups = new Map<string, string>();
        const resolvedToolNames = new Map<string, string>();

        let currentState: AgentState = { ...initialState };

        // Accumulate the full assistant response text for history persistence
        let accumulatedText = '';

        const closeTextPart = (nodeName: string) => {
          const id = openTextParts.get(nodeName);
          if (id) {
            writer.write({ type: 'text-end', id });
            openTextParts.delete(nodeName);
          }
        };

        const closeToolGroup = (nodeName: string, stateDelta: Partial<AgentState>) => {
          const toolCallId = openToolGroups.get(nodeName);
          if (toolCallId) {
            openToolGroups.delete(nodeName);
            resolvedToolNames.delete(nodeName);
            const summary = summarizeNodeOutput(nodeName, stateDelta);
            writer.write({ type: 'tool-output-available', toolCallId, output: summary });
          }
        };

        const openToolGroup = (nodeName: string) => {
          if (openToolGroups.has(nodeName)) return;
          const toolName = resolveToolName(nodeName, currentState);
          if (!toolName) return;
          const toolCallId = randomUUID();
          openToolGroups.set(nodeName, toolCallId);
          resolvedToolNames.set(nodeName, toolName);
          const input = extractNodeArgs(nodeName, currentState);
          writer.write({ type: 'tool-input-available', toolCallId, toolName, input });
          const startMsg = resolveStartingMessage(nodeName, currentState);
          (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: startMsg });
        };

        try {
          const graphStream = await this.app.stream(initialState, {
            ...config,
            streamMode: ['updates', 'messages', 'custom'] as const,
          });

          for await (const streamChunk of graphStream) {
            const [mode, data] = streamChunk as [string, unknown];

            if (mode === 'custom') {
              const event = data as NodeCustomEvent;
              terminalLog('custom', event.node, event);
              this.logger.debug({ streamMode: 'custom', node: event.node, event }, 'stream event');

              if (event.type === 'node:start') {
                openToolGroup(event.node);
              } else if (event.type === 'node:progress') {
                const toolCallId = openToolGroups.get(event.node);
                if (toolCallId) {
                  if (event.step === 'token') {
                    (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: event.data as string });
                  } else if (event.step === 'sql-query') {
                    const { sql, dialect } = event.data as { sql: string; dialect: string };
                    (writer as any).write({ type: 'sql-generated', toolCallId, sql, dialect });
                  } else if (event.step === 'sql-table-start') {
                    const { columns } = event.data as { columns: string[] };
                    (writer as any).write({ type: 'sql-table-start', toolCallId, columns });
                  } else if (event.step === 'sql-table-row') {
                    const { row } = event.data as { row: Record<string, unknown> };
                    (writer as any).write({ type: 'sql-table-row', toolCallId, row });
                  } else if (event.step === 'sql-table-end') {
                    const { rowCount } = event.data as { rowCount: number };
                    (writer as any).write({ type: 'sql-table-end', toolCallId, rowCount });
                  } else if (event.step === 'jmespath-query') {
                    const { query, component } = event.data as { query: string; component: string };
                    (writer as any).write({ type: 'jmespath-query', toolCallId, query, component });
                  } else {
                    const progressLine = `\n[${event.step}] ${JSON.stringify(event.data ?? {})}`;
                    (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: progressLine });
                  }
                }
              }
              continue;
            }

            if (mode === 'messages') {
              const [chunk, metadata] = data as [
                { content: unknown },
                { langgraph_node?: string; langgraph_step?: number; ls_model_name?: string },
              ];
              const nodeName = metadata?.langgraph_node;

              let token = '';
              const content = chunk.content;
              if (typeof content === 'string') {
                token = content;
              } else if (Array.isArray(content)) {
                for (const block of content as Array<{ type?: string; text?: string }>) {
                  if (block.type === 'text' && block.text) token += block.text;
                }
              }

              terminalLog('messages', nodeName, {
                token,
                step: metadata?.langgraph_step,
                model: metadata?.ls_model_name,
              });
              this.logger.debug(
                { streamMode: 'messages', node: nodeName, tokenLength: token.length, step: metadata?.langgraph_step },
                'stream event',
              );

              if (!token || !nodeName) continue;

              if (STREAMING_NODES.has(nodeName) || TOOL_STREAMING_NODES.has(nodeName)) {
                openToolGroup(nodeName);
              }

              if (STREAMING_NODES.has(nodeName)) {
                if (!openTextParts.has(nodeName)) {
                  const id = randomUUID();
                  openTextParts.set(nodeName, id);
                  writer.write({ type: 'text-start', id });
                }
                const id = openTextParts.get(nodeName)!;
                writer.write({ type: 'text-delta', id, delta: token });
                accumulatedText += token;
              }

              if (STREAMING_NODES.has(nodeName) || TOOL_STREAMING_NODES.has(nodeName)) {
                const toolCallId = openToolGroups.get(nodeName);
                if (toolCallId) {
                  (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: token });
                }
              }
              continue;
            }

            if (mode === 'updates') {
              const updateMap = data as Record<string, Partial<AgentState>>;

              for (const [nodeName, stateDelta] of Object.entries(updateMap)) {
                terminalLog('updates', nodeName, stateDelta);
                this.logger.debug({ streamMode: 'updates', node: nodeName, delta: stateDelta }, 'stream event');

                currentState = { ...currentState, ...stateDelta };

                closeTextPart(nodeName);
                closeToolGroup(nodeName, stateDelta);

                if (nodeName === 'renderVisualization') {
                  const ds = stateDelta.visualizationPayload as DataSpecPayload | undefined;
                  if (ds?.componentType) {
                    writer.write({ type: 'data-spec', data: { componentType: ds.componentType, props: ds.props } });
                  }
                }
              }
            }
          }

          for (const [, id] of openTextParts) writer.write({ type: 'text-end', id });
          openTextParts.clear();

          this.logger.info({ threadId }, 'Chat stream completed');

          // Persist history after successful stream completion
          await this.persistTurn(dto, accumulatedText, threadId);
        } catch (err) {
          for (const [, id] of openTextParts) writer.write({ type: 'text-end', id });
          openTextParts.clear();
          const message = err instanceof Error ? err.message : 'An unexpected error occurred';
          this.logger.error({ threadId, err }, 'Chat stream error');
          writer.write({ type: 'error', errorText: message });
        }
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream });
  }

  private async persistTurn(dto: ChatRequestDto, assistantText: string, threadId: string): Promise<void> {
    try {
      const sessionId = await this.chatHistoryService.ensureSession(dto.sessionId ?? dto.id);

      const newMessages: NewMessage[] = [];
      let seqBase = 0;

      // Save the last user message from this request (the new turn)
      const lastUserMsg = [...dto.messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        const content = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content);

        newMessages.push({
          id: lastUserMsg.id,
          sequence_index: seqBase++,
          role: 'user',
          message_type: 'text',
          content,
        });
      }

      // Save the assistant response if one was generated
      if (assistantText.trim()) {
        newMessages.push({
          sequence_index: seqBase++,
          role: 'assistant',
          message_type: 'text',
          content: assistantText.trim(),
          metadata: { thread_id: threadId },
          model_name: process.env.AI_MODEL,
        });
      }

      if (newMessages.length === 0) return;

      const autoTitle = lastUserMsg
        ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '').slice(0, 80)
        : undefined;

      await this.chatHistoryService.appendTurn({ sessionId, messages: newMessages, autoTitle });

      this.logger.info({ sessionId, threadId }, 'Chat history persisted');
    } catch (err) {
      // Non-fatal: log but don't break the response
      this.logger.error({ err, threadId }, 'Failed to persist chat history');
    }
  }
}
