import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const rowRecord = z.record(z.string(), z.union([z.string(), z.number()]));

// ─── Geo / Map schemas ─────────────────────────────────────────────────────────

const latLng = z.tuple([z.number(), z.number()]);

// Key/value rows shown inside a marker/cluster popup body.
const fieldRecord = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);

const markerConfig = z.object({
  position: latLng,
  label: z.string().optional().nullable(),
  tooltip: z.string().optional().nullable(),
  fields: fieldRecord.optional().nullable(),
  color: z.string().optional().nullable(),
});

// A polyline drawn on the map (mapcn MapRoute).
const routeConfig = z.object({
  positions: z.array(latLng).min(2),
  color: z.string().optional().nullable(),
  width: z.number().optional().nullable(),
  dashed: z.boolean().optional().nullable(),
});

// A curved origin→destination connector (mapcn MapArc) for trips/flows.
const arcConfig = z.object({
  from: latLng,
  to: latLng,
});

// A single coverage/congestion PMTiles overlay layer.
const pmtilesLayer = z.object({
  key: z.string(),
  label: z.string(),
  category: z.string().optional().nullable(),
  sourceLayer: z.string(),
  url: z.string(),
  color: z.string().optional().nullable(),
});

// Full PMTiles overlay config: every week's layer set + the active week/layers.
// The week selector swaps weeks client-side (one week shown at a time); the
// layer control toggles the active week's layers on/off.
const pmtilesConfig = z.object({
  week: z.string(),
  activeKeys: z.array(z.string()),
  weeks: z.array(
    z.object({
      week: z.string(),
      layers: z.array(pmtilesLayer),
    }),
  ),
});

