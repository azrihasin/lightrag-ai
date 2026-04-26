export type SseEventType =
  | 'start'
  | 'progress'
  | 'tool-input-available'
  | 'pre-tool-text-delta'
  | 'pre-tool-text-complete'
  | 'tool-output-available'
  | 'post-tool-text-delta'
  | 'post-tool-text-complete'
  | 'text-start'
  | 'text-delta'
  | 'text-end'
  | 'data-spec'
  | 'finish'
  | 'error';

export interface SseEventPayload {
  type: SseEventType;
  data: unknown;
  id?: string;
}

export interface ToolInputPayload {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface ToolOutputPayload {
  toolName: string;
  toolCallId: string;
  output: unknown;
  sanitized: boolean;
  durationMs: number;
}

export interface TextDeltaPayload {
  delta: string;
}

export interface DataSpecPayload {
  componentType: UiComponentType;
  props: Record<string, unknown>;
  patch?: JsonPatchOperation[];
}

export type UiComponentType =
  | 'text'
  | 'table'
  | 'chart'
  | 'weather-card'
  | 'metric-card'
  | 'list'
  | 'json-tree';

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export interface FinishPayload {
  usage?: { promptTokens: number; completionTokens: number };
  durationMs: number;
  toolsUsed: string[];
  componentType?: UiComponentType;
}

export interface ProgressPayload {
  phase: 1 | 2 | 3;
  message: string;
}
