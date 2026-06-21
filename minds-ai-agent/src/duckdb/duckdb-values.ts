/**
 * Normalize DuckDB JS values into JSON-safe primitives for the frontend and the
 * blackboard. DuckDB returns BIGINT/HUGEINT as `bigint` (not JSON-serializable)
 * and temporal types as `Date`; coerce both to renderer-friendly values.
 */
export function toJsValue(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    // Drop the time part for pure dates (midnight UTC).
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  // Structured/decimal values fall back to string form.
  return String(v);
}

export function normalizeRow(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, val] of Object.entries(row)) out[k] = toJsValue(val);
  return out;
}

export function normalizeRows(
  rows: Record<string, unknown>[],
): Record<string, string | number | boolean | null>[] {
  return rows.map(normalizeRow);
}