const geoMap = z.object({
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  center: latLng,
  zoom: z.number().optional().nullable(),
  styles: z
    .object({
      light: z.string().optional().nullable(),
      dark: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  pmtiles: pmtilesConfig.optional().nullable(),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).optional().nullable(),
  latField: z.string().optional().nullable(),
  lngField: z.string().optional().nullable(),
  labelField: z.string().optional().nullable(),
  popupFields: z.array(z.string()).optional().nullable(),
  markers: z.array(markerConfig).optional().nullable(),
  cluster: z.boolean().optional().nullable(),
  routes: z.array(routeConfig).optional().nullable(),
  arcs: z.array(arcConfig).optional().nullable(),
  controls: z.object({
    zoom: z.boolean().optional().nullable(),
    fullscreen: z.boolean().optional().nullable(),
    locate: z.boolean().optional().nullable(),
    compass: z.boolean().optional().nullable(),
  }).optional().nullable(),
});

/** Explicit axis fields: data rows, category field xKey, numeric series field names. */
const chartLineBar = z.object({
  title: z.string(),
  description: z.string().optional().nullable(),
  data: z.array(rowRecord).min(1),
  xKey: z.string(),
  series: z.array(z.string()).min(1),
});

const chartXY = chartLineBar.extend({
  footerLabel: z.string().optional().nullable(),
  /** Optional: tooltip header key for ChartTooltipLabelCustom (payload field). */
  tooltipLabelKey: z.string().optional().nullable(),
});

const chartRadar = z.object({
  title: z.string(),
  description: z.string().optional().nullable(),
  data: z.array(rowRecord).min(1),
  angleKey: z.string(),
  series: z.array(z.string()).min(1),
  footerLabel: z.string().optional().nullable(),
});

const chartPie = z.object({
  title: z.string(),
  description: z.string().optional().nullable(),
  data: z.array(rowRecord).min(1),
  nameKey: z.string(),
  valueKey: z.string(),
  footerLabel: z.string().optional().nullable(),
});

export const catalog = defineCatalog(schema, {
  components: {
    WeatherCard: {
      props: z.object({
        location: z.string(),
        temperature: z.number(),
        condition: z.string(),
        unit: z.enum(["celsius", "fahrenheit"]).optional(),
        humidity: z.number().nullable().optional(),
        windSpeed: z.string().nullable().optional(),
      }),
      description:
        "Card displaying current weather for a location (temperature, condition, optional humidity and wind)",
    },
    LineChart: {
      props: chartLineBar,
      description:
        "Line chart. Required: data, xKey (category field), series (value field names). Renders as-is.",
    },
    BarChart: {
      props: chartLineBar,
      description:
        "Bar chart. Required: data, xKey, series. Renders as-is.",
    },
    AlertDialog: {
      props: z.object({
        triggerLabel: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        confirmLabel: z.string().nullable().optional(),
        cancelLabel: z.string().nullable().optional(),
        variant: z.enum(["default", "destructive"]).nullable().optional(),
        actionId: z.string().nullable().optional(),
      }),
      description:
        "A button that opens a modal alert dialog for confirmations or important messages. Use for destructive actions, confirmations, or alerts requiring user acknowledgement. triggerLabel is the button text, title is the dialog heading, description is optional body text, confirmLabel/cancelLabel customize button text.",
    },

    ChartAreaDefault: {
      props: chartXY,
      description:
        "Simple area chart with natural curve, single or multiple series, and semi-transparent fill. Best for showing a single metric trend over time. Data: array of { xKey, ...seriesValues }.",
    },
    ChartAreaAxes: {
      props: chartXY,
      description:
        "Area chart with a visible Y-axis displaying scale labels. Use when the numeric axis scale must be clearly readable alongside the area.",
    },
    ChartAreaGradient: {
      props: chartXY,
      description:
        "Area chart with a gradient fill that fades from opaque at the top to transparent at the bottom. Elegant for dashboard metrics with multiple series.",
    },
    ChartAreaIcons: {
      props: chartXY,
      description:
        "Area chart with a legend that shows icon markers next to each series label. Use when series categories have recognizable icon representations.",
    },
    ChartAreaLegend: {
      props: chartXY,
      description:
        "Area chart with a legend panel below the chart for color-to-series identification. Use when displaying multiple series.",
    },
    ChartAreaLinear: {
      props: chartXY,
      description:
        "Area chart with straight linear interpolation between data points (no smoothing). Use for precise point-to-point connections.",
    },
    ChartAreaStacked: {
      props: chartXY,
      description:
        "Area chart with multiple series stacked on top of each other (stackId). Use to visualize part-to-whole relationships over time.",
    },
    ChartAreaStackedExpand: {
      props: chartXY,
      description:
        "Stacked area chart normalized to 100% (stackOffset expand). Use to show the relative proportion of each series over time rather than absolute values.",
    },
    ChartAreaStep: {
      props: chartXY,
      description:
        "Area chart with step (staircase) interpolation between data points. Use for discrete interval data or values that change abruptly.",
    },

    ChartBarDefault: {
      props: chartXY,
      description:
        "Simple vertical bar chart with rounded tops and a single data series. Standard choice for comparing categorical values.",
    },
    ChartBarActive: {
      props: chartXY,
      description:
        "Vertical bar chart with the first bar visually highlighted using a dashed stroke. Use when one category needs to stand out from the rest.",
    },
    ChartBarHorizontal: {
      props: chartXY,
      description:
        "Horizontal bar chart. Required: data, xKey (category column), series (value columns). Renders as-is.",
    },
    ChartBarLabel: {
      props: chartXY,
      description:
        "Vertical bar chart with numeric value labels displayed above each bar. Use when exact values must always be visible without hovering.",
    },
    ChartBarLabelCustom: {
      props: chartXY,
      description:
        "Bar chart with value labels positioned inside the top of the bars. Use for compact label display that does not extend above the bar.",
    },
    ChartBarMixed: {
      props: chartXY,
      description:
        "Bar chart where each bar is rendered in a different color drawn from the chart palette. Use for per-category color-coded data.",
    },
    ChartBarMultiple: {
      props: chartXY,
      description:
        "Grouped bar chart with multiple bars per x-axis category. Use to compare several metrics side-by-side within each category.",
    },
    ChartBarNegative: {
      props: chartXY,
      description:
        "Bar chart that colors bars red/blue based on positive or negative values. Use for variance, profit/loss, or delta data.",
    },
    ChartBarStacked: {
      props: chartXY,
      description:
        "Stacked bar chart showing the contribution of each series to the total per category. Use for breakdown or composition visualization.",
    },

    ChartLineDefault: {
      props: chartXY,
      description:
        "Simple smooth line chart without data point dots. Clean and minimal trend visualization for one or more series.",
    },
    ChartLineDots: {
      props: chartXY,
      description:
        "Line chart with circular dots rendered at every data point. Use when individual data points need visual emphasis.",
    },
    ChartLineDotsColors: {
      props: chartXY,
      description:
        "Line chart with dots colored individually per series. Use when series dots need distinct color differentiation.",
    },
    ChartLineDotsCustom: {
      props: chartXY,
      description:
        "Line chart with custom-styled dot markers using a filled circle with background. Use for a polished, branded point indicator.",
    },
    ChartLineLabel: {
      props: chartXY,
      description:
        "Line chart with numeric value labels displayed above each data point. Use when exact values must be visible at all times.",
    },
    ChartLineLabelCustom: {
      props: chartXY,
      description:
        "Line chart with value labels positioned inside each data point. Use for compact inline data annotations.",
    },
    ChartLineLinear: {
      props: chartXY,
      description:
        "Line chart with linear (straight) interpolation between points (no curve smoothing). Use for precise point-to-point connections.",
    },
    ChartLineMultiple: {
      props: chartXY,
      description:
        "Multi-line chart showing several data series in different colors with a legend. Use to compare multiple metrics over the same x-axis.",
    },
    ChartLineStep: {
      props: chartXY,
      description:
        "Line chart with step interpolation producing a staircase pattern. Use for discrete state changes, toggles, or stepped functions.",
    },

    ChartPieSimple: {
      props: chartPie,
      description:
        "Basic pie chart showing proportional segments. Use for part-to-whole comparisons with up to 6 categories. Data: array of { nameKey, valueKey }.",
    },
    ChartPieDonut: {
      props: chartPie,
      description:
        "Donut/ring chart (pie with hollow center, innerRadius=60). Cleaner look than a solid pie for proportional data.",
    },
    ChartPieDonutActive: {
      props: chartPie,
      description:
        "Donut chart with the first segment expanded outward to indicate active selection. Use for interactive proportion exploration.",
    },
    ChartPieDonutText: {
      props: chartPie,
      description:
        "Donut chart with the total sum displayed as large bold text in the center. Use when the aggregate KPI value needs center display.",
    },
    ChartPieLabel: {
      props: chartPie,
      description:
        "Pie chart with percentage/value labels rendered directly on each segment. Use when values should always be visible without hovering.",
    },
    ChartPieLabelCustom: {
      props: chartPie,
      description:
        "Pie chart with custom-content labels on each segment showing name and value. Use for styled or multi-line segment annotations.",
    },
    ChartPieLabelList: {
      props: chartPie,
      description:
        "Pie chart with a LabelList inside showing category names on segments. Use when segment names are short and need to be displayed inline.",
    },
    ChartPieLegend: {
      props: chartPie,
      description:
        "Pie chart with a color legend panel below the chart. Use for clear color-to-category identification without on-chart labels.",
    },
    ChartPieSeparatorNone: {
      props: chartPie,
      description:
        "Pie chart without gaps/strokes between segments (strokeWidth=0). Use for a seamless continuous ring appearance.",
    },
    ChartPieStacked: {
      props: chartPie,
      description:
        "Nested concentric donut rings (inner + outer) showing two-level proportion data. Use for hierarchical breakdown.",
    },

    ChartRadarDefault: {
      props: chartRadar,
      description:
        "Basic radar/spider chart with polygon grid. Use to compare multiple metrics across axis categories. Data: array of { angleKey, ...seriesValues }.",
    },
    ChartRadarDots: {
      props: chartRadar,
      description:
        "Radar chart with circular dots at each axis data point. Use when individual axis values need visual emphasis.",
    },
    ChartRadarGridCircle: {
      props: chartRadar,
      description:
        "Radar chart with circular grid rings instead of the default polygon. Use for a smoother, more modern radial appearance.",
    },
    ChartRadarGridCircleFill: {
      props: chartRadar,
      description:
        "Radar chart with circular grid rings and alternating fills between rings. Use for visually guided comparison zones.",
    },
    ChartRadarGridCircleNoLines: {
      props: chartRadar,
      description:
        "Radar chart with circular grid rings but without radial spoke lines. Use for a clean minimal circular radar.",
    },
    ChartRadarGridCustom: {
      props: chartRadar,
      description:
        "Radar chart with custom-styled dashed grid lines. Use for branded dashboards that need a distinct grid style.",
    },
    ChartRadarGridFill: {
      props: chartRadar,
      description:
        "Radar chart with alternating opaque fills between the polygon grid bands. Use to emphasize different value zones.",
    },
    ChartRadarGridNone: {
      props: chartRadar,
      description:
        "Radar chart without any grid lines (PolarGrid hidden). Use for a minimalist radar showing only the data polygon.",
    },
    ChartRadarIcons: {
      props: chartRadar,
      description:
        "Radar chart with icon images on axis angle labels. Use when axis categories have recognizable icon representations.",
    },
    ChartRadarLabelCustom: {
      props: chartRadar,
      description:
        "Radar chart with a custom-rendered PolarAngleAxis tick showing name and value. Use for richly formatted axis labels.",
    },
    ChartRadarLegend: {
      props: chartRadar,
      description:
        "Radar chart with a legend panel. Use when multiple radar series need color-to-label identification.",
    },
    ChartRadarLinesOnly: {
      props: chartRadar,
      description:
        "Radar chart showing only the outline polygon without filled area (fillOpacity=0). Use for a clean unfilled comparison.",
    },
    ChartRadarMultiple: {
      props: chartRadar,
      description:
        "Radar chart with multiple overlapping series. Use to compare profiles across different groups on the same axes.",
    },
    ChartRadarRadius: {
      props: chartRadar,
      description:
        "Radar chart with a visible PolarRadiusAxis displaying numeric scale values. Use when scale reference values must be readable.",
    },

    ChartRadialSimple: {
      props: chartPie,
      description:
        "Simple radial bar chart with a background track behind each bar. Use for progress or proportion visualization. Data: array of { nameKey, valueKey }.",
    },
    ChartRadialGrid: {
      props: chartPie,
      description:
        "Radial bar chart with circular grid rings providing scale reference. Use when scale context is important.",
    },
    ChartRadialLabel: {
      props: chartPie,
      description:
        "Radial bar chart with value labels rendered on the inside of each bar. Use when exact values must always be visible.",
    },
    ChartRadialShape: {
      props: chartPie,
      description:
        "Radial bar chart with rounded corner radius for a polished pill-shaped bar style. Use for visually distinctive progress indicators.",
    },
    ChartRadialStacked: {
      props: z.object({
        title: z.string(),
        description: z.string().optional().nullable(),
        desktop: z.number(),
        mobile: z.number(),
        footerLabel: z.string().optional().nullable(),
      }),
      description:
        "Semicircular half-donut radial chart stacking two metrics (desktop + mobile) with a total count in the center. Use for two-value comparison in compact semicircle form.",
    },
    ChartRadialText: {
      props: z.object({
        title: z.string(),
        description: z.string().optional().nullable(),
        value: z.number(),
        label: z.string().optional().nullable(),
        footerLabel: z.string().optional().nullable(),
      }),
      description:
        "Single radial progress bar with the numeric value and an optional label displayed large in the center. Use for a KPI gauge with a center metric.",
    },

    ChartTooltipDefault: {
      props: chartXY,
      description:
        "Bar chart demonstrating the default shadcn tooltip with a dashed indicator line. Use as the baseline reference for tooltip styling.",
    },
    ChartTooltipAdvanced: {
      props: chartXY,
      description:
        "Bar chart with an advanced multi-value tooltip that includes a total row. Use for rich multi-metric tooltips.",
    },
    ChartTooltipFormatter: {
      props: chartXY,
      description:
        "Bar chart with a custom value formatter in the tooltip (appends a unit string). Use when values need units or custom number formatting.",
    },
    ChartTooltipIcons: {
      props: chartXY,
      description:
        "Bar chart with icon indicators next to each series value in the tooltip. Use for color-coded icon legend inside the tooltip.",
    },
    ChartTooltipIndicatorLine: {
      props: chartXY,
      description:
        "Bar chart with a vertical line indicator style in the tooltip (indicator=line). Use for precise x-axis crosshair reference.",
    },
    ChartTooltipIndicatorNone: {
      props: chartXY,
      description:
        "Bar chart with no indicator in the tooltip (indicator=none). Use for minimal tooltips without any crosshair or dot indicator.",
    },
    ChartTooltipLabelCustom: {
      props: chartXY,
      description:
        "Bar chart with a custom-rendered label in the tooltip header showing additional context. Use for styled or richly formatted tooltip category labels.",
    },
    ChartTooltipLabelFormatter: {
      props: chartXY,
      description:
        "Bar chart with a labelFormatter that transforms the x-axis value in the tooltip header (e.g. formats dates). Use when the tooltip label needs transformation.",
    },
    ChartTooltipLabelNone: {
      props: chartXY,
      description:
        "Bar chart with the tooltip header label hidden (hideLabel). Use for minimal tooltips that omit the category/x-axis label.",
    },

    GeoMap: {
      props: geoMap,
      description:
        "Interactive MapLibre GL map (mapcn) rendered from SQL results. " +
        "Required: center [lat, lng]. " +
        "Data-driven markers: set data (SQL rows), latField + lngField (coordinate column names), labelField (marker tooltip + popup heading), popupFields (columns to show in the popup). " +
        "Explicit features: markers (static points with label/tooltip/fields), cluster (boolean — group nearby markers via MapLibre clustering), routes (polylines), arcs (curved origin→destination connectors for trips/flows). " +
        "Base style: styles.light/styles.dark MapLibre style URLs (defaults to CARTO light/dark, auto theme-aware). " +
        "Controls: controls.zoom/fullscreen/locate/compass (boolean toggles). " +
        "Use for: site locations, customer density, route lines, origin→destination flows, network tower clusters.",
    },
  },
  actions: {
    submit: {
      params: z.object({ formId: z.string() }),
      description: "Submit a form",
    },
    navigate: {
      params: z.object({ url: z.string() }),
      description: "Navigate to a URL",
    },
  },
});
