import { Injectable } from '@nestjs/common';
import { ANALYSIS_DATASET_TABLE, type DuckdbRunScope } from '../../duckdb/duckdb.service';
import { toJsValue } from '../../duckdb/duckdb-values';
import {
  classifySemanticType,
  isLatName,
  isLngName,
  type SemanticType,
} from '../schema/schema-metadata.types';
import type { OutputColumn } from '../plan/dataset-plan.types';

function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

type Cell = string | number | boolean | null;

/** Insert rows in bounded batches to keep each statement size reasonable. */
const INSERT_BATCH = 500;

/** ISO-8601-ish date/datetime string, e.g. `2024-01-31` or `2024-01-31T08:00`. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

/**
 * Loads MariaDB-retrieved rows into the per-run DuckDB scratch `analysis_dataset`
 * table and infers per-column output metadata.
 *
 * DuckDB never queries the source database here — the rows have ALREADY been
 * retrieved through Drizzle/MariaDB by execute_sql. This service only ingests
 * those rows so the (unchanged) result profiler, safe-insights service, and
 * viz-JSON compiler can shape the visualization in DuckDB. The semantic types /
 * roles that the DatasetPlan used to provide are inferred here from the column
 * names + observed values instead.
 */
@Injectable()
export class DatasetIngestService {
  readonly datasetTable = ANALYSIS_DATASET_TABLE;

  /**
   * Materialize `analysis_dataset` from the retrieved rows and return the
   * inferred {@link OutputColumn}[] (alias + role + semanticType) the downstream
   * profiler / viz compiler key off.
   */
  async ingest(
    scope: DuckdbRunScope,
    columns: Array<{ name: string }>,
    rows: Record<string, unknown>[],
  ): Promise<OutputColumn[]> {
    const names = columns.map((c) => c.name);

    // Coerce every value to a JSON-safe primitive once (Date → ISO, bigint → number).
    const normalized: Record<string, Cell>[] = rows.map((r) => {
      const out: Record<string, Cell> = {};
      for (const n of names) out[n] = toCell(r[n]);
      return out;
    });

    const outputs: OutputColumn[] = names.map((name) => {
      const semanticType = inferSemanticType(
        name,
        normalized.map((r) => r[name]),
      );
      // Numeric measures are metrics; everything else (categorical, temporal,
      // geo, identifier, text) is a dimension — the same split the profiler uses.
      const role: OutputColumn['role'] = semanticType === 'numeric' ? 'metric' : 'dimension';
      return { alias: name, role, semanticType };
    });

    const table = `${q(scope.schema)}.${q(this.datasetTable)}`;
    const colDefs = outputs.map((o) => `${q(o.alias)} ${duckType(o.semanticType)}`).join(', ');
    await scope.run(`DROP TABLE IF EXISTS ${table}`);
    await scope.run(`CREATE TABLE ${table} (${colDefs})`);

    if (normalized.length > 0) {
      const colList = names.map((n) => q(n)).join(', ');
      for (let i = 0; i < normalized.length; i += INSERT_BATCH) {
        const slice = normalized.slice(i, i + INSERT_BATCH);
        const valuesSql = slice
          .map((row) => `(${names.map((n) => lit(row[n])).join(', ')})`)
          .join(', ');
        await scope.run(`INSERT INTO ${table} (${colList}) VALUES ${valuesSql}`);
      }
    }

    return outputs;
  }
}

/** Normalize a raw MariaDB cell value into a JSON-safe primitive. */
function toCell(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return toJsValue(v);
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  // Decimals / Buffers / structured values fall back to their string form.
  return String(v);
}

/**
 * Infer a column's semantic type from its name + observed values. Mirrors the
 * catalog's {@link classifySemanticType} heuristics (geo wins for lat/lng, *_id
 * is an identifier) but works from runtime values rather than DB column types.
 */
function inferSemanticType(name: string, values: Cell[]): SemanticType {
  const nonNull = values.filter((v) => v != null);

  if (nonNull.length > 0 && nonNull.every((v) => typeof v === 'number')) {
    if (isLatName(name) || isLngName(name)) return 'geo';
    // Reuse name-based id detection; a numeric *_id is an identifier, not a metric.
    return classifySemanticType(name, 'double', null);
  }

  if (nonNull.length > 0 && nonNull.every((v) => typeof v === 'boolean')) return 'categorical';

  if (nonNull.length > 0 && nonNull.every((v) => typeof v === 'string' && ISO_DATE_RE.test(v))) {
    return 'temporal';
  }

  const maxLen = nonNull.reduce<number>((m, v) => Math.max(m, String(v).length), 0);
  return classifySemanticType(name, 'varchar', maxLen || 1);
}

/** DuckDB storage type for an ingested column. */
function duckType(t: SemanticType): string {
  // Geo/numeric → DOUBLE. Temporal stays VARCHAR (ISO strings): MIN/MAX still
  // orders correctly and avoids brittle TIMESTAMP casts of mixed date formats.
  return t === 'numeric' || t === 'geo' ? 'DOUBLE' : 'VARCHAR';
}

/** Render a normalized cell as a safe DuckDB SQL literal. */
function lit(v: Cell): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}
