import { z } from 'zod';

const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'agent', 'tool', 'thinking']);
const MessageTypeSchema = z.enum(['text', 'tool_call', 'tool_result', 'thinking', 'agent_event', 'error']);

export const AppendMessageSchema = z.object({
  id: z.string().uuid().optional(),
  parent_message_id: z.string().uuid().optional(),
  sequence_index: z.number().int().min(0),
  role: MessageRoleSchema,
  message_type: MessageTypeSchema.optional().default('text'),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tool_payload: z.record(z.string(), z.unknown()).optional(),
  thinking_payload: z.record(z.string(), z.unknown()).optional(),
  model_name: z.string().max(100).optional(),
  input_tokens: z.number().int().min(0).optional(),
  output_tokens: z.number().int().min(0).optional(),
});

export const AppendMessagesSchema = z.object({
  messages: z.array(AppendMessageSchema).min(1),
  auto_title: z.string().max(500).optional(),
});

export type AppendMessageDto = z.infer<typeof AppendMessageSchema>;
export type AppendMessagesDto = z.infer<typeof AppendMessagesSchema>;
