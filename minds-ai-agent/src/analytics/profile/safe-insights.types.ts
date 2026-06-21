/**
 * Bounded, approved aggregate facts the summarize agent may quote. Derived
 * deterministically from analysis_dataset — contains NO raw rows or
 * customer-level values, only headline aggregates and a small top-N of an
 * already-charted dimension.
 */
export interface MetricInsight {
  name: string;
  total: number | null;
  min: number | string | null;
  max: number | string | null;
  avg: number | null;
}

export interface CategoryInsight {
  dimension: string;
  metric: string;
  top: Array<{ label: string | number | null; value: number }>;
}

export interface SafeInsights {
  rowCount: number;
  metrics: MetricInsight[];
  categories?: CategoryInsight;
}
