/**
 * Backend mirror of the json-render components the frontend can actually render
 * (see `frontend/src/lib/catalog.ts` + `registry.tsx`). The generate_visualization
 * subagent picks ONE `name` from this list; `select_visualization` then assembles
 * props that satisfy that component's frontend schema.
 *
 * `kind` drives how props are built:
 *   - 'xy'    → chartXY/chartLineBar: { data, xKey, series[], title }
 *   - 'pie'   → chartPie: { data, nameKey, valueKey, title }
 *   - 'map'   → GeoMap: { center, data, latField, lngField, labelField, popupFields, cluster }
 *               Origin/destination column pairs are drawn as curved arc connectors.
 *   - 'table' → no chart spec; the executed rows render as a data table only.
 *
 * Chart/map components embed `data` INLINE (the frontend reads props.data
 * directly), so specs carry the executed rows, not a dataPath reference. The
 * 'table' kind records the choice but produces no spec — a flat list with
 * nothing meaningful to chart should be shown as a table, not a forced chart.
 */
export type VizKind = 'xy' | 'pie' | 'map' | 'table';

export interface CatalogComponent {
  name: string;
  kind: VizKind;
  whenToUse: string;
}

export const VIZ_CATALOG: readonly CatalogComponent[] = [
  // ── Table (default for flat lists) ──────────────────────────────────────────
  { name: 'DataTable', kind: 'table', whenToUse: 'DEFAULT for a plain list of records or a flat dataset with no meaningful aggregate, comparison metric, time series, ranking, or distribution. Choose this rather than forcing a weak chart. The rows already render as a sortable table.' },

  // ── Bar ───────────────────────────────────────────────────────────────────
  { name: 'BarChart', kind: 'xy', whenToUse: 'Compare a single numeric value across categories. Good default for counts/totals by category.' },
  { name: 'ChartBarDefault', kind: 'xy', whenToUse: 'Single-series vertical bars with a footer note. Standard categorical comparison.' },
  { name: 'ChartBarMultiple', kind: 'xy', whenToUse: 'Several numeric series compared side-by-side per category (grouped bars).' },
  { name: 'ChartBarStacked', kind: 'xy', whenToUse: 'Composition/breakdown: multiple series stacked to show parts of a total per category.' },
  { name: 'ChartBarHorizontal', kind: 'xy', whenToUse: 'Many categories or long category labels — horizontal bars read better.' },
  { name: 'ChartBarLabel', kind: 'xy', whenToUse: 'Bars where exact values must always be visible (labels above bars).' },

  // ── Line / Area (trends over time) ──────────────────────────────────────────
  { name: 'LineChart', kind: 'xy', whenToUse: 'A trend of one or more metrics over an ordered/time axis. Good default for time series.' },
  { name: 'ChartLineDefault', kind: 'xy', whenToUse: 'Clean single/multi line trend without dots.' },
  { name: 'ChartLineMultiple', kind: 'xy', whenToUse: 'Compare multiple metrics over the same x-axis with a legend.' },
  { name: 'ChartAreaDefault', kind: 'xy', whenToUse: 'A single metric trend over time emphasized with a filled area.' },
  { name: 'ChartAreaStacked', kind: 'xy', whenToUse: 'Part-to-whole composition over time (stacked areas).' },

  // ── Pie / Donut (proportion, few categories) ────────────────────────────────
  { name: 'ChartPieSimple', kind: 'pie', whenToUse: 'Proportion / share of a whole across up to ~6 categories.' },
  { name: 'ChartPieDonut', kind: 'pie', whenToUse: 'Same as pie but cleaner ring look for proportional data.' },
  { name: 'ChartPieLegend', kind: 'pie', whenToUse: 'Proportional data where a color legend aids category identification.' },
  { name: 'ChartPieLabel', kind: 'pie', whenToUse: 'Proportional data where each segment value/label should always show.' },

  // ── Geospatial (mapcn / MapLibre GL) ─────────────────────────────────────────
  { name: 'GeoMap', kind: 'map', whenToUse: 'Rows carry real latitude/longitude coordinates and the question is about WHERE things are: store/site/tower locations, coverage points, customer or asset positions, incidents. Plots data-driven point markers (cluster them for larger sets). Rows that also pair an origin AND a destination coordinate (trips, shipments, transfers, flows between places) are drawn as curved arc connectors. Needs latField + lngField (and origin/destination lat/lng columns for flows).' },
] as const;

const BY_NAME = new Map(VIZ_CATALOG.map((c) => [c.name, c]));

export function getCatalogComponent(name: string): CatalogComponent | undefined {
  return BY_NAME.get(name);
}

export function catalogComponentNames(): string[] {
  return VIZ_CATALOG.map((c) => c.name);
}

/** Compact catalog summary injected into the visualization agent's prompt. */
export function catalogPromptBlock(): string {
  return VIZ_CATALOG.map((c) => `- ${c.name} (${c.kind}): ${c.whenToUse}`).join('\n');
}
