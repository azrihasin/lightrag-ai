# Feature map

Which MINDS feature owns which data, and its default presentation. Presentation is chosen by **owner**, not by data shape — resolve the owner before picking a visualization.

## Feature inventory

| Feature | Route | Shows | Primary visualization |
| --- | --- | --- | --- |
| High Level | `/high-level` | Coverage, site totals, CTT/NTT, planned maintenance, regional counts | KPI cards, tables, regional map |
| Network CEM · Service Status | `/network-cem` (default) | Search + sites/cells, layers, CTT/NTT, maintenance/congestion | Leaflet map + side cards/dialogs |
| Network CEM · Visualization Bin | Network CEM toggle | Geographic bins: RSRP/RSRQ/throughput performance | Colored hex-bin layers, legends, dialogs |
| Network CEM · Sub Route | Network CEM toggle | RF quality by route | Route/bin Leaflet map + dialogs/tables |
| Network CEM · Sub Mobility | Network CEM toggle | Subscriber mobility, worst MSISDN, bin/route | Leaflet map + filter/list/detail dialogs |
| Network CEM · PTT | Network CEM toggle | Region/cluster/grid/bin/cell drill-down, NC statuses | Leaflet polygons/markers + tables/cards |
| THD Reporting | `/thd-reporting/*` | Complaint / coverage-congestion / bulletin / VIP analytics | Heat maps, charts, tables, filters, CSV |
| THD Advisory | `/thd-advisory/mobile-advisory` | One subscriber's customer/usage/voice/RF/site/network context | Search + cards / expandable detail |
| Subscriber Profiling | `/subscriber-profiling/churn-profile` | IMSI churn profile | Search + status metric cards |
| Churn Reporting | `/report/churn-reporting/*` | Overall + voluntary churn analysis | Highcharts / card views |
| Ookla Reporting | `/report/ookla-reporting/*` | Weekly coverage/download + regional speed coverage | Specialized Material tables |
| Internal Ticketing | `/internal-ticketing` (+ `/print`) | Ticket lifecycle, groups, feedback, files, remarks | Server-paged table + detail/dialogs |
| File Repository | `/file-repository` | File metadata | Table/list with download |
| Visitor Dashboard | `/visitor-dashboard` | Visitors, QoE, throughput, latency | KPI cards + specialized Highcharts |
| RAN Dashboard | `/opti-reporting` | Regional / service-status / worst-cell / weekly RAN KPI | Specialized charts, tables, toggle tabs |
| User Management | `/user-management` | Portal user CRUD | Server-paged table + dialogs |

## Recognize the data → owner

Match several signals together, not a single field name.

- **Search result, address/site/case/MSISDN/cluster/grid, lat-long** → Network CEM (anchors the active map).
- **Site + technology/vendor/congestion/status, cell details** → Network CEM Service Status / PTT.
- **Bin with RSRP / RSRQ / throughput / SINR** → Network CEM Visualization Bin (or RF quality for route/mobility bins).
- **Route / track / worst MSISDN / mobility** → Network CEM Sub Route / Sub Mobility.
- **Region / cluster / grid / PTT cell, good-bad-NA counts, GeoJSON polygon** → Network CEM PTT.
- **CTT / NTT ticket-shaped record with coordinates** → Network CEM map overlay; **CTT/NTT counts by region** → High Level aggregate.
- **Complaints by month/week/state/cluster, project/root-cause/SLA** → THD Reporting (Overall / Cov-Cong / Bulletin / VIP are distinct owners).
- **One MSISDN's full customer/usage/voice/RF context** → THD Advisory.
- **IMSI + churn status (loyal/churn)** → Subscriber Profiling.
- **Churn ratios / pay-type / reason classification** → Churn Reporting.
- **Weekly technology coverage / sampling / download speed** → Ookla Reporting.
- **KPI by technology/vendor/target, worst cells, weekly RAN** → RAN Dashboard.
- **Ticket queue with status/assignment/escalation/attachments** → Internal Ticketing (richer than Network CEM's `InfoCTT`).
- **Visitor / QoE / throughput / latency summary** → Visitor Dashboard.

## Cross-module cautions

- **CTT and NTT are distinct data shapes** and their acronyms are not defined in-repo — do not merge them or expand the acronyms.
- **`InfoCTT` (Network CEM) ≠ the Internal Ticketing ticket** (keyed by `ctt2`) — Network CEM shows map context; Internal Ticketing owns the full workflow.
- **MSISDN** (10–12 digits) and **IMSI** (max 15) are search identifiers, not display metrics.
- **The same status label** (Good/Bad/NA, loyal/churn) has **feature-local colors** — never reuse one module's colors elsewhere.
- **The same coordinates** are not enough to choose a presentation outside Network CEM.
- Many backend responses are typed as `any`; treat the frontend transform + template as the effective contract and mark unknown backend semantics as externally defined.
