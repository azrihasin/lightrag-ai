import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { MindsAgentService } from './agent/minds-agent.service';
import { ChatHistoryService } from '../chat-history/chat-history.service';
import type { ChatRequestDto } from './dto/chat-request.dto';
import type { DataSpecPayload } from './dto/sse-event.dto';
import type { NewMessage } from '../chat-history/chat-history.types';

@Injectable()
export class ChatService {
  constructor(
    @InjectPinoLogger(ChatService.name) private readonly logger: PinoLogger,
    private readonly mindsAgent: MindsAgentService,
    private readonly chatHistoryService: ChatHistoryService,
  ) {}

  stream(dto: ChatRequestDto, res: Response): void {
    const threadId = dto.sessionId ?? dto.id ?? randomUUID();
    const lastUserMsg = [...dto.messages].reverse().find(m => m.role === 'user');
    const userText = lastUserMsg?.content ?? '';

    this.logger.info({ threadId, messageCount: dto.messages.length }, 'Chat stream started');

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Mastra emits text-start/text-end with IDs — track the active text part ID
        const textPartIds = new Map<string, string>(); // mastraId → uiId
        let accumulatedText = '';
        const openToolCalls = new Map<string, string>(); // toolCallId → toolName

        try {
          const supervisor = this.mindsAgent.getSupervisor();
          const result = await supervisor.stream(userText, {
            memory: { thread: threadId, resource: threadId },
            maxSteps: 20,
          });

          for await (const chunk of result.fullStream as AsyncIterable<{ type: string; payload: Record<string, unknown> }>) {
            const { type, payload } = chunk;

            switch (type) {
              case 'text-start': {
                const mastraId = payload.id as string;
                const uiId = randomUUID();
                textPartIds.set(mastraId, uiId);
                writer.write({ type: 'text-start', id: uiId });
                break;
              }

              case 'text-delta': {
                const mastraId = payload.id as string;
                const uiId = textPartIds.get(mastraId);
                const delta = payload.text as string;
                if (uiId && delta) {
                  writer.write({ type: 'text-delta', id: uiId, delta });
                  accumulatedText += delta;
                }
                break;
              }

              case 'text-end': {
                const mastraId = payload.id as string;
                const uiId = textPartIds.get(mastraId);
                if (uiId) {
                  writer.write({ type: 'text-end', id: uiId });
                  textPartIds.delete(mastraId);
                }
                break;
              }

              case 'tool-call': {
                const { toolCallId, toolName, args } = payload as {
                  toolCallId: string;
                  toolName: string;
                  args: Record<string, unknown>;
                };
                openToolCalls.set(toolCallId, toolName);
                writer.write({
                  type: 'tool-input-available',
                  toolCallId,
                  toolName,
                  input: args ?? {},
                });
                break;
              }

              case 'tool-result': {
                const { toolCallId, toolName, result: toolResult } = payload as {
                  toolCallId: string;
                  toolName: string;
                  result: Record<string, unknown> | null | undefined;
                };
                openToolCalls.delete(toolCallId);

                // Emit SQL table rows for the UI table renderer
                if (toolName === 'execute_sql' && toolResult?.rows) {
                  const rows = toolResult.rows as Record<string, unknown>[];
                  const columns = toolResult.columns as string[];
                  (writer as any).write({ type: 'sql-table-start', toolCallId, columns });
                  for (const row of rows) {
                    (writer as any).write({ type: 'sql-table-row', toolCallId, row });
                  }
                  (writer as any).write({ type: 'sql-table-end', toolCallId, rowCount: toolResult.rowCount });
                }

                // Emit generated SQL for the UI query display
                if (toolName === 'generate_sql' && toolResult?.sql) {
                  (writer as any).write({ type: 'sql-generated', toolCallId, sql: toolResult.sql, dialect: toolResult.dialect });
                }

                // Emit data-spec for visualization rendering
                if (toolName === 'render_visualization') {
                  const ds = (toolResult as any)?.dataSpec as DataSpecPayload | undefined;
                  if (ds?.componentType) {
                    writer.write({ type: 'data-spec', data: { componentType: ds.componentType, props: ds.props } });
                  }
                }

                writer.write({
                  type: 'tool-output-available',
                  toolCallId,
                  output: toolResult,
                });
                break;
              }

              case 'error': {
                const errorMsg =
                  payload.error instanceof Error
                    ? payload.error.message
                    : String(payload.error ?? payload.message ?? 'Agent error');
                this.logger.error({ threadId, error: payload.error }, 'Agent stream error event');
                for (const [, uiId] of textPartIds) writer.write({ type: 'text-end', id: uiId });
                textPartIds.clear();
                writer.write({ type: 'error', errorText: errorMsg });
                return;
              }

              default:
                break;
            }
          }

          // Close any text parts left open (defensive)
          for (const [, uiId] of textPartIds) writer.write({ type: 'text-end', id: uiId });
          textPartIds.clear();

          this.logger.info({ threadId, responseLength: accumulatedText.length }, 'Chat stream completed');
          await this.persistTurn(dto, accumulatedText, threadId);
        } catch (err) {
          for (const [, uiId] of textPartIds) writer.write({ type: 'text-end', id: uiId });
          textPartIds.clear();
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

      const lastUserMsg = [...dto.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        newMessages.push({
          id: lastUserMsg.id,
          sequence_index: seqBase++,
          role: 'user',
          message_type: 'text',
          content: lastUserMsg.content,
        });
      }

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

      if (!newMessages.length) return;

      const autoTitle = lastUserMsg?.content.slice(0, 80);
      await this.chatHistoryService.appendTurn({ sessionId, messages: newMessages, autoTitle });
      this.logger.info({ sessionId, threadId }, 'Chat history persisted');
    } catch (err) {
      this.logger.error({ err, threadId }, 'Failed to persist chat history');
    }
  }
}
