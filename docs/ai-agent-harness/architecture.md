# AI Agent Harness — Architecture

## Overview

The harness is a deterministic multi-agent pipeline that converts a natural-language data question into a SQL query, executes it, transforms the results, and returns a fully-rendered visualization spec alongside a natural-language answer.

**Key invariant:** Database row values never reach any LLM. Every agent sees only metadata (column names, types, row counts), user intent, and retrieved schema context.

---

## Harness Loop Diagram

```
User question
      │
      ▼
┌─────────────┐   clarification needed?
│ IntentAgent │──────────────────────────► SafeErrorResponse
└──────┬──────┘
       │ intentSummary, schemaQuery, visualizationIntent
       ▼
┌──────────────────┐   context.sufficient=false?
│  ContextAgent    │──────────────────────────────► SafeErrorResponse
│  (LightRAG tool) │
└────────┬─────────┘
         │ RetrievedContext (schema docs, references)
         ▼
┌─────────────┐  validation fails (up to MAX_SQL_RETRIES=2)
│  SqlAgent   │◄────────────────────────────────────┐
└──────┬──────┘                                      │
       │ generated SQL                               │
       ▼                                             │
┌────────────────┐  invalid? ──────────────────────►─┘ (after retries → SafeErrorResponse)
│ SqlSafetyService│
└────────┬───────┘
         │ normalizedSql (SELECT only, LIMIT enforced)
         ▼
┌────────────────────┐
│ SqlExecuteHarness  │  ← executes against MariaDB
│      Tool          │    stores rows in QuarantinedRows
└────────┬───────────┘    (rows never leave this object)
         │ QueryExecutionMeta (columns, rowCount, executionMs)
         ▼
┌────────────────────┐
│  TransformAgent    │  ← sees metadata only, no row values
└────────┬───────────┘
         │ JMESPath expression
         ▼
┌────────────────────────────────────┐
│  TransformExecuteService (Backend  │  ← accesses QuarantinedRows.rows
│  Deterministic ETL — NO LLM)       │    produces dataState
└────────────────┬───────────────────┘
                 │ dataState (visualization-ready object)
                 ▼
┌──────────────────────┐
│ VisualizationAgent   │  ← sees column metadata + dataState shape only
│ (JsonRenderTool)     │    produces json-render spec
└──────────┬───────────┘
           │ spec (component tree with $.path references)
           ▼
┌─────────────┐
│ AnswerAgent │  ← sees metadata only, writes NL answer
└──────┬──────┘
       │
       ▼
 TextToSqlVisualizationResponse
  ├── answer (string)
  ├── sql.text, sql.readOnly=true
  ├── visualization.spec (json-render tree)
  ├── visualization.dataState (row-transformed object)
  ├── visualization.transformExpression (JMESPath)
  └── audit (noDatabaseDataPassedToLlm=true, checkedAgents)
```

---

## Agent Responsibilities

| Agent | Input (safe) | Output | LLM? |
|-------|-------------|--------|------|
| `IntentAgent` | User question | intentSummary, schemaQuery, clarificationNeeded | Yes |
| `ContextAgent` | schemaQuery | RetrievedContext (schema docs) | No — calls LightRAG HTTP API |
| `SqlAgent` | User question + schema context | SELECT SQL | Yes |
| `TransformAgent` | Column metadata, rowCount, SQL text | JMESPath expression | Yes |
| `VisualizationAgent` / `JsonRenderTool` | Column metadata, transform shape | json-render spec | No — deterministic |
| `AnswerAgent` | Column metadata, rowCount, executionMs | Natural-language answer | Yes |

---

## LLM Data Boundary

The `LlmDataBoundaryGuard` (`src/ai/mastra/safety/llm-data-boundary.guard.ts`) is called before **every** LLM invocation via `assertClean()`. It inspects the payload for:

- Forbidden keys: `rows`, `resultrows`, `records`, `datastate`, `queryresult`, `rawresult`, `dbrows`, `tablerows` (case-insensitive)
- `QuarantinedRows` objects (`__kind === 'QUARANTINED_DATABASE_ROWS'`)
- Arrays of 5+ objects at any level (looks like a database result set)

If a violation is found, `assertClean()` throws and the entire harness run fails with an audit error. Every LLM call produces a `LlmDataBoundaryAudit` record that is included in the final `TextToSqlVisualizationResponse.audit`.

---

## LightRAG Flow

