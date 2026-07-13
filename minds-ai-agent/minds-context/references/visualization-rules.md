# Visualization rules

MINDS-specific mappings from data/intent to visualization. First identify the owning feature ([feature-map.md](feature-map.md)), then apply its rule. These override any generic charting instinct.

## Decision table

| Data / question signal | MINDS visualization | Transformation note |
| --- | --- | --- |
| Network CEM search result with a position | Center/select the active Leaflet map, then load feature-specific context — the position is an **anchor**, not its own layer | Normalize to name + coordinates; route by active submode |
| Site records with technology/status | Technology/status **marker layer** + popup/detail card | Group/filter by tech/status; use the mapped icon, not a generic dot |
| Bin GeoJSON with RSRP / RSRQ / throughput | **Colored hex/polygon layer** + legend + bin-detail popup | Classify with the *matching* threshold set; keep transparent default |
| RF-quality route/track/bin payload | **Route polyline** + colored bin map + route/list/detail dialog | Convert geometry; resolve category/rank to local colors; apply date/week filter |
| PTT region/cluster geometry | **Region/cluster polygons** + summary, then drill to cluster → grid → bin | Normalize geometry, status, count ratios; switch map mode; load children on select |
| PTT cell data for a selected grid/bin | **Paginated table / detail card** linked to the map selection | Flatten nested `{value, category}` metrics, keep the category |
| CTT/NTT with coordinates in Network CEM | **Map markers** + dialog/detail, optionally date-filtered | Parse positions; filter by ticket/date/site/MSISDN as the flow specifies |
| CTT/NTT counts/regions in High Level | **KPI cards / table / regional map** — aggregate summary, not a ticket workflow | Aggregate/format counts and regional significance |
| Subscriber/advisory data for one IMSI/MSISDN | **Labeled cards + expandable detail sections** — detail, not aggregate reporting | Normalize values/statuses; keep API error separate from absent value |
| THD parallel series by category / month / year | The feature's existing **Highcharts** view | Map arrays to ordered categories + named series; use the owner's tooltip/axis config |
| THD geographic aggregate by state/cluster | **Heat map** + companion summary/table | Map to heat-map data + table rows; share the active global filter |
| THD historical record list | **Sortable/paginated table** with filter + CSV export | Apply global + local filters; flatten rows |
| Bulletin monthly subscribers & complaints | **Cumulative/monthly combo chart** | Keep `months` and the parallel series index-aligned |
| Churn category ratios/classifications | The owner's **churn chart/card** | Transform into the owner's series + pay-type context |
| Ookla weekly coverage / sampling / download | **Specialized Material table** — preserve paired rows/columns | Select week; normalize technology/coverage/sampling/download columns |
| RAN KPI by technology / vendor / KPI / time / geography | The owning tab's **specialized Highcharts/table** (By Region, Service Status, Worst Cell, RAN KPI) | Derive vendor/KPI list from technology; add baseline/target |
| Ticket collection with count/sort/filter | **Server-paged, selectable Material table** | Send server page/sort/filter; request total separately |
| Portal user collection | **Server-paged Material table** + dialogs | Search only past the character threshold; load total + page |
| Single scalar summary | **KPI card** with unit/suffix and update state | Apply the service formatter; keep `NA`/percentage/unit convention |
| `undefined` / `null` / `[]` into a shared table/chart | Component's built-in **loading / error / empty** behavior | Do not collapse falsy values — each has distinct meaning (see edge states) |

## Geographic rules

- **Search position vs rendered dataset** — In Network CEM a searched position primarily anchors/centers the active map; the active child decides whether to center, query, or render detail. A lat/long field elsewhere (THD Advisory, Ticketing) does **not** imply that screen needs a primary map.
- **Markers vs layers** — Sites use distinct technology and operational-state icons; coverage/congestion/HWC/5G/MOCN are polygon/vector layers with their own styles. Never render a site as a generic colored circle when a mapped icon exists.
- **Exceptions** — PTT region/cluster status uses polygons with local good/bad/NA colors; bin/RF-quality uses colored bins driven by metric categories; NC statuses use flag icons, not technology icons.
- **Bin classification** — Visualization Bin uses parameter-specific thresholds (RSRQ, RSRP, throughput each have their own range + legend). The 5 category colors run very-good → very-bad. Resolve the active parameter **first**; never apply RSRP cutoffs to SINR/RSRQ or to an API-preclassified PTT metric.
- **Cluster/grid drill-down** — PTT separates `pin_drop` and `cluster` modes. Region → clusters → geometry/detail + bin summary → grid/bin → PTT cell records + parent detail. Keep the map alongside so selection context is not lost.

