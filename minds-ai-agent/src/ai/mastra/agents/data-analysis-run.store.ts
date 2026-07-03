import { AsyncLocalStorage } from 'node:async_hooks';
import type { DuckdbRunScope } from '../../../duckdb/duckdb.service';
import type { VisualizationSpec } from '../../../analytics/analytics.types';

/**
 * Per-call context for the data-analysis (code-interpreter) agent, threaded
 * through AsyncLocalStorage (mirroring analyticsRunStore) so the
 * run_query/finalize tool closures resolve the right DuckDB scope even under
 * concurrent requests, without passing state through the LLM's tool-call args.
 *
 * The dataset has already been materialized into table `t` in {@link scope}
 * from whatever source (uploaded file, pasted JSON, or a SQL result set) — the
 * agent itself is source-agnostic and only ever queries `t`.
 */
export interface DataAnalysisRunContext {
  /** Loaded table alias every tool query runs against. */
  table: string;
  scope: DuckdbRunScope;
  iterations: number;
  final?: {
    sql: string;
    answer: string;
    columns: Array<{ name: string; type: string }>;
    rows: Record<string, unknown>[];
    rowCount: number;
    spec?: VisualizationSpec;
  };
}

export const dataAnalysisRunStore = new AsyncLocalStorage<DataAnalysisRunContext>();

export function currentDataRun(): DataAnalysisRunContext | undefined {
  return dataAnalysisRunStore.getStore();
}
