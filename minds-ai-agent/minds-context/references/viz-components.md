# Visualization components

Concrete MINDS visualization vocabulary: chart types, map layers, tables, cards, colours, legends, and states. Use these exact conventions when specifying a visualization.

## Brand / status tokens

| Token | Value | Use |
| --- | --- | --- |
| Material primary | `#009BAF` | App primary theme |
| minds-blue | `#0EC7D4` | accent text / gradient end |
| minds-blue-2 | `#009BAF` | side nav / light-mode app color |
| minds-blue-black | `#002A38` | headers, controls, buttons, dark mode |
| minds-pink | `#DF4C73` | accent |
| minds-red | `#F44336` | error / status where locally bound |
| minds-grey-disabled | `#BEBEBE` | disabled state |

Typography is Helvetica Neue with CSS-variable font sizes. These raw colors are **not** a cross-module status dictionary.

## Charts

**Shared Highcharts wrapper** — chart type/title/height, x-axis categories, optional dual axis, markers, tooltip, data labels, stacking. Defaults: y-axis starts at zero, decimals allowed, credits off, white-filled circle markers (1px line), area charts use the default area palette at 0.5 fill opacity, export/no-data/exporting modules loaded, print opens the chart in a new tab. Use for area/line/column/bar time-series and categorical comparisons.

**Pie/donut** — takes a Highcharts pie point array; controls title, size/inner size, labels, legend alignment/paging, value suffix, height, background, menu visibility. Points selectable; local default palette. Preserve the undefined-vs-empty input distinction.

**Heat map & grouped-stacked bars** — shared mainly by THD reporting; their data contract is narrower than the selector name suggests — follow the owning feature's transform.

**Specialized charts** — Visitor Dashboard, RAN Dashboard, and several reporting screens build chart options locally for bespoke hover/baseline/threshold/editable/axis/export behavior. Prefer the specialized owner when working on those screens; do not force them onto the shared wrapper.

## Maps & layers

- **Basemap** — Malaysia-centered Leaflet config with default and bin zooms, tile/layer names, elevation controls. Reuse it; do not hardcode new centers/tiles.
- **Site icons** — default Leaflet marker plus technology SVGs (2G/3G/4G/5G/MOCN) and state-specific 4G icons (congested, maintenance); layer-control/filter icons for technology and operational states.
- **Flags** — NC forecast/completed/in-progress/MCMC-feedback statuses map to 24×24 flag icons (not technology icons).
- **Layer colors** — separate coverage/congestion/HWC/5G/MOCN/highlight/CTT encodings; site technology colors are separate again. These belong to Network CEM map layers.
- **Bin categories** (5-step, very-good → very-bad):
  - very good `#21C4FD`
  - good `#29FD2E`
  - moderate `#F7FD37`
  - bad `#F88023`
  - very bad `#FF4B4B`
- Bin geometry uses defined weight/opacity/transparent-fill/outline styling. RF desktop/mobile components define their own category/rank resolvers + SCSS text classes — reuse the owner's resolver, do not hand-apply values.
- **Popups/legends** — map children create Leaflet popups/tooltips and emit selection events to the parent; legends open/close and reposition neighboring controls.

## Tables

**Shared table** — `header` supplies field id, visible label, optional width, sort-disable. `data` is tri-state (undefined=loading, null=error, empty=successful-empty). Optional footer, page-size, paginator visibility, elevation, overflow. Client-side sort/page. **Not** for server-paged ticket/user lists — those own specialized Material tables with server interaction.

**Styling** — `.minds-table` uses gray/white headers, compact rows, sticky paginator, optional green/blue intensity classes; loading overlay for the specialized variant.

**Status cells** — no universal status-badge component; Ticketing, RF quality, advisory, RAN, and churn each use feature-local pipes/classes/icon bindings.

## Cards, dialogs, filters

- **Cards** — Material cards for KPI summaries and detail groups; elevation, transparent/dark variants, disabled-data state.
- **Dialogs** — a shared message dialog for simple confirm/info; Material dialogs for site/cell/bin/HWC/KPI/ticket/user forms and details. Network CEM: selected map item updates side cards, buttons open deeper dialogs.
- **Filters** — compact search fields and outline controls; multi-select reporting filters with search + select-all/indeterminate; RAN has reusable searchable multi-select (max-selection, compact labels); THD has advanced date/dimension filters; Bulletin uses a month/year picker; RF quality uses single date/week/route controls. Keep the owner's date serialization (moment formatting is common); do not assume timezone conversion.

## States

| State | Pattern |
| --- | --- |
| Loading (global/compact) | `mat-progress-spinner.minds-spinner`; some cards use skeleton loaders |
| Chart loading / empty | Highcharts `showLoading`; empty series → `showNoData` |
| Shared table | tri-state input (undefined/null/empty) |
| Specialized table | loading-shade overlay + explicit error and "No data available" rows |
| Advisory field | `Error` + `.api-error` for failure; `NA` / "No data available" for absent value |
| Disabled control | Material disabled + grey-disabled token; feature flags often drive `[disabled]` |
| Map partial data | preserve basemap, clear the affected overlay/detail, show local spinner |

## Dark mode, print, responsive

- Dark mode is config-driven and persisted; global overrides cover shell, High Level, Network CEM, Visitor Dashboard, and Highcharts titles. Not every feature supports it — coverage is per-feature.
- Print rules specialize ticket details and chart printing; Highcharts also opens a print view.
- Flex-layout + media queries change columns/gaps; Network CEM RF submodes use explicit viewport-height map containers.

## Status assets

- Churn status: happy / angry / not-available SVGs.
- Network/site/NC icons live under the map assets and are mapped by constants.
