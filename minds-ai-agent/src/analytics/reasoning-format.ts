/**
 * Reasoning activity-feed formatting layer (backend-owned).
 *
 * The chat agent surfaces each subagent step as a ghost reasoning block. Rather
 * than streaming mechanical labels ("Analyze intent", "Generate SQL") and raw
 * subagent narration (which opens with filler like "Let me figure out…"), the
 * backend produces a natural, Claude-Code / Cursor / Codex-style activity feed:
 *
 *   • while a step runs  → a short active-progress title ("Finding relevant
 *     context", "Running the database query").
 *   • once a step completes → a past-tense, outcome title generated from the
 *     step's ACTUAL metadata ("Found 3 relevant tables", "Query returned 10
 *     records") plus 1–3 concise sentences.
 *
 * Outcome specifics come from the per-run blackboard ({@link AnalyticsRunContext})
 * — exact row counts, the recorded SQL, the validity flag, the chosen component
 * — so nothing is guessed or fabricated. When a value is unavailable it falls
 * back to a truthful generic line ("Checked available context", "Completed this
 * step"). The frontend simply renders the title + body this returns.
 *
 * Two cross-cutting rules keep the feed coherent:
 *   • Recovery bridging — after a step fails, the caller passes a
 *     {@link RecoveryContext} so the next visible step reads as a recovery
 *     ("Rechecked the schema after the query failed", "Query returned 10 records
 *     using the revised query") instead of an unrelated fresh discovery. Errors
 *     are summarized in safe, user-facing language with no stack traces.
 *   • Honest presentation — a flat list with no aggregate/trend/ranking to chart
 *     is shown as a table ("Chose a table"), never a forced bar chart.
 */

export type ReasoningStepStatus = 'running' | 'complete' | 'error';

/** Exact, structured metadata for a step (read from the run blackboard / tool result). */
export interface ReasoningStepOutput {
  sql?: string;
  valid?: boolean;
  rowCount?: number;
  columnCount?: number;
  executionMs?: number;
  limit?: number;
  componentType?: string;
  referenceCount?: number;
}

/**
 * Cross-step recovery context. The formatter itself is per-step and pure, but
 * the caller tracks whether an earlier step failed so the *next* visible step
 * can be worded as a recovery (a bridge) rather than an unrelated fresh start.
 */
export interface RecoveryContext {
  /** The earlier step whose failure this run is currently recovering from. */
  failedStepKey: StepKey;
  /**
   * Whether the failure was already named in an earlier visible block. The
   * first recovery step spells out the bridge ("after the query failed"); later
   * steps in the same recovery use lighter "revised" wording so the feed does
   * not replay the failure on every block.
   */
  announced: boolean;
}

export interface ReasoningStepInput {
  /** Subagent key or human label, e.g. "execute_sql" or "Execute SQL (MariaDB)". */
  stepName: string;
  status: ReasoningStepStatus;
  /** Exact structured metadata; preferred over parsing `result`. */
  output?: ReasoningStepOutput | null;
  /** Freeform subagent narration (used for narrative steps + as a fallback). */
  result?: string | null;
  /** Error message when the step failed (stack traces are stripped). */
  error?: string | null;
  /**
   * Set when an earlier step in this run failed and has not yet been resolved.
   * Drives recovery wording ("Rechecked the schema after the query failed",
   * "Query returned 10 records using the revised query").
   */
  recovery?: RecoveryContext | null;
}

export interface ReasoningStepDisplay {
  /** Short active (running) or outcome (past-tense) line. Never a raw backend label. */
  title: string;
  /** 0–3 short sentences elaborating the outcome; "" when there is nothing useful to add. */
  body: string;
  /**
   * True when this step's outcome is a failure (status error, or an in-band
   * failure detected from the metadata/narration). The caller uses this to open
   * a recovery on the following step.
   */
  failed?: boolean;
}

export type StepKey =
  | 'analyze_intent'
  | 'retrieve_context'
  | 'generate_sql'
  | 'validate_sql'
  | 'execute_sql'
  | 'summarize_result'
  | 'generate_visualization'
  | 'unknown';

const RUNNING_TITLE: Record<StepKey, string> = {
  analyze_intent: 'Interpreting your request',
  retrieve_context: 'Finding relevant context',
  generate_sql: 'Preparing a safe query',
  validate_sql: 'Checking the query is safe',
  execute_sql: 'Running the database query',
  summarize_result: 'Reviewing the returned records',
  generate_visualization: 'Choosing how to present the result',
  unknown: 'Working through this step',
};

