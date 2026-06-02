import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import {
  catalogPromptBlock,
  catalogComponentNames,
  getCatalogComponent,
  type VizKind,
} from '../../ai/mastra/visualization/catalog-descriptor';

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * GeoMap (Leaflet) needs an explicit [lat, lng] center + zoom — it does not
 * auto-fit. Derive both from the plotted coordinates: centroid for the center,
 * and a zoom stepped off the coordinate span.
 */
function fitCenterZoom(coords: [number, number][]): {
  center: [number, number];
  zoom: number;
} {
  if (coords.length === 0) return { center: [0, 0], zoom: 2 };

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let sumLat = 0;
  let sumLng = 0;
  for (const [lat, lng] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    sumLat += lat;
    sumLng += lng;
  }

  const center: [number, number] = [sumLat / coords.length, sumLng / coords.length];
  const span = Math.max(maxLat - minLat, maxLng - minLng);

  const zoom =
    coords.length === 1 || span === 0
      ? 12
      : span > 60
        ? 2
        : span > 30
          ? 3
          : span > 15
            ? 4
            : span > 7
              ? 5
              : span > 3
                ? 6
                : span > 1
                  ? 8
                  : span > 0.3
                    ? 10
                    : span > 0.05
                      ? 12
                      : 13;

  return { center, zoom };
}

/** Axis/column mapping the LLM passes to select_visualization. */
interface SelectVizInput {
  componentType: string;
  title: string;
  xKey?: string;
  series?: string[];
  nameKey?: string;
  valueKey?: string;
  latField?: string;
  lngField?: string;
  labelField?: string;
  popupFields?: string[];
  cluster?: boolean;
  originLatField?: string;
  originLngField?: string;
  destLatField?: string;
  destLngField?: string;
}

/**
 * Subagent #7 — generate_visualization. Chooses ONE json-render component from
 * the frontend catalog that best fits the result, then `select_visualization`
 * assembles props (with the executed rows inline) and records the spec on the
 * blackboard for the frontend to render.
 */
@Injectable()
export class VisualizationAgentService {
  readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    this.agent = new Agent({
      id: 'generate_visualization',
      name: 'GenerateVisualizationAgent',
      description:
        'Pick the most suitable visualization from the catalog for the executed result and record it. ' +
        'Run LAST, after summarize_result.',
      instructions: [
        'You choose the best visualization for the query result from this catalog:',
        catalogPromptBlock(),
        '',
        'Begin your reply with ONE short sentence (e.g. "Choosing how to present these results.").',
        'Guidelines:',
        '- Use the column names reported by execute_sql.',
        '- Default to DataTable when the result is a plain list of records / a flat dataset, or has no meaningful aggregate, comparison metric, time series, ranking, or distribution. Do NOT force a bar chart or invent a weak visualization.',
        '- Use a chart only when the data genuinely supports one: an aggregate or comparison across categories (bar), a trend over an ordered/time axis (line/area), a part-to-whole proportion across a few categories (pie). Also use the chart type the user explicitly asked for.',
        '- Choose GeoMap only when the data is genuinely geospatial — real coordinates, not just place names. Use it for rows with latitude/longitude columns (stores, sites, towers, coverage points, customer/asset locations, incidents); it plots point markers (cluster them for larger sets). Rows that pair an origin AND a destination coordinate (trips, shipments, transfers, flows between places) are drawn as polyline connector lines on the same map.',
        '- xy charts need an x-axis category column (xKey) and one or more numeric series columns (series).',
        '- pie charts need a category column (nameKey) and a numeric column (valueKey).',
        '- GeoMap requires latField + lngField; optionally labelField (marker label/popup heading), popupFields (detail columns), and cluster (boolean — for larger point sets). For flows, also pass origin lat/lng + destination lat/lng columns (originLatField/originLngField, destLatField/destLngField).',
        'Call the select_visualization tool exactly once with your choice (use componentType "DataTable" for a table). Then state your choice in one short sentence.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
      tools: { select_visualization: this.selectTool() },
    });
  }

