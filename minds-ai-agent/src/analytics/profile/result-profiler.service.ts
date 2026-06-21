import { Injectable } from '@nestjs/common';
import { toJsValue } from '../../duckdb/duckdb-values';
import { isLatName, isLngName } from '../schema/schema-metadata.types';
import type { OutputColumn, ResolvedDatasetPlan, TimeGrain } from '../plan/dataset-plan.types';
import { ANALYSIS_DATASET_TABLE, type DuckdbRunScope } from '../../duckdb/duckdb.service';
import type {
  CardinalityBucket,
  ChartFeasibility,
  ColumnProfile,
  ResultProfile,
} from './result-profile.types';

function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function bucketOf(distinct: number): CardinalityBucket {
  if (distinct <= 1) return 'one';
  if (distinct <= 6) return 'few';
  if (distinct <= 50) return 'manageable';
  return 'high';
}

const NUM = (v: unknown): number => Number(v ?? 0);

/**
 * Runs deterministic DuckDB aggregate queries over the scoped analysis_dataset
 * and returns a metadata-only {@link ResultProfile}. No raw rows or distinct
 * values are read — only counts, ranges (where allowed), and feasibility flags.
 */
@Injectable()
export class ResultProfilerService {
  async profile(
    scope: DuckdbRunScope,
    outputs: OutputColumn[],
    resolvedPlan?: ResolvedDatasetPlan,
  ): Promise<ResultProfile> {
    const table = `${q(scope.schema)}.${q(ANALYSIS_DATASET_TABLE)}`;

    // One pass: row count + per-column distinct/null counts and (where allowed) min/max.
    const selects: string[] = ['COUNT(*) AS __rowcount'];
    for (const o of outputs) {
      const c = q(o.alias);
      selects.push(`COUNT(DISTINCT ${c}) AS ${q(`${o.alias}__distinct`)}`);
      selects.push(`(COUNT(*) - COUNT(${c})) AS ${q(`${o.alias}__nulls`)}`);
      if (o.semanticType === 'numeric' || o.semanticType === 'temporal') {
        selects.push(`MIN(${c}) AS ${q(`${o.alias}__min`)}`);
        selects.push(`MAX(${c}) AS ${q(`${o.alias}__max`)}`);
      }
    }

    const [agg] = await scope.all<Record<string, unknown>>(
      `SELECT ${selects.join(', ')} FROM ${table}`,
    );
    const rowCount = NUM(agg?.__rowcount);

    const columns: ColumnProfile[] = outputs.map((o) => {
      const distinctCount = NUM(agg?.[`${o.alias}__distinct`]);
      const nullCount = NUM(agg?.[`${o.alias}__nulls`]);
      const profile: ColumnProfile = {
        name: o.alias,
        role: o.role,
        semanticType: o.semanticType,
        nullCount,
        distinctCount,
        cardinalityBucket: bucketOf(distinctCount),
      };
      if (o.semanticType === 'numeric' || o.semanticType === 'temporal') {
        const min = toJsValue(agg?.[`${o.alias}__min`]);
        const max = toJsValue(agg?.[`${o.alias}__max`]);
        if (min != null) profile.min = min as number | string;
        if (max != null) profile.max = max as number | string;
        if (o.semanticType === 'numeric' && typeof min === 'number' && typeof max === 'number') {
          profile.range = max - min;
        }
      }
      return profile;
    });

    const dims = columns.filter((c) => c.role === 'dimension');
    const metrics = columns.filter((c) => c.role === 'metric');
    const temporalDims = dims.filter((c) => c.semanticType === 'temporal');
    const categoricalDims = dims.filter((c) =>
      ['categorical', 'text', 'identifier'].includes(c.semanticType),
    );

    const latCol = dims.find((c) => c.semanticType === 'geo' && isLatName(c.name));
    const lngCol = dims.find((c) => c.semanticType === 'geo' && isLngName(c.name));
    const geoAvailable = !!(latCol && lngCol);

    const lowCardCat = categoricalDims.find((c) =>
      ['few', 'manageable'].includes(c.cardinalityBucket),
    );

    const feasibility: ChartFeasibility = {
      kpi: rowCount === 1 && metrics.length === 1 && dims.length === 0,
      line: rowCount > 1 && temporalDims.length >= 1 && metrics.length >= 1,
      bar: rowCount > 0 && !!lowCardCat && metrics.length >= 1,
      pie:
        rowCount > 0 &&
        metrics.length === 1 &&
        !!categoricalDims.find((c) => c.cardinalityBucket === 'few'),
      scatter: rowCount > 1 && metrics.length >= 2,
      map: geoAvailable,
      table: rowCount > 0,
    };

    return {
      rowCount,
      columnCount: columns.length,
      columns,
      hasNumeric: columns.some((c) => c.semanticType === 'numeric'),
      hasTemporal: temporalDims.length > 0,
      hasCategorical: categoricalDims.length > 0,
      hasGeo: geoAvailable,
      geoAvailable,
      timeGranularity: this.timeGranularity(resolvedPlan),
      chartFeasibility: feasibility,
      vizCandidates: this.rankCandidates(feasibility),
    };
  }

  private timeGranularity(plan?: ResolvedDatasetPlan): TimeGrain | 'mixed' | undefined {
    if (!plan) return undefined;
    const grains = plan.dimensions
      .filter((d) => d.timeGrain && d.timeGrain !== 'none')
      .map((d) => d.timeGrain);
    if (grains.length === 0) return undefined;
    return grains.every((g) => g === grains[0]) ? grains[0] : 'mixed';
  }

  /** Ranked catalog component names; DataTable is always the final fallback. */
  private rankCandidates(f: ChartFeasibility): string[] {
    const out: string[] = [];
    if (f.map) out.push('GeoMap');
    if (f.kpi) out.push('ChartRadialText');
    if (f.line) out.push('LineChart', 'ChartAreaDefault');
    if (f.bar) out.push('BarChart', 'ChartBarDefault', 'ChartBarHorizontal');
    if (f.pie) out.push('ChartPieDonut', 'ChartPieSimple');
    out.push('DataTable');
    return [...new Set(out)];
  }
}
