export const JSON_RENDER_COMPONENT_ALLOWLIST = [
  'Dashboard',
  'Grid',
  'Card',
  'MetricCard',
  'DataTable',
  'BarChart',
  'LineChart',
  'PieChart',
  'ScatterChart',
  'AreaChart',
  'GeoMap',
  'List',
  'Stat',
  'Text',
] as const;

export type JsonRenderComponent = typeof JSON_RENDER_COMPONENT_ALLOWLIST[number];

export const COMPONENT_ALLOWLIST_SET = new Set<string>(JSON_RENDER_COMPONENT_ALLOWLIST);

export function isAllowedComponent(name: string): name is JsonRenderComponent {
  return COMPONENT_ALLOWLIST_SET.has(name);
}
