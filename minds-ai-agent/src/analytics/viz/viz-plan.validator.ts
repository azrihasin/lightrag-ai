import { Injectable } from '@nestjs/common';
import {
  getCatalogComponent,
  isLineLike,
  type VizKind,
} from '../../ai/mastra/visualization/catalog-descriptor';
import { isLatName, isLngName } from '../schema/schema-metadata.types';
import type { ColumnProfile, ResultProfile } from '../profile/result-profile.types';
import type { ResolvedVizPlan, VizPlan } from './viz-plan.types';

const CATEGORICAL = ['categorical', 'text', 'identifier'];

/** The default component for each feasible kind, in priority order. */
function ruleBasedComponent(profile: ResultProfile): { name: string; kind: VizKind } {
  const f = profile.chartFeasibility;
  if (f.map) return { name: 'GeoMap', kind: 'map' };
  if (f.kpi) return { name: 'ChartRadialText', kind: 'kpi' };
  if (f.line) return { name: 'LineChart', kind: 'xy' };
  if (f.bar) return { name: 'BarChart', kind: 'xy' };
  if (f.pie) return { name: 'ChartPieDonut', kind: 'pie' };
  return { name: 'DataTable', kind: 'table' };
}

/** Is the requested component renderable for this result? */
function componentFeasible(name: string, profile: ResultProfile): boolean {
  const comp = getCatalogComponent(name);
  if (!comp) return false;
  const f = profile.chartFeasibility;
  switch (comp.kind) {
    case 'table':
      return true;
    case 'map':
      return f.map;
    case 'kpi':
      return f.kpi;
    case 'pie':
      return f.pie;
    case 'xy':
      return isLineLike(name) ? f.line : f.bar;
    default:
      return false;
  }
}

/**
 * Applies the deterministic visualization rules over the agent's VizPlan. The
 * rules WIN on conflict: empty result → table, one-row aggregate → KPI,
 * temporal+metric → line, categorical+metric → bar, geo → map, otherwise table.
 * Resolves canonical encodings to dataset output aliases.
 */
@Injectable()
export class VizPlanValidator {
  validate(plan: VizPlan, profile: ResultProfile): ResolvedVizPlan {
    const table = (reason: string): ResolvedVizPlan => ({
      shouldVisualize: false,
      componentType: 'DataTable',
      kind: 'table',
      title: plan.title || 'Results',
      reason,
      encoding: {},
    });

    if (profile.rowCount === 0) return table('No rows — showing an empty table.');
    if (!plan.shouldVisualize) return table(plan.reason || 'Plain table requested.');

    // Honor the agent's specific component only if it is actually renderable for
    // this result; otherwise the deterministic rule decides.
    const chosen = componentFeasible(plan.chartType, profile)
      ? { name: plan.chartType, kind: getCatalogComponent(plan.chartType)!.kind }
      : ruleBasedComponent(profile);

    if (chosen.kind === 'table') return table(plan.reason || 'A table is the clearest view.');

    const dims = profile.columns.filter((c) => c.role === 'dimension');
    const metrics = profile.columns.filter((c) => c.role === 'metric');
    const has = (alias?: string, pool?: ColumnProfile[]) =>
      alias && pool?.some((c) => c.name === alias) ? alias : undefined;

    const base = {
      shouldVisualize: true,
      componentType: chosen.name,
      kind: chosen.kind,
      title: plan.title || 'Results',
      reason: plan.reason,
      format: plan.format,
      style: plan.style,
    };

    if (chosen.kind === 'xy') {
      const x = has(plan.encoding.x, dims) ?? dims[0]?.name ?? profile.columns[0]?.name;
      const requested = (plan.encoding.series ?? []).filter((s) =>
        metrics.some((m) => m.name === s),
      );
      const series =
        requested.length > 0
          ? requested
          : metrics.length > 0
            ? metrics.map((m) => m.name)
            : profile.columns.filter((c) => c.name !== x).map((c) => c.name).slice(0, 1);
      if (!x || series.length === 0) return table('Not enough fields for a chart.');
      return { ...base, encoding: { x, series } };
    }

    if (chosen.kind === 'pie') {
      const catDims = dims.filter((c) => CATEGORICAL.includes(c.semanticType));
      const label = has(plan.encoding.label, catDims) ?? catDims[0]?.name ?? dims[0]?.name;
      const value = has(plan.encoding.value, metrics) ?? metrics[0]?.name;
      if (!label || !value) return table('Not enough fields for a pie chart.');
      return { ...base, encoding: { label, value } };
    }

    if (chosen.kind === 'map') {
      const lat = dims.find((c) => c.semanticType === 'geo' && isLatName(c.name))?.name;
      const lng = dims.find((c) => c.semanticType === 'geo' && isLngName(c.name))?.name;
      if (!lat || !lng) return table('No coordinate columns for a map.');
      const label =
        has(plan.encoding.label, dims) ??
        dims.find((c) => CATEGORICAL.includes(c.semanticType))?.name;
      const popupFields = (plan.encoding.popupFields ?? []).filter((p) =>
        profile.columns.some((c) => c.name === p),
      );
      return { ...base, encoding: { lat, lng, label, popupFields } };
    }

    // kpi
    const value = has(plan.encoding.value, metrics) ?? metrics[0]?.name;
    if (!value) return table('No metric for a KPI.');
    return { ...base, encoding: { value, label: plan.encoding.label } };
  }
}
