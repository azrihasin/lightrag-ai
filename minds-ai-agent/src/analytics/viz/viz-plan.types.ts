import { z } from 'zod';
import { ALLOWED_FORMATS, ALLOWED_STYLES, type VizKind } from '../../ai/mastra/visualization/catalog-descriptor';

/**
 * The VizPlan is what the visualization agent emits from METADATA ONLY (intent,
 * dataset plan, schema types, and the result profile). It references dataset
 * output aliases — never row values. NestJS validates it against the catalog and
 * the deterministic viz rules, then the DuckDB JSON compiler renders the spec.
 */

const EncodingSchema = z.object({
  x: z.string().optional().describe('xy charts: category/x-axis output alias'),
  series: z.array(z.string()).optional().describe('xy charts: numeric metric aliases'),
  label: z.string().optional().describe('pie: category alias; map: marker label alias'),
  value: z.string().optional().describe('pie/kpi: numeric metric alias'),
  lat: z.string().optional().describe('map: latitude alias'),
  lng: z.string().optional().describe('map: longitude alias'),
  popupFields: z.array(z.string()).optional().describe('map: extra alias columns to show in popups'),
});

export const VizPlanSchema = z.object({
  shouldVisualize: z.boolean().describe('false → show the result as a plain table only'),
  chartType: z.string().describe('A catalog component name (e.g. BarChart, LineChart, GeoMap, DataTable)'),
  title: z.string().describe('Short chart title'),
  encoding: EncodingSchema.optional().default({}),
  format: z.enum(ALLOWED_FORMATS).optional(),
  style: z.enum(ALLOWED_STYLES).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional().describe('Why this visualization fits the result'),
  fallback: z.string().optional().describe('Alternate catalog component if the primary is unsuitable'),
});

export type VizPlan = z.infer<typeof VizPlanSchema>;

/** Validator output → consumed by the DuckDB visualization-JSON compiler. */
export interface ResolvedVizPlan {
  shouldVisualize: boolean;
  componentType: string;
  kind: VizKind;
  title: string;
  reason?: string;
  format?: string;
  style?: string;
  encoding: {
    x?: string;
    series?: string[];
    label?: string;
    value?: string;
    lat?: string;
    lng?: string;
    popupFields?: string[];
  };
}

export interface VizPlanValidation {
  valid: boolean;
  errors: string[];
  resolved?: ResolvedVizPlan;
}
