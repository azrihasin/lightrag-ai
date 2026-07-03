import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const extractTextFromPart = (part: unknown): string | null => {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return null;

  const record = part as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;

  return null;
};

const normalizeContent = (content: unknown, parts: unknown): string => {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const text = content.map(extractTextFromPart).filter((part): part is string => Boolean(part)).join('\n');
    return text || JSON.stringify(content);
  }

  if (Array.isArray(parts)) {
    const text = parts.map(extractTextFromPart).filter((part): part is string => Boolean(part)).join('\n');
    return text || JSON.stringify(parts);
  }

  return '';
};

export const MessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.unknown().optional(),
    parts: z.array(z.unknown()).optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
  })
  .passthrough()
  .superRefine((message, ctx) => {
    if (!normalizeContent(message.content, message.parts).trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Message must include text content or text parts.',
      });
    }
  })
  .transform((message) => {
    const content = normalizeContent(message.content, message.parts);

    return {
      id: message.id ?? randomUUID(),
      role: message.role,
      content,
      parts: [{ type: 'text' as const, text: content }],
      createdAt: message.createdAt,
    };
  });

export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  model: z.string().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  // sessionId: explicit session ID (legacy / backward compat)
  // id: AssistantUI thread ID sent by AssistantChatTransport (equals session ID)
  sessionId: z.string().optional(),
  id: z.string().optional(),
  // threadId: the real Mastra thread UUID sent explicitly by the frontend.
  // Preferred over `id`, which the AI SDK transport hardcodes to "DEFAULT_THREAD_ID".
  threadId: z.string().optional(),
  // resourceId: identifies the user (Mastra's resource lifecycle owner).
  // Sent by the frontend and stored on every Mastra thread + message.
  resourceId: z.string().optional(),
  enableUiDiscovery: z.boolean().optional().default(true),
  // Files uploaded via POST /api/files/upload before this message was sent.
  // ChatService appends a marker naming these so the master agent knows to
  // call the analyze_data tool instead of the database SQL pipeline.
  attachments: z
    .array(z.object({ fileId: z.string(), filename: z.string().optional() }))
    .optional(),
}).passthrough();

export type MessageDto = z.infer<typeof MessageSchema>;
export type ChatRequestDto = z.infer<typeof ChatRequestSchema>;