## Time & series rules

- **THD filters** — THD screens share a global filter plus optional local historical filters; Overall, Coverage & Congestion, and VIP have different stored keys. A new series must use its owner's filter and the endpoint's supported dimensions. Bulletin month/year arrays must stay index-aligned.
- **RAN technology drives KPIs** — Selecting technology changes vendor and the allowed KPI list (4G, MOCN→maxis, 5G→dnb, 5GSA→dnb_sa). Use each KPI's request key vs visible label correctly; use its industry target only when nonempty; pick the constant for the owning tab, not the broadest list.
- **Chart type is feature-owned** — The existing feature code decides whether a dataset is area, line, column, bar, etc. When extending a screen, clone the nearest connected chart config; do not pick a chart type from data shape alone.

## Summary vs detail

- High Level & Visitor Dashboard: **cards** for aggregated headline values, **charts/maps** for distribution and trends.
- Network CEM: compact site cards first; buttons open dialogs for full site/KPI/ticket/maintenance/congestion/bin/HWC detail.
- THD Advisory: top-level profile/summary immediately; device/usage/speed/voice/network/RF behind "Show details."
- Internal Ticketing: list queue first, then a dedicated detail/print workflow.
- PTT: keep the map alongside summary/detail.

## Status & color rules

Status colors are **feature-local** — the same label can look different across modules. There is no universal status dictionary.

- **Churn** — Only Subscriber Profiling maps `loyal`→happy icon, `churn`→angry icon, other/missing→not-available.
- **Bin / RF quality** — Use the owning desktop/mobile component's category/rank resolver; its SCSS defines the text/background variants.
- **PTT aggregate status** — `Good` / `Bad` / `NA` map to local boundary/fill variants; do not globalize these colors.
- **RAN target comparison** — Worst Cell compares value against the KPI's target with a dedicated parser; do not compare raw strings.
- **Ticket status** — Internal Ticketing uses its own status pipe/classes; NC flag statuses in Network CEM use a separate asset mapping.

## Interaction rules

| Context | Interaction |
| --- | --- |
| Network CEM autocomplete | Selection updates the relevant map/search state; Enter handles direct lat/long and PTT grid search |
| Leaflet features | Click → popup/detail/card or next drill-down; layer controls + legends stay visible |
| Network CEM side cards | Buttons open Material dialogs; availability depends on the selected data |
| THD reports | Filter change reloads connected widgets; historical tables page/sort/export |
| Shared Highcharts | Export menu (print/data); loading + no-data handled by the wrapper |
| THD Advisory | Info icons open tooltips/menus; summary and details have independent loading/error |
| Internal Ticketing | Row/action → details/dialogs; server page/sort/filter retained; destructive actions role-gated |
| RAN Dashboard | Parent toggle switches kept-alive tabs; filters cascade and auto-submit when complete |

## Edge-state rules

- **Shared table** data is tri-state: `undefined` = loading (spinner), `null` = error, empty array = successful-empty, nonempty = render. Do not normalize these upstream.
- **Shared Highcharts**: `undefined` → showLoading; empty series → showNoData; populated → update. Pie/donut follows the same undefined-vs-empty distinction.
- **THD Advisory** distinguishes API failure (`Error`) from missing successful value (`NA` / "No data available").
- **Maps** preserve the basemap while showing a spinner or clearing the affected overlay/detail.
- **Server-paged tables** retain total/count and page state even when the current page is empty.

## Fallback

If more than one visualization matches:
1. Prefer the active owner's presentation.
2. Prefer a component the owner already uses over a cross-module lookalike.
3. If no matching MINDS pattern exists, report the candidates and mark the choice **Unresolved** — do not pick on generic UI convention.
