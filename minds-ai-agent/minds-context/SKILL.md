---
name: minds-context
description: >
  Use this skill to choose the correct MINDS visualization for a user's
  question — which chart, map, table, or card MINDS already uses to present a
  given dataset, metric, status, or geographic signal, and how to configure it
  (type, colours, legend, states). Trigger on any request mentioning MINDS
  datasets, fields, metrics, statuses, coordinates, complaints, tickets, RF or
  RAN KPIs, churn, bins, clusters, regions, or asking "how should this be
  shown / what chart / what map / what visualization."
---

# MINDS visualization selector

Given a user question, decide how MINDS presents that data. These references encode MINDS's own conventions — treat them as the source of truth and never substitute generic charting advice.

## How to answer

1. **Extract signals** from the question: entity/metric names, statuses, geography (state, cluster, bin, coordinates), time grain (week, month, year), identifiers (MSISDN, IMSI, site, ticket), and the **intent** — overview, trend, comparison, ranking, drill-down, single lookup, or list.
2. **Find the owning feature** in [feature-map.md](references/feature-map.md). MINDS routes presentation by feature, not by data shape — the same field is shown differently in different modules.
3. **Match a row** in the decision table in [visualization-rules.md](references/visualization-rules.md), then read the relevant type rule (geographic / time-series / status-colour / edge-state).
4. **Get the concrete spec** — chart type, map layer, colour, legend, table/card, states — from [viz-components.md](references/viz-components.md).
5. **Answer** in the format below. If two presentations match, prefer the one owned by the feature that owns the data. If none matches, say so — do not invent a generic chart.

Do not infer a visualization from field names or coordinates alone: a lat/long field is not always a map, and repeated dates are not always a line chart. The owning feature decides.

## Response format

```markdown
## Data
<what the question is about + the intent, one line>

## Owning feature
<module + route>

## Recommended visualization
<the MINDS presentation, e.g. "Colored hex-bin layer with 5-step RSRP legend + bin detail popup">

## Configuration
- Component / chart type:
- Colours / legend:
- Interaction:
- Empty / loading / error:

## Notes
<transformation needed, or "Unresolved — no matching MINDS pattern">
```

Keep it concise. Omit sections that do not apply; never invent a pattern MINDS does not use.
