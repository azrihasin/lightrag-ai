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
  '  ChartRadialStacked — props: { title, description?, desktop: number, mobile: number, footerLabel? }\n\n' +
  'MAP COMPONENT:\n' +
  '  GeoMap — Interactive Leaflet map rendered from SQL results. Use when rows contain coordinate columns.\n' +
  '  staticProps schema: {\n' +
  '    title?: string,\n' +
  '    description?: string,\n' +
  '    center: [lat, lng],          // REQUIRED — compute avg from sample rows\n' +
  '    zoom?: number,               // 13=street, 11=city, 8=region, 6=country\n' +
  '    latField?: string,           // exact column name holding latitude\n' +
  '    lngField?: string,           // exact column name holding longitude\n' +
  '    labelField?: string,         // column for marker tooltip + popup heading\n' +
  '    popupFields?: string[],      // columns shown in popup (exclude lat/lng cols)\n' +
  '    cluster?: boolean,           // true when rowCount > 20 or markers dense\n' +
  '    shapes?: Shape[],            // static shapes independent of data rows\n' +
  '    tileLayers?: TileLayer[],    // omit for default CartoDB light/dark tiles\n' +
  '    layers?: LayerGroup[],       // named toggleable layer groups\n' +
  '    controls?: Controls          // all default true except locate/search/draw\n' +
  '  }\n' +
  '  Shape types: circle {type,center,radius(m)}, circleMarker {type,center,radius(px)},\n' +
  '               polyline {type,positions[[lat,lng],…]}, polygon {type,positions[[lat,lng],…]},\n' +
  '               rectangle {type,bounds:[[sw_lat,sw_lng],[ne_lat,ne_lng]]}\n' +
  '  Each shape/marker accepts optional popup (HTML string) and tooltip (plain string).\n' +
  '  The jmespathQuery result becomes the `data` prop (array of row objects).';

export const SELECTION_RULES =
  'SELECTION RULES (apply in order — first match wins):\n' +
  '1. Geo/coordinate data: columns named lat/latitude/lat_decimal/y_coord AND lng/lon/longitude/long_decimal/x_coord → GeoMap\n' +
  '   Also use GeoMap for: site locations, tower coordinates, customer addresses, route waypoints, coverage areas.\n' +
  '2. Time series or ordered categories → ChartLineDefault or ChartAreaDefault\n' +
  '3. Comparing categories → ChartBarDefault (few series) or ChartBarMultiple (multiple series)\n' +
  '4. Long category names → ChartBarHorizontal\n' +
  '5. Part-to-whole ≤8 categories → ChartPieDonut or ChartPieSimple\n' +
  '6. Multi-metric radar comparison across axes → ChartRadarDefault or ChartRadarMultiple\n' +
  '7. Single numeric KPI → ChartRadialText\n' +
  '8. Multiple numeric series over the same categories → ChartLineMultiple or ChartBarMultiple\n' +
  '9. Data has fewer than 2 rows, is a single row, or is purely textual → set suitable=false\n\n' +
  'GeoMap guidance:\n' +
  '  • Identify the exact column names for latitude and longitude from sample rows.\n' +
  '  • Compute center as [avg_lat, avg_lng] using the sample rows (rough estimate is fine).\n' +
  '  • Set zoom=11 for city, zoom=8 for region, zoom=6 for country coverage.\n' +
  '  • Set cluster=true when rowCount > 20.\n' +
  '  • Set popupFields to the most useful non-geo columns.\n\n' +
  'Chart guidance:\n' +
  '  Map actual column names to xKey/nameKey/angleKey and series/valueKey.\n' +
  '  Include ALL rows in props.data (not just the sample).\n' +
  '  Generate a descriptive title based on the SQL query intent.';

export const JMESPATH_FORMAT =
  'Reply with a single JSON object only, no markdown fences:\n' +
  '{ "suitable": boolean, "component": "ComponentName", "jmespathQuery": "jmespath expression", "staticProps": { ... } }\n\n' +
  'The `jmespathQuery` is evaluated against the executionResult object (fields: rows, columns, rowCount).\n' +
  'For simple row extraction use "rows". For projections: "rows[*].{label: name, value: total}".\n' +
  'The query result becomes the `data` prop — do NOT include `data` in staticProps.\n\n' +
  'For chart components staticProps must include: title, xKey|nameKey|angleKey, series|valueKey, optionally description/footerLabel.\n\n' +
  'For GeoMap, the JMESPath projection MUST output exactly these field names regardless of the source column names:\n' +
  '  - "latitude" (not lat, lat_decimal, y_coord, or any other name)\n' +
  '  - "longitude" (not lng, lon, long_decimal, x_coord, or any other name)\n' +
  '  - "label" for the marker label\n' +
  'Example: if source columns are "lat_decimal", "lng_decimal", "site_name", use:\n' +
  '  "rows[*].{latitude: lat_decimal, longitude: lng_decimal, label: site_name}"\n' +
  'Always set staticProps latField="latitude" and lngField="longitude" to match.\n\n' +
  'GeoMap staticProps example:\n' +
  '  { "title": "Site Locations", "center": [3.139, 101.687], "zoom": 11,\n' +
  '    "latField": "latitude", "lngField": "longitude",\n' +
  '    "labelField": "label", "popupFields": ["label", "status", "city"],\n' +
  '    "cluster": true, "controls": { "zoom": true, "fullscreen": true } }';
