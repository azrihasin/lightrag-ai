import type { DuckdbRunScope } from '../duckdb/duckdb.service';
import type { DatasetPlan, OutputColumn, ResolvedDatasetPlan } from './plan/dataset-plan.types';
import type { ResultProfile } from './profile/result-profile.types';
import type { SafeInsights } from './profile/safe-insights.types';
import type { ResolvedVizPlan } from './viz/viz-plan.types';

export type IntentAnalysis = {
  rawQuestion: string;
  intentSummary: string;
  requestedVisualization?: string;
  assumptions?: string[];
};

export type RetrievedContext = {
  query: string;
  answer: string;
  documents: Array<{ text: string; title: string; score: number }>;
  references: Array<{ path?: string; title?: string; score?: number }>;
  sufficient: boolean;
  contextSummary: string;
};

export type SqlGenerationResult = {
  sql: string;
  explanation: string;
  assumptions: string[];
  confidence: number;
};

export type SqlValidationResult = {
  valid: boolean;
  normalizedSql: string;
  reason?: string;
};

export type ExecutionResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  executedSql: string;
  columns: Array<{ name: string; type: string }>;
  executionMs: number;
};

export type WorkflowStepKey =
  | 'analyze_intent'
  | 'retrieve_context'
  | 'generate_sql'
  | 'validate_sql'
  | 'execute_sql'
  | 'summarize_result'
  | 'generate_visualization';

export type WorkflowStepEvent = {
  key: WorkflowStepKey;
  /** Human-readable label shown as the reasoning block title. */
  label: string;
  status: 'running' | 'complete' | 'error';
  /** Markdown body streamed into the reasoning block. */
  text: string;
};

/** Callback invoked at the start and completion of each workflow step. */
export type WorkflowStepReporter = (event: WorkflowStepEvent) => void | Promise<void>;

export type WorkflowOutput = {
  answer: string;
  sql: string;
  rows: Record<string, unknown>[];
  columns: Array<{ name: string; type: string }>;
  visualizationSpec: Record<string, unknown>;
  metadata: {
    rowCount: number;
    contextReferences: Array<{ path?: string; title?: string; score?: number }>;
  };
};

/**
 * Token + timing accounting for a single LightRAG `/query/stream` call. The
 * endpoint returns no usage figures, so both token counts are computed with
 * `gpt-tokenizer` over the text we send / receive. Surfaced in the
 * retrieve_context reasoning block as a message-timing-style badge.
 */
export type LightragMetrics = {
  /** Estimated tokens of the request sent to LightRAG (query + schema prompt). */
  inputTokens: number;
  /** Estimated tokens of the response streamed back from LightRAG. */
  outputTokens: number;
  /** Time to first response chunk, in ms; undefined when nothing streamed back. */
  ttftMs?: number;
  /** Total wall-clock duration of the LightRAG call, in ms. */
  durationMs: number;
};

/**
 * A json-render visualization payload the frontend can render directly:
 * `componentType` is a catalog component key and `props` satisfy that
 * component's schema (chart components embed `data` inline).
 */
export type VisualizationSpec = {
  componentType: string;
  props: Record<string, unknown>;
};

/**
 * Per-request "blackboard" shared across the multi-agent network via Mastra's
 * `requestContext`. Subagent tools write structured results here so real row
 * data and the chosen visualization reach the frontend without being forced
 * through the LLM. Stored under {@link ANALYTICS_RUN_KEY}.
 */
export interface AnalyticsRunContext {
  /** Read-only MariaDB SELECT recorded by the generate_sql subagent (record_sql tool). */
  sql?: string;
  /** Whether validate_sql passed; populated by the validate_sql tool. */
  sqlValid?: boolean;

  // ── DuckDB visualization scope ───────────────────────────────────────────────
  /** Per-run DuckDB scratch scope (connection + scratch schema). Disposed at run end. */
  duckdb?: DuckdbRunScope;
  /** @deprecated legacy DatasetPlan pipeline — no longer populated. */
  datasetPlan?: DatasetPlan;
  /** @deprecated legacy DatasetPlan pipeline — no longer populated. */
  resolvedPlan?: ResolvedDatasetPlan;
  /**
   * Output columns of analysis_dataset (alias + role + semantic type), inferred
   * from the retrieved rows by DatasetIngestService and consumed by the profiler
   * + viz-JSON compiler.
   */
  datasetOutputs?: OutputColumn[];
  /** How many times record_dataset_plan ran this turn (bounded-retry ceiling). */
  planAttempts?: number;
  /**
   * Why the dataset plan could not be prepared, in user-facing language (the
   * validator's errors, or the attempt-limit message). Set by plan_dataset when
   * record_dataset_plan fails so the generate_sql reasoning block and the final
   * answer can state the actual reason instead of a generic "couldn't prepare".
   */
  planError?: string;
  /** True once analysis_dataset has been materialized in DuckDB. */
  analysisDatasetReady?: boolean;
  /** The compiled DuckDB SELECT (for transparency in the reasoning feed). */
  compiledSql?: string;
  /** Metadata-only profile of analysis_dataset (no rows); set by execute_dataset. */
  resultProfile?: ResultProfile;
  /** Resolved visualization plan from the plan_visualization subagent. */
  vizPlan?: ResolvedVizPlan;
  /** Bounded approved aggregate facts for the summarizer (no rows). */
  safeInsights?: SafeInsights;
  /**
   * How many times run_sql has been invoked this turn. Incremented by the
   * execute_sql tool and used to hard-cap the recovery retry loop (see
   * MAX_EXECUTE_ATTEMPTS) so a repeatedly-failing query can't spin the agent
   * indefinitely and burn tokens.
   */
  executeAttempts?: number;
  /** Executed rows + columns, populated by the execute_sql tool (run_sql). */
  rows: Record<string, unknown>[];
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  /** Visualization chosen by the generate_visualization subagent. */
  spec?: VisualizationSpec;
  /**
   * The component name the generate_visualization subagent chose, recorded even
   * when it chose a plain table (in which case {@link spec} stays unset and the
   * executed rows render as a data table only — no forced chart).
   */
  vizChoice?: string;
  /**
   * Full schema context retrieved from LightRAG by the retrieve_context tool.
   * Surfaced verbatim in that step's reasoning block (as a code block) so the
   * user can see exactly what context the SQL was written against.
   */
  retrievedContext?: string;
  /** References (source files) cited by the LightRAG retrieval. */
  contextReferences?: Array<{ path?: string; title?: string; score?: number }>;
  /**
   * Estimated input/output token counts and timing for the LightRAG retrieval,
   * set by the retrieve_context tool. Rendered in that step's reasoning block as
   * a message-timing-style badge.
   */
  lightragMetrics?: LightragMetrics;
  /**
   * Live sink for the LightRAG `/query/stream` response, set ONLY on the chat
   * agent path. The retrieve_context tool calls {@link onLightragChunk} with each
   * streamed chunk of the endpoint's raw response and {@link onLightragEnd} once
   * the stream finishes, so the chat service can build the response live in the
   * reasoning block as a fenced code block. Left unset on the workflow path
   * (which has no live reasoning UI) — the tool then just accumulates the full
   * response into {@link retrievedContext} as before.
   */
  onLightragChunk?: (delta: string) => void;
  onLightragEnd?: () => void;
}

export const ANALYTICS_RUN_KEY = 'analyticsRun';

export function createRunContext(): AnalyticsRunContext {
  return { rows: [], columns: [], rowCount: 0 };
}
