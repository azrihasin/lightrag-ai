import type { SemanticType } from '../schema/schema-metadata.types';
import type { OutputRole, TimeGrain } from '../plan/dataset-plan.types';

/**
 * Coarse cardinality classification — exposed instead of the actual distinct
 * values so no row-level/sensitive values reach the LLM.
 */
export type CardinalityBucket = 'one' | 'few' | 'manageable' | 'high';

export interface ColumnProfile {
  name: string;
  role: OutputRole;
  semanticType: SemanticType;
  nullCount: number;
  distinctCount: number;
  cardinalityBucket: CardinalityBucket;
  /** Only populated for numeric/temporal columns; suppressed for text/identifier. */
  min?: number | string;
  max?: number | string;
  /** Numeric span (max − min); numeric columns only. */
  range?: number;
}

export interface ChartFeasibility {
  kpi: boolean;
  bar: boolean;
  line: boolean;
  scatter: boolean;
  pie: boolean;
  map: boolean;
  table: boolean;
}

/**
 * Deterministic, metadata-only description of the executed analysis_dataset.
 * Contains NO row records or sensitive sample values — only counts, semantic
 * types, cardinality buckets, allowed ranges, and feasibility flags. This is the
 * only profile of the data the visualization/summarize agents ever see.
 */
export interface ResultProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  hasNumeric: boolean;
  hasTemporal: boolean;
  hasCategorical: boolean;
  hasGeo: boolean;
  /** A usable latitude + longitude column pair is present. */
  geoAvailable: boolean;
  timeGranularity?: TimeGrain | 'mixed';
  chartFeasibility: ChartFeasibility;
  /** Catalog component names that are viable for this result, ranked. */
  vizCandidates: string[];
}
