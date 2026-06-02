/**
 * Worked examples for the reasoning activity-feed formatter
 * ({@link formatReasoningStep}).
 *
 * This project does not run tests (see the agent-dev skill). These examples
 * stand in as living documentation + a reference for the expected behaviour:
 *
 *   • loading states use active-progress wording,
 *   • completed states use past-tense, outcome wording,
 *   • raw backend labels ("Analyze intent", "Execute SQL", "Reasoned") never appear,
 *   • SQL/database steps surface row counts and limits when available,
 *   • errors are shown clearly without stack traces,
 *   • missing metadata falls back gracefully.
 *
 * Each entry records the formatter input and the `{ title, body }` it produces,
 * so the mapping can be eyeballed without running the service.
 */
import { formatReasoningStep, type ReasoningStepDisplay } from './reasoning-format';

export interface FormatterExample {
  name: string;
  display: ReasoningStepDisplay;
}

export const REASONING_FORMAT_EXAMPLES: FormatterExample[] = [
  // ── Loading states → active-progress wording (no body yet) ──────────────────
  {
    name: 'execute_sql · running → active label, raw label hidden',
    display: formatReasoningStep({ stepName: 'execute_sql', status: 'running' }),
    // → { title: "Running the database query", body: "" }
  },
  {
    name: 'retrieve_context · running',
    display: formatReasoningStep({ stepName: 'retrieve_context', status: 'running' }),
    // → { title: "Finding relevant context", body: "" }
  },

  // ── Completed states → past-tense outcomes from exact blackboard metadata ───
  {
    name: 'execute_sql · complete with row count, columns, runtime + limit',
    display: formatReasoningStep({
      stepName: 'execute_sql',
      status: 'complete',
      output: { rowCount: 10, columnCount: 3, executionMs: 24, limit: 10 },
    }),
    // → { title: "Query returned 10 records",
    //     body: "Returned 10 rows across 3 columns in 24 ms. Applied a limit of 10 rows." }
  },
  {
    name: 'execute_sql · empty result',
    display: formatReasoningStep({ stepName: 'execute_sql', status: 'complete', output: { rowCount: 0 } }),
    // → { title: "Query returned no records", body: "The query ran successfully but matched no rows." }
  },
  {
    name: 'execute_sql · failure reported in-band (no isError flag)',
    display: formatReasoningStep({
      stepName: 'execute_sql',
      status: 'complete',
      output: { rowCount: 0 },
      result: "The run_sql tool returned an error: Unknown column 'foo'.\n    at Query.run (db.js:12)",
    }),
    // → { title: "The query couldn't run", body: "The run_sql tool returned an error: Unknown column 'foo'." }
  },
  {
    name: 'retrieve_context · complete with discovered tables',
    display: formatReasoningStep({
      stepName: 'retrieve_context',
      status: 'complete',
      result:
        'Looking up the relevant database schema. The `minds.cell5g` and `minds.site` tables describe the network cells.',
    }),
    // → { title: "Found 2 relevant tables", body: "Relevant sources: minds.cell5g, minds.site." }
  },
  {
    name: 'generate_sql · complete, concise query summary (no raw dump)',
    display: formatReasoningStep({
      stepName: 'generate_sql',
      status: 'complete',
      output: { sql: 'SELECT cell_id, signal FROM minds.cell5g LIMIT 10' },
    }),
    // → { title: "Prepared a read-only query",
    //     body: "Prepared a read-only query over `minds.cell5g`, limited to 10 rows." }
  },
  {
    name: 'validate_sql · complete, safe',
    display: formatReasoningStep({ stepName: 'validate_sql', status: 'complete', output: { valid: true } }),
    // → { title: "Confirmed the query is safe",
    //     body: "The query is a read-only SELECT and is allowed to run." }
  },
  {
    name: 'validate_sql · complete, unsafe (shown as failure, not crash)',
    display: formatReasoningStep({
      stepName: 'validate_sql',
      status: 'complete',
      output: { valid: false },
      result: 'The query contains a forbidden keyword and cannot be run.',
    }),
    // → { title: "Query failed safety checks", body: "The query contains a forbidden keyword and cannot be run." }
  },
  {
    name: 'generate_visualization · complete with chosen component',
    display: formatReasoningStep({
      stepName: 'generate_visualization',
      status: 'complete',
      output: { componentType: 'BarChart' },
    }),
    // → { title: "Chose a bar chart", body: "Selected a bar chart for this result." }
  },
  {
    name: 'generate_visualization · flat list → table by default, not a forced chart',
    display: formatReasoningStep({
      stepName: 'generate_visualization',
      status: 'complete',
      output: { componentType: 'DataTable' },
    }),
    // → { title: "Chose a table",
    //     body: "A table is the best display for this result — a flat list of records with
    //            no meaningful aggregate, comparison, trend, ranking, or distribution to chart." }
  },

  // ── Recovery after a failure → bridged, never a fresh unrelated step ─────────
  {
    name: 'retrieve_context · recovery after a failed query (labelled as recovery)',
    display: formatReasoningStep({
      stepName: 'retrieve_context',
      status: 'complete',
      result: 'The `minds.cell5g` table holds the signal column; `signal_strength` does not exist.',
      recovery: { failedStepKey: 'execute_sql', announced: false },
    }),
    // → { title: "Rechecked the schema after the query failed",
    //     body: "Re-examined the available fields — relevant sources: minds.cell5g." }
  },
  {
    name: 'generate_sql · recovery, failure named once (announced) so it is not replayed',
    display: formatReasoningStep({
      stepName: 'generate_sql',
      status: 'complete',
      output: { sql: 'SELECT cell_id, signal FROM minds.cell5g LIMIT 10' },
      recovery: { failedStepKey: 'execute_sql', announced: true },
    }),
    // → { title: "Revised the query",
    //     body: "Rewrote it as a read-only query over `minds.cell5g`, limited to 10 rows." }
  },
  {
    name: 'execute_sql · retry succeeds → success tied to the revised attempt',
    display: formatReasoningStep({
      stepName: 'execute_sql',
      status: 'complete',
      output: { rowCount: 10, columnCount: 2, executionMs: 18, limit: 10 },
      recovery: { failedStepKey: 'execute_sql', announced: true },
    }),
    // → { title: "Query returned 10 records using the revised query",
    //     body: "Returned 10 rows across 2 columns in 18 ms using the revised query. Applied a limit of 10 rows." }
  },

  // ── Errors → clear, no stack traces ─────────────────────────────────────────
  {
    name: 'execute_sql · error status, stack frames stripped',
    display: formatReasoningStep({
      stepName: 'execute_sql',
      status: 'error',
      error: "Unknown column 'foo' in 'field list'.\n    at Query.run (db.js:120)\n    at process",
    }),
    // → { title: "The query couldn't run", body: "Unknown column 'foo' in 'field list'." }
  },

  // ── Missing metadata → truthful graceful fallback ───────────────────────────
  {
    name: 'execute_sql · complete, no metadata at all',
    display: formatReasoningStep({ stepName: 'execute_sql', status: 'complete' }),
    // → { title: "Ran the database query", body: "Completed the query." }
  },
  {
    name: 'unknown step · complete, generic fallback',
    display: formatReasoningStep({ stepName: 'compose_final_response', status: 'complete' }),
    // → { title: "Completed this step", body: "" }
  },
];