  private selectTool() {
    return createTool({
      id: 'select_visualization',
      description: 'Record the chosen visualization component and its axis mapping.',
      inputSchema: z.object({
        componentType: z
          .string()
          .describe(`One catalog component name. Allowed: ${catalogComponentNames().join(', ')}`),
        title: z.string().describe('Short chart title'),
        xKey: z.string().optional().describe('xy charts: category/x-axis column'),
        series: z.array(z.string()).optional().describe('xy charts: numeric series column name(s)'),
        nameKey: z.string().optional().describe('pie charts: category column'),
        valueKey: z.string().optional().describe('pie charts: numeric value column'),
        latField: z.string().optional().describe('GeoMap: latitude column'),
        lngField: z.string().optional().describe('GeoMap: longitude column'),
        labelField: z.string().optional().describe('GeoMap: marker label / popup heading column'),
        popupFields: z.array(z.string()).optional().describe('GeoMap: columns shown inside each marker popup'),
        cluster: z.boolean().optional().describe('GeoMap: group nearby markers (use for larger point sets)'),
        originLatField: z.string().optional().describe('GeoMap flows: origin latitude column'),
        originLngField: z.string().optional().describe('GeoMap flows: origin longitude column'),
        destLatField: z.string().optional().describe('GeoMap flows: destination latitude column'),
        destLngField: z.string().optional().describe('GeoMap flows: destination longitude column'),
      }),
      outputSchema: z.object({ recorded: z.boolean(), componentType: z.string(), note: z.string().optional() }),
      execute: async (input: SelectVizInput) => {
        const run = currentRun();
        const rows = run?.rows ?? [];
        const columns = (run?.columns ?? []).map((c) => c.name);

        const component = getCatalogComponent(input.componentType);
        if (!component) {
          return {
            recorded: false,
            componentType: input.componentType,
            note: `Unknown component. Choose one of: ${catalogComponentNames().join(', ')}`,
          };
        }

        // Record the choice in all cases so the reasoning feed can report it.
        if (run) run.vizChoice = component.name;

        // A table choice records no chart spec — the executed rows already render
        // as a data table, so a flat list is shown as-is rather than as a chart.
        if (component.kind === 'table') {
          return {
            recorded: true,
            componentType: component.name,
            note: 'Showing the result as a table — no chart needed.',
          };
        }

        const props = this.buildProps(component.kind, input, rows, columns);
        if (run) run.spec = { componentType: component.name, props };

        return { recorded: true, componentType: component.name };
      },
    });
  }

  private buildProps(
    kind: VizKind,
    input: SelectVizInput,
    rows: Record<string, unknown>[],
    columns: string[],
  ): Record<string, unknown> {
    const pick = (name: string | undefined, fallback: string | undefined) =>
      name && columns.includes(name) ? name : fallback;
    const find = (re: RegExp) => columns.find((c) => re.test(c));

    if (kind === 'pie') {
      const nameKey = pick(input.nameKey, columns[0]);
      const valueKey = pick(input.valueKey, columns[1] ?? columns[0]);
      return { title: input.title, data: rows, nameKey, valueKey };
    }

    // GeoMap — data-driven point markers (with optional clustering). Origin →
    // destination column pairs are drawn as polyline connector lines. GeoMap
    // requires an explicit [lat, lng] center, so derive a viewport from the data.
    if (kind === 'map') {
      const latField = pick(input.latField, find(/lat/i));
      const lngField = pick(input.lngField, find(/lng|lon/i));

      const oLat = pick(input.originLatField, find(/(orig|from|src|start|dep).*lat/i));
      const oLng = pick(input.originLngField, find(/(orig|from|src|start|dep).*(lng|lon)/i));
      const dLat = pick(input.destLatField, find(/(dest|to|end|arr|target).*lat/i));
      const dLng = pick(input.destLngField, find(/(dest|to|end|arr|target).*(lng|lon)/i));

      const shapes =
        oLat && oLng && dLat && dLng
          ? rows
              .map((r) => ({
                type: 'polyline' as const,
                positions: [
                  [Number(r[oLat]), Number(r[oLng])],
                  [Number(r[dLat]), Number(r[dLng])],
                ] as [number, number][],
              }))
              .filter((s) => s.positions.every((p) => p.every(Number.isFinite)))
          : [];

      // Collect every plotted coordinate (markers + flow endpoints) to fit the viewport.
      const coords: [number, number][] = [];
      if (latField && lngField) {
        for (const r of rows) {
          const lat = Number(r[latField]);
          const lng = Number(r[lngField]);
          if (isValidLatLng(lat, lng)) coords.push([lat, lng]);
        }
      }
      for (const s of shapes) for (const p of s.positions) coords.push(p);

      const { center, zoom } = fitCenterZoom(coords);

      return {
        title: input.title,
        center,
        zoom,
        data: rows,
        latField,
        lngField,
        labelField: pick(input.labelField, undefined),
        popupFields: input.popupFields?.filter((f) => columns.includes(f)),
        cluster: input.cluster ?? rows.length > 200,
        ...(shapes.length > 0 ? { shapes } : {}),
      };
    }

    // xy (bar/line/area)
    const xKey = pick(input.xKey, columns[0]);
    const series =
      input.series && input.series.length > 0
        ? input.series.filter((s) => columns.includes(s))
        : columns.filter((c) => c !== xKey).slice(0, 1);
    return {
      title: input.title,
      data: rows,
      xKey,
      series: series.length > 0 ? series : columns.slice(1, 2),
    };
  }
}
