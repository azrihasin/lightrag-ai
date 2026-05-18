export type MessageRole = 'user' | 'assistant' | 'system' | 'agent' | 'tool' | 'thinking';
export type MessageType = 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'agent_event' | 'error';

export interface ChatSession {
  id: string;
  user_id: string | null;
  title: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  metadata: Record<string, unknown> | null | undefined;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  parent_message_id: string | null;
  sequence_index: number;
  role: MessageRole;
  message_type: MessageType;
  content: string;
  metadata: Record<string, unknown> | null | undefined;
  tool_payload: Record<string, unknown> | null;
  thinking_payload: Record<string, unknown> | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

export interface NewMessage {
  id?: string;
  parent_message_id?: string;
  sequence_index: number;
  role: MessageRole;
  message_type?: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  tool_payload?: Record<string, unknown>;
  thinking_payload?: Record<string, unknown>;
  model_name?: string;
  input_tokens?: number;
  output_tokens?: number;
}
