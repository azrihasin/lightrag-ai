import { Parser } from 'node-sql-parser';

const parser = new Parser();

export type SchemaGroundingResult =
  | { grounded: true }
  | { grounded: false; reason: string; missing: string[] }
  | { grounded: 'unverifiable'; reason: string };

/**
 * Deterministic, parser-based guard against hallucinated identifiers.
 *
 * Rather than trusting the LLM to obey "only use names from the context", this
 * parses the recorded SQL into an AST, extracts every real table and column
 * identifier (aliases, functions, keywords and string literals are excluded by
 * the parser), and confirms each one appears verbatim in the retrieved LightRAG
 * schema context. Any identifier not found in the context is, by definition, a
 * name the model invented — so the query is rejected and the offending names are
 * returned so the model can correct itself.
 *
 * Matching is case-insensitive (SQL identifiers are case-insensitive) but
 * otherwise exact: `cell5g` will NOT match a context that only contains
 * `cell_5g`, which is precisely the hallucination class we want to catch.
 */
export function checkSchemaGrounding(sql: string, context: string): SchemaGroundingResult {
  const query = sql?.trim();
  if (!query) return { grounded: 'unverifiable', reason: 'No SQL to verify.' };
  if (!context?.trim()) {
    // No context to check against — let the read-only + execution steps decide.
    return { grounded: 'unverifiable', reason: 'No retrieved schema context to verify against.' };
  }

  let tableList: string[];
  let columnList: string[];
  try {
    ({ tableList, columnList } = parser.parse(query, { database: 'MariaDB' }));
  } catch {
    // Parser couldn't read the dialect/syntax — don't block; execution will catch
    // genuinely broken SQL and surface a precise DB error instead.
    return { grounded: 'unverifiable', reason: 'SQL could not be parsed for grounding.' };
  }

  // Entries look like `select::null::cell_id` (type::table::column) and
  // `select::null::cell_5g` (type::db::table). We only care about the actual
  // table/column identifiers (the last segment), skipping wildcards.
  const identifiers = new Set<string>();
  for (const entry of [...(tableList ?? []), ...(columnList ?? [])]) {
    const name = entry.split('::').pop();
    if (!name || name === 'null' || name === '(.*)' || name === '*') continue;
    identifiers.add(name);
  }

  const missing = [...identifiers].filter((name) => !appearsInContext(name, context));
  if (missing.length === 0) return { grounded: true };

  return {
    grounded: false,
    missing,
    reason:
      `These identifiers are NOT present in the retrieved schema context and appear to be ` +
      `hallucinated: ${missing.join(', ')}. Only use table and column names that appear verbatim ` +
      `in the context, copying their exact spelling (including underscores).`,
  };
}

/** True when `name` appears as a whole word in the context (case-insensitive). */
function appearsInContext(name: string, context: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').test(context);
}
