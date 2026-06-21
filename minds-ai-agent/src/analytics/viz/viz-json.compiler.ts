import { Injectable } from '@nestjs/common';
import { toJsValue } from '../../duckdb/duckdb-values';
import { ANALYSIS_DATASET_TABLE, type DuckdbRunScope } from '../../duckdb/duckdb.service';
import type { VisualizationSpec } from '../analytics.types';
import type { ResolvedVizPlan } from './viz-plan.types';

function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** SQL string literal for a JSON object key. */
function k(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

type Row = Record<string, string | number | boolean | null>;

/**
 * Compiles a validated VizPlan into the canonical {@link VisualizationSpec} by
 * shaping the data in DuckDB. Output columns are aliased to canonical renderer
 * names (x / series / label / value / lat / lon) and assembled with DuckDB
 * `json_object` + `json_group_array`. The resulting spec flows DuckDB → NestJS
 * validators → frontend renderer ONLY — never back to an LLM.
 */
@Injectable()
export class VizJsonCompiler {
  /** Returns a render-ready spec, or undefined for a plain-table result. */
  async compile(
    plan: ResolvedVizPlan,
    scope: DuckdbRunScope,
  ): Promise<VisualizationSpec | undefined> {
    if (!plan.shouldVisualize || plan.kind === 'table') return undefined;

    const table = `${q(scope.schema)}.${q(ANALYSIS_DATASET_TABLE)}`;

    switch (plan.kind) {
      case 'xy':
        return this.compileXY(plan, scope, table);
      case 'pie':
        return this.compilePie(plan, scope, table);
      case 'map':
        return this.compileMap(plan, scope, table);
      case 'kpi':
        return this.compileKpi(plan, scope, table);
      default:
        return undefined;
    }
  }

  /** Run a `json_group_array(json_object(...))` and parse it into rows. */
  private async dataArray(
    scope: DuckdbRunScope,
    table: string,
    pairs: Array<[string, string]>,
  ): Promise<Row[]> {
    const args = pairs.map(([key, col]) => `${k(key)}, ${q(col)}`).join(', ');
    const [res] = await scope.all<{ data: unknown }>(
      `SELECT json_group_array(json_object(${args})) AS data FROM ${table}`,
    );
    const raw = res?.data;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as Row[]) : [];
  }

  private async compileXY(
    plan: ResolvedVizPlan,
    scope: DuckdbRunScope,
    table: string,
  ): Promise<VisualizationSpec> {
    const x = plan.encoding.x!;
    const series = plan.encoding.series ?? [];
    // x → canonical 'x'; series keep their (already-clean) aliases as data keys.
    const pairs: Array<[string, string]> = [['x', x], ...series.map((s) => [s, s] as [string, string])];
    const data = await this.dataArray(scope, table, pairs);
    return {
      componentType: plan.componentType,
      props: { title: plan.title, data, xKey: 'x', series },
    };
  }

  private async compilePie(
    plan: ResolvedVizPlan,
    scope: DuckdbRunScope,
    table: string,
  ): Promise<VisualizationSpec> {
    const pairs: Array<[string, string]> = [
      ['label', plan.encoding.label!],
      ['value', plan.encoding.value!],
    ];
    const data = await this.dataArray(scope, table, pairs);
    return {
      componentType: plan.componentType,
      props: { title: plan.title, data, nameKey: 'label', valueKey: 'value' },
    };
  }

  private async compileMap(
    plan: ResolvedVizPlan,
    scope: DuckdbRunScope,
    table: string,
  ): Promise<VisualizationSpec> {
    const lat = plan.encoding.lat!;
    const lng = plan.encoding.lng!;
    const label = plan.encoding.label;
    const popupFields = plan.encoding.popupFields ?? [];

    const pairs: Array<[string, string]> = [
      ['lat', lat],
      ['lon', lng],
    ];
    if (label) pairs.push(['label', label]);
    for (const p of popupFields) pairs.push([p, p]);

    const data = await this.dataArray(scope, table, pairs);
    const { center, zoom } = fitCenterZoom(
      data
        .map((r) => [Number(r.lat), Number(r.lon)] as [number, number])
        .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo)),
    );

    return {
      componentType: plan.componentType,
      props: {
        title: plan.title,
        center,
        zoom,
        data,
        latField: 'lat',
        lngField: 'lon',
        ...(label ? { labelField: 'label' } : {}),
        ...(popupFields.length ? { popupFields } : {}),
        cluster: data.length > 200,
      },
    };
  }

  private async compileKpi(
    plan: ResolvedVizPlan,
    scope: DuckdbRunScope,
    table: string,
  ): Promise<VisualizationSpec> {
    const [row] = await scope.all<Record<string, unknown>>(
      `SELECT ${q(plan.encoding.value!)} AS v FROM ${table} LIMIT 1`,
    );
    const value = Number(toJsValue(row?.v) ?? 0);
    return {
      componentType: plan.componentType,
      props: {
        title: plan.title,
        value,
        ...(plan.encoding.label ? { label: plan.encoding.label } : {}),
      },
    };
  }
}

/**
 * GeoMap needs an explicit [lat, lng] center + zoom. Derive both from the
 * plotted coordinates (centroid + a zoom stepped off the coordinate span).
 * Ported from the retired visualization agent's geo helper.
 */
export function fitCenterZoom(coords: [number, number][]): {
  center: [number, number];
  zoom: number;
} {
  if (coords.length === 0) return { center: [0, 0], zoom: 2 };
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  let sumLat = 0, sumLng = 0;
  for (const [lat, lng] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    sumLat += lat;
    sumLng += lng;
  }
  const center: [number, number] = [sumLat / coords.length, sumLng / coords.length];
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  const zoom =
    coords.length === 1 || span === 0 ? 12
    : span > 60 ? 2 : span > 30 ? 3 : span > 15 ? 4 : span > 7 ? 5
    : span > 3 ? 6 : span > 1 ? 8 : span > 0.3 ? 10 : span > 0.05 ? 12 : 13;
  return { center, zoom };
}