```
ContextAgent.run()
  └─► LightragHarnessTool.asTool().execute({ query, mode: 'mix', topK: 10 })
        └─► POST ${LIGHTRAG_API_URL}/query/stream
              body: { query, mode, stream: true, include_references: true, top_k }
              ↓ response: NDJSON stream
              ↓ lines: { response: "..." } | { references: [...] } | { error: "..." }
        └─► parseNdjsonResponse(): assemble chunks, extract references
        └─► sufficient = answer.length > 100
        └─► return RetrievedContext { answer, documents, references, sufficient, contextSummary }
```

If `sufficient=false`, the harness short-circuits before SQL generation and returns a safe error response.

---

## SQL Safety Flow

`SqlSafetyService.validate(rawSql)` is called **twice** (defence in depth):

1. Inside the `generate_sql → validate_sql` phase of the harness loop (first check)
2. Inside `SqlExecuteHarnessTool.executeValidatedSql()` (second check before execution)

The validator:
1. Strips SQL comments (block, line, hash)
2. Detects multi-statement SQL (`;` not at end)
3. Checks block patterns: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, EXEC, CALL, xp\_, sp\_, INTO OUTFILE, LOAD\_FILE, LOAD DATA, SHUTDOWN, SLEEP, BENCHMARK, WAITFOR
4. Enforces SELECT or WITH (CTE) only
5. Auto-appends `LIMIT 200` to non-aggregate queries missing a LIMIT

If validation fails, the harness retries SQL generation up to `MAX_SQL_RETRIES=2`, passing the fail reason back to `SqlAgent` for correction.

---

## ETL / JMESPath Flow

```
TransformAgent.generate(state, meta)
  └─► LLM sees: question, column names/types, rowCount, SQL text, visualizationIntent
  └─► returns: transformExpression (JMESPath string), targetDataShape

TransformExecuteService.execute(quarantinedRows, transformExpression)
  └─► validates expression (jmespath.compile check)
  └─► jmespath.search(quarantinedRows.rows, transformExpression)
  └─► normalizeToDataState(): produces { series?, rows?, data?, summary: { rowCount, columnCount } }
  └─► returns: { dataState, transformExpression, transformExpressionHash }
```

**This is the only place `QuarantinedRows.rows` is accessed.** No LLM is involved. The resulting `dataState` is passed to the frontend.

---

## json-render Contract

The `VisualizationAgent` / `JsonRenderTool` produces a component tree spec. Frontend renders it using the `json-render` renderer.

**Allowed components** (from `component-allowlist.ts`):
- Layout: `Dashboard`, `Panel`, `Tabs`, `Grid`
- Charts: `BarChart`, `LineChart`, `PieChart`, `ScatterChart`, `AreaChart`
- Data display: `DataTable`, `MetricCard`, `StatCard`, `KPICard`, `Timeline`, `GeoMap`
- Text: `Text`, `Heading`, `Markdown`

Data references in specs use `$.path` expressions pointing into `dataState`, e.g.:
```json
{ "type": "BarChart", "dataPath": "$.series", "labelKey": "label", "valueKey": "value" }
```

The `JsonRenderSchemaService.validate()` / `repair()` methods strip injection fields and enforce the allowlist.

---

## Streaming Event Contract

Events are written to the SSE stream via `HarnessStreamAdapter`. Each event is a `HarnessStreamEvent` object:

```ts
{
  type: 'run.started' | 'agent.started' | 'agent.delta' | 'agent.completed'
       | 'tool.started' | 'tool.completed' | 'mode.changed'
       | 'audit.completed' | 'run.completed' | 'run.failed',
  runId: string,
  mode: DataAgentMode,
  agent?: string,
  tool?: string,
  textDelta?: string,
  payload?: Record<string, unknown>,
  timestamp: string   // ISO 8601
}
```

**Event sequence for a successful run:**
```
run.started
mode.changed { mode: 'intent' }
agent.started { agent: 'IntentAgent' }
agent.delta   { textDelta: 'Analyzing question intent...' }
agent.completed
mode.changed { mode: 'retrieve_context' }
agent.started { agent: 'ContextAgent' }
agent.delta
tool.started  { tool: 'harness_retrieve_context' }
tool.completed { sufficient, documentCount }
agent.completed
mode.changed { mode: 'generate_sql' }
... (SQL generation, validation, execution, transform, visualize, answer) ...
audit.completed
run.completed { iterations, rowCount }
```

The frontend strips unknown event types before passing to AssistantUI.
