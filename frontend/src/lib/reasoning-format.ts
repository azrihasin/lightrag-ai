/**
 * Ghost reasoning render helper.
 *
 * The backend owns all reasoning wording (see minds-ai-agent's
 * analytics/reasoning-format.ts): each block streams one or more `### <title>`
 * headings — an active-progress title while the step runs ("Running the database
 * query") that is superseded by a past-tense outcome heading once it completes
 * ("Query returned 10 records"), followed by a short body. The frontend just
 * renders the *latest* heading as the title and the text after it as the body.
 */

export interface ReasoningDisplay {
  /** Latest heading = current state (active while running, outcome once done). */
  title: string;
  /** Text following the latest heading. */
  body: string;
}

/** Split a reasoning block's markdown into its current title + body. */
export function splitReasoningText(text: string): ReasoningDisplay {
  const src = text ?? "";
  const lines = src.split("\n");
  const headingRe = /^[ \t]*#{1,6}[ \t]+(.+)$/;
  const fenceRe = /^[ \t]*```/;

  // Find the last heading line that is NOT inside a fenced code block, so
  // markdown-looking content (e.g. retrieved schema context) never gets
  // mistaken for the block's title.
  let inFence = false;
  let titleLine = -1;
  let title = "";
  for (let i = 0; i < lines.length; i++) {
    if (fenceRe.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = headingRe.exec(lines[i]);
    if (m) {
      titleLine = i;
      title = m[1].trim();
    }
  }

  if (titleLine === -1) {
    return { title: "", body: src.trim() };
  }

  const body = lines.slice(titleLine + 1).join("\n").trim();
  return { title, body };
}

export interface LightragTiming {
  /** Estimated tokens of the request sent to LightRAG (query + schema prompt). */
  inputTokens: number;
  /** Estimated tokens of the response streamed back from LightRAG. */
  outputTokens: number;
  /** Time to first response chunk, in ms; undefined when nothing streamed back. */
  ttftMs?: number;
  /** Total wall-clock duration of the LightRAG call, in ms. */
  durationMs: number;
}

// The backend embeds LightRAG token/timing metrics in the retrieve-context block
// as an invisible `<!--lightrag-timing:{…}-->` comment (see chat.service.ts).
const LIGHTRAG_TIMING_RE = /<!--lightrag-timing:(\{[\s\S]*?\})-->/;

/**
 * Lift the LightRAG token/timing metrics out of a reasoning body. Returns the
 * parsed metrics plus the body with the comment stripped, or null when the body
 * carries no metrics. Call this first so the stripped `rest` flows through the
 * code-block / title parsers without the comment polluting them.
 */
export function extractLightragTiming(
  text: string,
): { timing: LightragTiming; rest: string } | null {
  const src = text ?? "";
  const m = LIGHTRAG_TIMING_RE.exec(src);
  if (!m) return null;
  const rest = (src.slice(0, m.index) + src.slice(m.index + m[0].length)).trim();
  try {
    return { timing: JSON.parse(m[1]) as LightragTiming, rest };
  } catch {
    return null;
  }
}

export interface ReasoningCodeBlock {
  /** Language tag after the opening fence (defaults to "json"). */
  lang: string;
  /** The code inside the fence, trimmed. */
  code: string;
  /** The body with the fence removed, trimmed — what the prose/source parser sees. */
  rest: string;
}

/**
 * Pull the first fenced code block out of a reasoning body. The backend appends
 * the raw LightRAG schema JSON as a ```json fence on the retrieve-context block;
 * we lift it out so the UI can render it as a real codeblock — and so the source
 * parser never mistakes the JSON's commas for a comma-separated table list.
 * Returns null when the body has no fence.
 */
export function extractCodeBlock(body: string): ReasoningCodeBlock | null {
  const text = body ?? "";
  const closed = /```(\w*)\n([\s\S]*?)```/.exec(text);
  if (closed) {
    const rest = (text.slice(0, closed.index) + text.slice(closed.index + closed[0].length)).trim();
    return { lang: closed[1] || "json", code: closed[2].trim(), rest };
  }
  // While the LightRAG response is still streaming, the fence has no closing
  // ``` yet — treat everything after the opening fence as the (growing) code so
  // it renders as a codeblock live instead of as raw prose.
  const open = /```(\w*)\n([\s\S]*)$/.exec(text);
  if (open) {
    const rest = text.slice(0, open.index).trim();
    return { lang: open[1] || "json", code: open[2].trim(), rest };
  }
  return null;
}

export interface ReasoningSources {
  /** Meaningful text preceding the source list (e.g. a recovery note); "" when none. */
  lead: string;
  /** The retrieved table/source names, rendered as badges instead of inline prose. */
  sources: string[];
}

/**
 * Detect a retrieve-context body that lists the relevant source tables and pull
 * the names out so the UI can render them as badges rather than a comma-joined
 * sentence. Returns null for bodies that are ordinary prose. The redundant
 * "Relevant sources:" label is dropped — the badges speak for themselves — but
 * any meaningful lead-in before it (e.g. a recovery note) is preserved.
 *
 * The backend already emits table names only (parsed from LightRAG's JSON
 * whitelist), so this just splits the list — no column filtering needed here.
 */
export function extractSources(body: string): ReasoningSources | null {
  const marker = /relevant sources:\s*/i;
  const match = marker.exec(body ?? "");
  if (!match) return null;

  const lead = body.slice(0, match.index).replace(/[\s—–-]+$/, "").trim();
  const sources = body
    .slice(match.index + match[0].length)
    .replace(/\.\s*$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (sources.length === 0) return null;
  return { lead, sources };
}