const COMPLETE_FALLBACK_TITLE: Record<StepKey, string> = {
  analyze_intent: 'Interpreted your request',
  retrieve_context: 'Checked available context',
  generate_sql: 'Prepared a read-only query',
  validate_sql: 'Checked the query is safe',
  execute_sql: 'Ran the database query',
  summarize_result: 'Reviewed the result',
  generate_visualization: 'Chose how to present the result',
  unknown: 'Completed this step',
};

const ERROR_TITLE: Record<StepKey, string> = {
  analyze_intent: "Couldn't interpret the request",
  retrieve_context: "Couldn't find enough context",
  generate_sql: "Couldn't prepare a safe query",
  validate_sql: 'Query failed safety checks',
  execute_sql: "The query couldn't run",
  summarize_result: "Couldn't review the result",
  generate_visualization: "Couldn't choose a visualization",
  unknown: "This step didn't complete",
};

/** Map a subagent key or human label onto a canonical step. */
export function resolveStepKey(name: string): StepKey {
  const n = name.toLowerCase();
  if (/intent/.test(n)) return 'analyze_intent';
  if (/context|lightrag|schema|retriev/.test(n)) return 'retrieve_context';
  if (/validat/.test(n)) return 'validate_sql';
  if (/visuali|chart|graph|\bplot\b|\bmap\b|render/.test(n)) return 'generate_visualization';
  if (/(generat|writ|prepar|build).*sql/.test(n)) return 'generate_sql';
  if (/(execut|run).*(sql|quer|mariadb|database)|^sql/.test(n)) return 'execute_sql';
  if (/summar/.test(n)) return 'summarize_result';
  return 'unknown';
}

// ─── Recovery wording ───────────────────────────────────────────────────────
//
// When an earlier step failed, the next visible step must read as a recovery
// that bridges from the failure — never as an unrelated fresh discovery. The
// first recovery block names the failure ("…after the query failed"); later
// blocks drop the clause and lean on "revised"/"re-" wording so the failure is
// stated once, not replayed.

/** A short, safe clause naming what went wrong, e.g. "after the query failed". */
function failureClause(failedStepKey: StepKey): string {
  switch (failedStepKey) {
    case 'execute_sql':
      return 'after the query failed';
    case 'validate_sql':
      return 'after the safety check failed';
    case 'generate_sql':
      return "after the query couldn't be prepared";
    case 'retrieve_context':
      return 'after the first lookup fell short';
    case 'analyze_intent':
      return 'after re-reading the request';
    default:
      return 'after the previous step failed';
  }
}

/** Active (running) title for a step that is part of an in-progress recovery. */
function recoveryRunningTitle(key: StepKey, recovery: RecoveryContext): string {
  const clause = recovery.announced ? '' : ` ${failureClause(recovery.failedStepKey)}`;
  switch (key) {
    case 'analyze_intent':
      return `Re-interpreting your request${clause}`;
    case 'retrieve_context':
      return `Rechecking the schema${clause}`;
    case 'generate_sql':
      return `Revising the query${clause}`;
    case 'validate_sql':
      return 'Re-checking the revised query is safe';
    case 'execute_sql':
      return `Re-running the revised query${clause}`;
    case 'summarize_result':
      return 'Reviewing the revised result';
    case 'generate_visualization':
      return RUNNING_TITLE.generate_visualization;
    default:
      return `Retrying this step${clause}`;
  }
}

// ─── Text utilities ───────────────────────────────────────────────────────────

function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const FILLER_LEAD =
  /^(let me\b|let'?s\b|i'?ll\b|i will\b|i'?m going to\b|i am going to\b|now\b|first,?\b|okay\b|sure\b|alright\b|here'?s\b|to answer\b|to do this\b|looking up\b|look(ing)? at\b|writing\b|running\b|checking\b|choosing\b|going to\b|figur(e|ing)\b|summari[sz]ing\b|analy[sz]ing\b|thinking\b|processing\b|working on it\b)/i;

/** Strip the subagent's lead-in announcement/filler and keep the first substantive sentences. */
function cleanNarration(text: string, maxSentences = 2): string {
  const sentences = splitSentences(plain(text));
  let i = 0;
  while (i < sentences.length && FILLER_LEAD.test(sentences[i])) i += 1;
  const kept = sentences.slice(i, i + maxSentences);
  return kept.length === 0 ? '' : kept.join(' ');
}

