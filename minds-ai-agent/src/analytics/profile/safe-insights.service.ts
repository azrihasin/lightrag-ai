import { Injectable } from '@nestjs/common';
import { toJsValue } from '../../duckdb/duckdb-values';
import { ANALYSIS_DATASET_TABLE, type DuckdbRunScope } from '../../duckdb/duckdb.service';
import type { ResultProfile } from './result-profile.types';
import type { CategoryInsight, MetricInsight, SafeInsights } from './safe-insights.types';

function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

const toNum = (v: unknown): number | null => {
  const n = Number(toJsValue(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Computes a bounded {@link SafeInsights} object of approved aggregate facts from
 * analysis_dataset. The summarize agent uses these for exact numbers instead of
 * ever seeing the dataset rows.
 */
@Injectable()
export class SafeInsightsService {
  async build(scope: DuckdbRunScope, profile: ResultProfile): Promise<SafeInsights> {
    const table = `${q(scope.schema)}.${q(ANALYSIS_DATASET_TABLE)}`;
    const metricCols = profile.columns.filter((c) => c.role === 'metric');

    const metrics = await this.metricInsights(scope, table, metricCols.map((c) => c.name));
    const categories = await this.categoryInsight(scope, table, profile);

    return { rowCount: profile.rowCount, metrics, categories };
  }

  private async metricInsights(
    scope: DuckdbRunScope,
    table: string,
    metricNames: string[],
  ): Promise<MetricInsight[]> {
    if (metricNames.length === 0) return [];
    const selects = metricNames.flatMap((m) => [
      `SUM(${q(m)}) AS ${q(`${m}__total`)}`,
      `MIN(${q(m)}) AS ${q(`${m}__min`)}`,
      `MAX(${q(m)}) AS ${q(`${m}__max`)}`,
      `AVG(${q(m)}) AS ${q(`${m}__avg`)}`,
    ]);
    const [agg] = await scope.all<Record<string, unknown>>(
      `SELECT ${selects.join(', ')} FROM ${table}`,
    );
    return metricNames.map((m) => ({
      name: m,
      total: toNum(agg?.[`${m}__total`]),
      min: (toJsValue(agg?.[`${m}__min`]) as number | string | null) ?? null,
      max: (toJsValue(agg?.[`${m}__max`]) as number | string | null) ?? null,
      avg: toNum(agg?.[`${m}__avg`]),
    }));
  }

  /** Top-N of the primary low-cardinality dimension by the primary metric. */
  private async categoryInsight(
    scope: DuckdbRunScope,
    table: string,
    profile: ResultProfile,
  ): Promise<CategoryInsight | undefined> {
    const metric = profile.columns.find((c) => c.role === 'metric');
    const dim = profile.columns.find(
      (c) =>
        c.role === 'dimension' &&
        ['categorical', 'text'].includes(c.semanticType) &&
        ['few', 'manageable'].includes(c.cardinalityBucket),
    );
    if (!metric || !dim) return undefined;

    const rows = await scope.all<Record<string, unknown>>(
      `SELECT ${q(dim.name)} AS label, ${q(metric.name)} AS value
         FROM ${table}
        ORDER BY ${q(metric.name)} DESC NULLS LAST
        LIMIT 5`,
    );
    return {
      dimension: dim.name,
      metric: metric.name,
      top: rows.map((r) => ({
        label: toJsValue(r.label) as string | number | null,
        value: toNum(r.value) ?? 0,
      })),
    };
  }
}
