# Harness Implementation Handover

## Current Status: Phase 9 in progress (out of 13)

The full task spec is in:
`minds-ai-agent/codex_mastra_text_to_sql_agent_harness_tasks.md`

---

## What Has Been Implemented

### New files created under `src/ai/mastra/`

| File | Purpose |
|------|---------|
| `harness/harness.types.ts` | All shared types: DataAgentMode, HarnessRunState, HarnessStreamEvent, QuarantinedRows, TextToSqlVisualizationResponse, helpers (makeRunId, hashPayload, etc.) |
| `harness/data-agent-harness.service.ts` | Main runtime loop (intent→context→sql→validate→execute→transform→visualize→answer), MAX_ITERATIONS=8, SQL retry up to 2x |
| `harness/harness-stream.adapter.ts` | Wraps the UIMessageStream writer and emits HarnessStreamEvent sidecar SSE objects |
| `safety/sql-safety.service.ts` | Deterministic SQL validator: blocks DDL/DML, strips comments, enforces LIMIT, multi-statement rejection |
| `safety/llm-data-boundary.guard.ts` | Inspects every LLM payload for forbidden keys (rows, dataState, etc.) — blocks and audits |
| `safety/audit.service.ts` | Per-run audit log, buildFinalAuditSummary for response |
| `visualization/component-allowlist.ts` | JSON_RENDER_COMPONENT_ALLOWLIST constant + isAllowedComponent() |
| `visualization/json-render.schema.ts` | JsonRenderSchemaService: validates spec against allowlist, strips injection fields, repair() method |
| `tools/lancedb-retrieve.tool.ts` | LancedbRetrievalTool — LanceDB hybrid search (vector + BM25/RRF), returns the schema whitelist JSON |
| `tools/sql-validate.tool.ts` | SqlValidateHarnessTool — wraps SqlSafetyService as a Mastra tool |
| `tools/sql-execute.tool.ts` | SqlExecuteHarnessTool — re-validates before execution, quarantines rows, returns QueryExecutionMeta only |
| `tools/transform-plan.tool.ts` | TransformPlanTool — infers JMESPath expression from column metadata (no rows) |
| `tools/transform-execute.tool.ts` | TransformExecuteService — applies JMESPath to QuarantinedRows.rows, produces dataState |
| `tools/json-render.tool.ts` | JsonRenderTool — builds spec from column metadata + intent, validates against allowlist |
| `agents/intent.agent.ts` | IntentAgentService — extracts intent, schemaQuery, visualizationIntent from user question |
| `agents/context.agent.ts` | ContextAgentService — calls LancedbRetrievalTool, returns RetrievedContext |
| `agents/sql.agent.ts` | SqlAgentService — generates SELECT SQL from retrieved schema context only, supports retry with failReason |
| `agents/transform.agent.ts` | TransformAgentService — generates JMESPath from column metadata (no rows) |
| `agents/visualization.agent.ts` | VisualizationAgentService — delegates to JsonRenderTool, validates/repairs spec |
| `agents/answer.agent.ts` | AnswerAgentService — writes natural-language answer from metadata only |
| `ai-mastra.module.ts` | NestJS module, imports DatabaseModule, initializes all agents in onModuleInit |

### Modified files

| File | Change |
|------|--------|
| `src/chat/chat.module.ts` | Added `AiMastraModule` to imports |
| `src/chat/chat.service.ts` | Injected `DataAgentHarnessService`; added `isDataQuestion()` router; data questions go to harness, general questions go to existing supervisor |

### Docs created
- `docs/ai-agent-harness/repo-findings.md` — Phase 0 codebase findings

---

## What Is Still TODO

### Phase 9 — finish chat.service wiring
- There is an open TS diagnostic on line 89 of `chat.service.ts` — already fixed with `writer as any` cast, verify it's clean with `npm run build`.

### Phase 10 — verify NestJS integration
- Run `npm run build` from `minds-ai-agent/` and fix any remaining TS errors.
- The `AiMastraModule` provides `DataAgentHarnessService` which is imported by `ChatModule`. This should work.

### Phase 12 — Tests

Create these test files:

**`src/ai/mastra/safety/sql-safety.service.spec.ts`**
- Test: reject INSERT, UPDATE, DELETE, DROP, ALTER
- Test: reject multi-statement SQL
- Test: enforce LIMIT on detail queries
- Test: accept SELECT with LIMIT
- Test: accept WITH queries

**`src/ai/mastra/safety/llm-data-boundary.guard.spec.ts`**
- Test: block payload with `rows` key containing non-empty array
- Test: block payload with `dataState` key
- Test: block QuarantinedRows object
- Test: pass clean payload
- Test: block large object arrays at root

**`src/ai/mastra/harness/data-agent-harness.service.spec.ts`** (integration-style with mocks)
- Test: normal successful path emits all stream events
- Test: insufficient retrieved context returns safe error response
- Test: SQL validation failure triggers retry up to MAX_SQL_RETRIES
- Test: SQL failure after max retry returns safe error response
- Test: final response contains visualization.spec and visualization.dataState
- Test: ETL does NOT call any LLM

**`src/ai/mastra/tools/lancedb-retrieve.tool.spec.ts`**
- Test: hybrid search returns the schema whitelist JSON
- Test: empty schema when no chunks match
- Test: falls back to vector search when FTS is unavailable
- Test: handles retrieval exceptions safely

### Phase 13 — Docs

Create:
- `docs/ai-agent-harness/architecture.md` — harness loop diagram, agent responsibilities, LLM data boundary, retrieval flow, SQL safety flow, ETL/JMESPath flow, json-render contract, streaming event contract
- `docs/ai-agent-harness/local-dev.md` — env vars, how to prepare the LanceDB table, how to start backend, example prompt, example SSE event sequence

---

## Key Architecture Notes

- `QuarantinedRows.__kind === 'QUARANTINED_DATABASE_ROWS'` — the guard detects and blocks this if passed to any LLM.
- `SqlSafetyService.validate()` is called **twice**: once by SqlAgent (via harness) and once inside `SqlExecuteHarnessTool.executeValidatedSql()` — defence in depth.
- `TransformExecuteService.execute()` is the ONLY place `QuarantinedRows.rows` is accessed — no LLM is involved.
- `DataAgentHarnessService.run()` owns the full state machine. It is injected into `ChatService` and called when `isDataQuestion()` returns true.
- Stream events are plain sidecar objects written via `(writer as any).write(event)` — the frontend already handles unknown event types by stripping them before AssistantUI.

---

## Build Command

```bash
cd minds-ai-agent
npm run build
```

Fix any TypeScript errors before writing tests.