/** Strip stack-trace frames and over-long detail from an error message. */
function cleanError(text: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^at\s/.test(l))[0];
  const msg = (firstLine ?? text).replace(/^[⚠️\s]+/u, '').trim();
  const sentence = splitSentences(msg)[0] ?? msg;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Pull only the table names for the retrieve-context reasoning body. The retrieval
 * result is LightRAG's JSON whitelist `{ tables: [{ table, columns }] }`, so we
 * parse it and take exactly the `table` fields — never the `columns`. Falls back
 * to a qualified-identifier/backtick regex for non-JSON text (e.g. a recovery
 * narration), preserving first-seen order and de-duplicating.
 */
function extractTableNames(text: string): string[] {
  const fromJson = tableNamesFromJson(text);
  if (fromJson) return fromJson;

  const names = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)`/g)) names.add(m[1]);
  for (const m of text.matchAll(/\b([A-Za-z_][\w$]*\.[A-Za-z_][\w$]*)\b/g)) names.add(m[1]);
  return [...names];
}

/**
 * Parse a LightRAG schema whitelist and return its `table` names only, or null
 * when `text` isn't the expected `{ tables: [{ table, columns }] }` JSON.
 */
function tableNamesFromJson(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { tables?: unknown }).tables)
  ) {
    return null;
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of (parsed as { tables: unknown[] }).tables) {
    const name =
      typeof entry === 'string'
        ? entry
        : typeof (entry as { table?: unknown })?.table === 'string'
          ? (entry as { table: string }).table
          : undefined;
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** A one-line plain summary of a SELECT: the source table(s) and any row limit. */
function summarizeSql(sql: string): string {
  const from = sql.match(/\bfrom\s+`?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)`?/i);
  const limit = sql.match(/\blimit\s+(\d+)/i);
  const isAggregate = /\b(count|sum|avg|min|max|group\s+by)\b/i.test(sql);
  let summary = 'read-only query';
  if (from) summary = `read-only ${isAggregate ? 'aggregate ' : ''}query over \`${from[1]}\``;
  if (limit) summary += `, limited to ${plural(Number(limit[1]), 'row')}`;
  return summary;
}

const VIZ_PATTERNS: Array<[RegExp, string]> = [
  [/geo\s*map|\bmap\b/i, 'map'],
  [/bar\s*chart|barchart/i, 'bar chart'],
  [/line\s*chart|linechart/i, 'line chart'],
  [/area\s*chart|areachart/i, 'area chart'],
  [/pie\s*chart|piechart/i, 'pie chart'],
  [/scatter/i, 'scatter chart'],
  [/metric\s*card|metriccard/i, 'metric card'],
  [/data\s*table|datatable|\btable\b/i, 'table'],
  [/dashboard/i, 'dashboard'],
];

function vizLabel(componentType?: string, narration = ''): string | undefined {
  const haystack = `${componentType ?? ''} ${narration}`;
  for (const [re, label] of VIZ_PATTERNS) if (re.test(haystack)) return label;
  return undefined;
}

// ─── Core formatter ───────────────────────────────────────────────────────────

/**
 * Produce the reasoning UI `{ title, body }` for a single agent step. Pure and
 * side-effect free. Active verbs while running, past-tense once done; outcome
 * specifics are derived from `output`/`result` and never invented.
 */
