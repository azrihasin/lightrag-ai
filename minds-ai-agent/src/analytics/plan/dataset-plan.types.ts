import { z } from 'zod';
import type { SemanticType } from '../schema/schema-metadata.types';

/**
 * A DatasetPlan is the structured analytical request the LLM emits *instead of*
 * SQL. It names the tables, joins, dimensions (group-by/selected columns),
 * metrics (aggregations), and filters in terms of real schema fields. NestJS
 * validates it against the schema catalog and deterministically compiles it into
 * read-only DuckDB SQL — the LLM never authors a query string.
 */

export const AggSchema = z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']);
export const FilterOpSchema = z.enum([
  '=', '!=', '>', '>=', '<', '<=', 'in', 'between', 'like', 'is_null', 'is_not_null',
]);
export const TimeGrainSchema = z.enum(['none', 'day', 'week', 'month', 'quarter', 'year']);
export const JoinTypeSchema = z.enum(['inner', 'left']);
export const SortDirSchema = z.enum(['asc', 'desc']);

export const DimensionSchema = z.object({
  table: z.string().describe('Source table name'),
  column: z.string().describe('Source column name'),
  alias: z.string().optional().describe('Output column name (defaults to the column name)'),
  timeGrain: TimeGrainSchema.optional().describe(
    'For temporal columns only: bucket the values by day/week/month/quarter/year',
  ),
});

export const MetricSchema = z.object({
  table: z.string(),
  column: z.string().optional().describe('Column to aggregate; omit only for count'),
  agg: AggSchema,
  alias: z.string().describe('Output column name for the aggregated value'),
});

export const FilterSchema = z.object({
  table: z.string(),
  column: z.string(),
  op: FilterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  values: z.array(z.union([z.string(), z.number()])).optional().describe('For the "in" operator'),
  low: z.union([z.string(), z.number()]).optional().describe('For the "between" operator'),
  high: z.union([z.string(), z.number()]).optional().describe('For the "between" operator'),
});

export const JoinSchema = z.object({
  leftTable: z.string(),
  leftColumn: z.string(),
  rightTable: z.string(),
  rightColumn: z.string(),
  type: JoinTypeSchema.optional().default('inner'),
});

export const OrderBySchema = z.object({
  alias: z.string().describe('A dimension or metric output alias to sort by'),
  direction: SortDirSchema.optional().default('desc'),
});

export const DatasetPlanSchema = z.object({
  baseTable: z.string().describe('The primary table the query is built from'),
  joins: z.array(JoinSchema).optional().default([]),
  dimensions: z.array(DimensionSchema).optional().default([]),
  metrics: z.array(MetricSchema).optional().default([]),
  filters: z.array(FilterSchema).optional().default([]),
  orderBy: z.array(OrderBySchema).optional().default([]),
  limit: z.number().int().positive().max(10000).optional(),
  grain: z.string().optional().describe('Plain-language description of one output row'),
});

/** Row caps applied when the plan does not specify its own limit. */
export const DEFAULT_RAW_LIMIT = 10;
export const DEFAULT_AGG_LIMIT = 1000;
export const MAX_LIMIT = 10000;

export type Agg = z.infer<typeof AggSchema>;
export type FilterOp = z.infer<typeof FilterOpSchema>;
export type TimeGrain = z.infer<typeof TimeGrainSchema>;
export type DatasetPlan = z.infer<typeof DatasetPlanSchema>;
export type DatasetFilter = z.infer<typeof FilterSchema>;

// ── Resolved plan (validator output → compiler input) ──────────────────────────
// Every reference is resolved to its real schema + semantic type so the compiler
// is a pure, catalog-free string builder.

export type OutputRole = 'dimension' | 'metric';

export interface OutputColumn {
  alias: string;
  role: OutputRole;
  semanticType: SemanticType;
}

export interface ResolvedDimension {
  schema: string;
  table: string;
  column: string;
  alias: string;
  timeGrain: TimeGrain;
  semanticType: SemanticType;
}

export interface ResolvedMetric {
  schema: string;
  table: string;
  column?: string;
  agg: Agg;
  alias: string;
}

export interface ResolvedFilter {
  schema: string;
  table: string;
  column: string;
  op: FilterOp;
  semanticType: SemanticType;
  value?: string | number | boolean;
  values?: Array<string | number>;
  low?: string | number;
  high?: string | number;
}

export interface ResolvedJoin {
  type: 'inner' | 'left';
  leftSchema: string;
  leftTable: string;
  leftColumn: string;
  rightSchema: string;
  rightTable: string;
  rightColumn: string;
}

export interface ResolvedDatasetPlan {
  baseSchema: string;
  baseTable: string;
  joins: ResolvedJoin[];
  dimensions: ResolvedDimension[];
  metrics: ResolvedMetric[];
  filters: ResolvedFilter[];
  orderBy: Array<{ alias: string; direction: 'asc' | 'desc' }>;
  limit: number;
  /** True when metrics are present → grouped aggregate query. */
  isAggregate: boolean;
  /** Ordered output columns (dimensions first, then metrics). */
  outputs: OutputColumn[];
}

export interface DatasetPlanValidation {
  valid: boolean;
  errors: string[];
  resolved?: ResolvedDatasetPlan;
}
