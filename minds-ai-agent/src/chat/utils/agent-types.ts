import type { RunnableConfig } from '@langchain/core/runnables';

export interface NodeStartEvent {
  type: 'node:start';
  node: string;
  data?: Record<string, unknown>;
}

export interface NodeProgressEvent {
  type: 'node:progress';
  node: string;
  step: string;
  data?: unknown;
}

export type NodeCustomEvent = NodeStartEvent | NodeProgressEvent;

export interface SqlTableResultEvent {
  type: 'sql:final-table-result';
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface AgentConfig extends RunnableConfig {
  writer?: (event: NodeCustomEvent | SqlTableResultEvent) => void;
}