export function formatReasoningStep(step: ReasoningStepInput): ReasoningStepDisplay {
  const key = resolveStepKey(step.stepName);
  const result = (step.result ?? '').trim();
  const out = step.output ?? {};
  const recovery = step.recovery ?? null;
  // Only the first recovery block spells out the failure; later ones stay light.
  const bridge = recovery && !recovery.announced ? ` ${failureClause(recovery.failedStepKey)}` : '';

  if (step.status === 'running') {
    return {
      title: recovery ? recoveryRunningTitle(key, recovery) : RUNNING_TITLE[key],
      body: '',
    };
  }

  if (step.status === 'error') {
    return { title: ERROR_TITLE[key], body: cleanError(step.error || result || ''), failed: true };
  }

  switch (key) {
    case 'analyze_intent':
      return {
        title: recovery ? `Re-interpreted your request${bridge}` : COMPLETE_FALLBACK_TITLE.analyze_intent,
        body: cleanNarration(result, 3) || 'Worked out what to look for.',
      };

    case 'retrieve_context': {
      const tables = extractTableNames(result);
      const refs = out.referenceCount;
      // After a failure, retrieval is recovery — never a fresh "Found N tables".
      if (recovery) {
        const body =
          cleanNarration(result, 2) || 'Re-examined the available tables and columns to correct the query.';
        return { title: `Rechecked the schema${bridge}`, body };
      }
      let title = COMPLETE_FALLBACK_TITLE.retrieve_context;
      if (tables.length > 0) title = `Found ${plural(tables.length, 'relevant table')}`;
      else if (typeof refs === 'number') title = `Found ${plural(refs, 'relevant reference')}`;
      const body = cleanNarration(result, 2) || 'Checked the available schema context.';
      return { title, body };
    }

    case 'generate_sql': {
      const sql = out.sql?.trim();
      // No query was recorded (e.g. a required table/column was not in the
      // retrieved context). This is a failure, not a silent success — surface it
      // so it isn't dressed as "Prepared a read-only query", and so the caller
      // opens a recovery on the following step.
      if (!sql) {
        return {
          title: ERROR_TITLE.generate_sql,
          body:
            cleanNarration(result, 2) ||
            'Could not prepare a query — the needed tables or columns were not in the available schema context.',
          failed: true,
        };
      }
      if (recovery) {
        return { title: `Revised the query${bridge}`, body: `Rewrote it as a ${summarizeSql(sql)}.` };
      }
      return { title: COMPLETE_FALLBACK_TITLE.generate_sql, body: `Prepared a ${summarizeSql(sql)}.` };
    }

    case 'validate_sql': {
      const unsafe =
        out.valid === false ||
        (out.valid === undefined &&
          /\b(unsafe|forbidden|cannot be run|not allowed|failed (?:read-only )?(?:safety )?validation|rejected|is invalid)\b/i.test(
            plain(result),
          ));
      if (unsafe) {
        return {
          title: ERROR_TITLE.validate_sql,
          body: cleanNarration(result, 2) || 'The query was rejected before running.',
          failed: true,
        };
      }
      return {
        title: recovery ? 'Re-checked the revised query is safe' : 'Confirmed the query is safe',
        body: `The ${recovery ? 'revised ' : ''}query is a read-only SELECT and is allowed to run.`,
      };
    }

    case 'execute_sql': {
      const { rowCount, columnCount, executionMs, limit } = out;
      // run_sql reports failures in-band (no isError flag), so a falsy rowCount
      // alongside error wording in the narration is a failure, not an empty set.
      if (!rowCount && /\b(error|failed|could ?n'?t run|exception|denied)\b/i.test(plain(result))) {
        return { title: ERROR_TITLE.execute_sql, body: cleanError(result), failed: true };
      }
      // A success here resolves any recovery: tie it back to the revised attempt.
      const revised = recovery ? ' using the revised query' : '';
      if (rowCount === 0) {
        return {
          title: `Query returned no records${revised}`,
          body: recovery
            ? 'The revised query ran successfully but still matched no rows.'
            : 'The query ran successfully but matched no rows.',
        };
      }
      if (typeof rowCount === 'number') {
        let detail = `Returned ${plural(rowCount, 'row')}`;
        if (columnCount) detail += ` across ${plural(columnCount, 'column')}`;
        if (executionMs) detail += ` in ${executionMs} ms`;
        if (revised) detail += revised;
        detail += '.';
        if (limit) detail += ` Applied a limit of ${plural(limit, 'row')}.`;
        return { title: `Query returned ${plural(rowCount, 'record')}${revised}`, body: detail };
      }
      return {
        title: `${COMPLETE_FALLBACK_TITLE.execute_sql}${revised}`,
        body: cleanNarration(result, 2) || 'Completed the query.',
      };
    }

    case 'summarize_result':
      return {
        title: recovery ? 'Reviewed the revised result' : COMPLETE_FALLBACK_TITLE.summarize_result,
        body: cleanNarration(result, 3) || 'Reviewed the returned records.',
      };

    case 'generate_visualization': {
      const viz = vizLabel(out.componentType, plain(result));
      // A table is the honest default for a flat list with no aggregate, trend,
      // ranking, or distribution to chart — state that rather than forcing a chart.
      if (viz === 'table' || (!viz && !out.componentType)) {
        return {
          title: 'Chose a table',
          body: 'A table is the best display for this result — a flat list of records with no meaningful aggregate, comparison, trend, ranking, or distribution to chart.',
        };
      }
      return {
        title: `Chose a ${viz}`,
        body: cleanNarration(result, 2) || `Selected a ${viz} for this result.`,
      };
    }

    default:
      return { title: COMPLETE_FALLBACK_TITLE.unknown, body: cleanNarration(result, 2) };
  }
}

/** Render a step's display as the markdown body of a reasoning block: `### title` + body. */
export function renderReasoningMarkdown(display: ReasoningStepDisplay): string {
  return display.body ? `### ${display.title}\n\n${display.body}` : `### ${display.title}`;
}
