/**
 * Deterministic schema metadata derived by introspecting the read-only attached
 * MariaDB through DuckDB. This is the authoritative source the DatasetPlan
 * validator and the result profiler check against — the LLM only ever sees
 * field *names* + semantic types, never any row data.
 */

export type SemanticType =
  | 'numeric'
  | 'temporal'
  | 'categorical'
  | 'geo'
  | 'text'
  | 'identifier';

export interface ColumnMeta {
  name: string;
  /** DuckDB-normalized data type (e.g. BIGINT, VARCHAR, DATE, DECIMAL(10,6)). */
  sqlType: string;
  semanticType: SemanticType;
  nullable: boolean;
}

export interface TableMeta {
  table: string;
  /** The schema the table lives in inside the attached MariaDB (e.g. `minds`). */
  schema: string;
  columns: ColumnMeta[];
}

export type SchemaCatalog = TableMeta[];

// ── Name / type heuristics (kept consistent with the geo regexes the old
// visualization agent used) ───────────────────────────────────────────────────
const LAT_RE = /(^|_)(lat|latitude)$/i;
const LNG_RE = /(^|_)(lng|lon|long|longitude)$/i;
const ID_RE = /(^id$)|(_id$)|(^id_)|(uuid$)/i;
const TEMPORAL_TYPE_RE = /^(date|time|timestamp|datetime|interval|year)/i;
const NUMERIC_TYPE_RE =
  /^(tinyint|smallint|int|integer|bigint|hugeint|ubigint|uinteger|usmallint|utinyint|decimal|numeric|real|double|float)/i;

export function isLatName(name: string): boolean {
  return LAT_RE.test(name);
}

export function isLngName(name: string): boolean {
  return LNG_RE.test(name);
}

/**
 * Classify a column's semantic type from its name + DuckDB data type. Geo wins
 * over numeric for lat/lng columns; *_id columns are identifiers (not metrics).
 */
export function classifySemanticType(
  name: string,
  dataType: string,
  maxLength: number | null,
): SemanticType {
  const t = dataType.toLowerCase();

  if (NUMERIC_TYPE_RE.test(t)) {
    if (isLatName(name) || isLngName(name)) return 'geo';
    if (ID_RE.test(name)) return 'identifier';
    return 'numeric';
  }

  if (TEMPORAL_TYPE_RE.test(t)) return 'temporal';
  if (t.startsWith('bool')) return 'categorical';
  if (ID_RE.test(name)) return 'identifier';

  // String types: short/bounded → categorical dimension, long/unbounded → free text.
  if (maxLength != null && maxLength > 0) return maxLength <= 64 ? 'categorical' : 'text';
  return 'categorical';
}

// ── Lookup helpers over a loaded catalog ────────────────────────────────────────

export function findTable(catalog: SchemaCatalog, table: string): TableMeta | undefined {
  return catalog.find((t) => t.table === table);
}

export function findColumn(
  catalog: SchemaCatalog,
  table: string,
  column: string,
): ColumnMeta | undefined {
  return findTable(catalog, table)?.columns.find((c) => c.name === column);
}
