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
  /** SQL recorded by the generate_sql subagent (record_sql tool). */
  sql?: string;
  /** Whether validate_sql passed; populated by the validate_sql tool. */
  sqlValid?: boolean;
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
}

export const ANALYTICS_RUN_KEY = 'analyticsRun';

export function createRunContext(): AnalyticsRunContext {
  return { rows: [], columns: [], rowCount: 0 };
}
