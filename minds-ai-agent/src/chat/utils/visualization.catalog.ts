export const CATALOG_SPEC =
  'CHART COMPONENTS (json-render catalog):\n\n' +
  'chartXY schema — props: { title: string, description?: string, data: Row[], xKey: string, series: string[], footerLabel?: string }\n' +
  'Components: ChartAreaDefault, ChartAreaGradient, ChartAreaLegend, ChartAreaLinear, ChartAreaStacked, ChartAreaStackedExpand,\n' +
  '            ChartAreaStep, ChartAreaAxes, ChartAreaIcons,\n' +
  '            ChartBarDefault, ChartBarActive, ChartBarHorizontal, ChartBarLabel, ChartBarLabelCustom,\n' +
  '            ChartBarMixed, ChartBarMultiple, ChartBarNegative, ChartBarStacked,\n' +
  '            ChartLineDefault, ChartLineDots, ChartLineDotsColors, ChartLineDotsCustom,\n' +
  '            ChartLineLabel, ChartLineLabelCustom, ChartLineLinear, ChartLineMultiple, ChartLineStep\n\n' +
  'chartPie schema — props: { title: string, description?: string, data: Row[], nameKey: string, valueKey: string, footerLabel?: string }\n' +
  'Components: ChartPieSimple, ChartPieDonut, ChartPieDonutActive, ChartPieDonutText,\n' +
  '            ChartPieLabel, ChartPieLabelCustom, ChartPieLabelList, ChartPieLegend, ChartPieSeparatorNone, ChartPieStacked,\n' +
  '            ChartRadialSimple, ChartRadialGrid, ChartRadialLabel, ChartRadialShape\n\n' +
  'chartRadar schema — props: { title: string, description?: string, data: Row[], angleKey: string, series: string[], footerLabel?: string }\n' +
  'Components: ChartRadarDefault, ChartRadarDots, ChartRadarGridCircle, ChartRadarGridFill, ChartRadarGridNone,\n' +
  '            ChartRadarMultiple, ChartRadarLegend, ChartRadarLinesOnly, ChartRadarRadius\n\n' +
  'Single-value:\n' +
  '  ChartRadialText — props: { title, description?, value: number, label?: string, footerLabel? }\n' +
  '  ChartRadialStacked — props: { title, description?, desktop: number, mobile: number, footerLabel? }';

export const SELECTION_RULES =
  'SELECTION RULES:\n' +
  '- Time series or ordered categories → ChartLineDefault or ChartAreaDefault\n' +
  '- Comparing categories → ChartBarDefault (few series) or ChartBarMultiple (multiple series)\n' +
  '- Long category names → ChartBarHorizontal\n' +
  '- Part-to-whole ≤8 categories → ChartPieDonut or ChartPieSimple\n' +
  '- Multi-metric radar comparison across axes → ChartRadarDefault or ChartRadarMultiple\n' +
  '- Single numeric KPI → ChartRadialText\n' +
  '- Multiple numeric series over the same categories → ChartLineMultiple or ChartBarMultiple\n' +
  '- If data has fewer than 2 rows, is a single row, or is purely textual → set suitable=false\n\n' +
  'Map actual column names to xKey/nameKey/angleKey and series/valueKey.\n' +
  'Include ALL rows in props.data (not just the sample).\n' +
  'Generate a descriptive title based on the SQL query intent.';

export const JMESPATH_FORMAT =
  'Reply with a single JSON object only, no markdown fences:\n' +
  '{ "suitable": boolean, "component": "ComponentName", "jmespathQuery": "jmespath expression evaluated against executionResult", ' +
  '"staticProps": { "title": "...", <xKey|nameKey|angleKey>: "...", <series|valueKey>: [...|"..."], "description"?: "...", "footerLabel"?: "..." } }\n\n' +
  'The `jmespathQuery` is evaluated against the executionResult object (fields: rows, columns, rowCount).\n' +
  'For simple row extraction use "rows". For projections use JMESPath syntax e.g. "rows[*].{label: name, value: total}".\n' +
  'The query result becomes the `data` prop of the component — do NOT include `data` in staticProps.';
