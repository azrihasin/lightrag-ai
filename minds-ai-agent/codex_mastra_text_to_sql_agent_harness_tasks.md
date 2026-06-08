# Codex Task List: Mastra Text-to-SQL Agent Harness with LanceDB hybrid retrieval and json-render

## Goal

Implement a complete but focused Mastra agent harness for this flow:

```txt
User prompt
  -> harness runtime loop
  -> intent/strategy step
  -> ContextAgent retrieves schema context from the LanceDB hybrid search
  -> SQL Agent generates read-only SQL from retrieved context only
  -> SQL Safety validates and normalizes SQL
  -> backend executes SQL against MariaDB
  -> Transform Agent creates deterministic ETL/JMESPath plan without seeing row data
  -> backend ETL applies transform to real rows
  -> Visualization Agent creates json-render spec without seeing row data
  -> frontend receives streamed harness timeline + final json-render spec + dataState
```

The implementation must feel like Claude Code / Codex: the frontend should see which agent/step/tool is currently active, the active agent output should stream in real time, and the backend should run a controlled loop rather than one large prompt.

## Hard Requirements

- Use Mastra for agents, tools, workflows, and harness orchestration.
- Keep the existing `chat.service` streaming approach using AI SDK `pipeUIMessageStreamToResponse`.
- Use the LanceDB hybrid search as the required schema/context retrieval source before SQL generation.
- Use existing environment variables only. Do not add new env vars.
- Do not implement authentication for now.
- Never pass database rows, samples, cell values, query results, or transformed query data to any LLM.
- LLMs may see only user question, retrieved schema context, schema metadata, column names/types, row count, SQL text, visualization intent, and transform expressions.
- SQL must be read-only and validated before execution.
- Database execution must happen only in backend code.
- Data transformation must happen only in deterministic backend ETL/JMESPath-like code.
- json-render output must use a component allowlist.
- Every LLM call must be audited to prove no database data was included.
- Return a frontend-renderable response with `visualization.spec` and `visualization.dataState`.

## Existing Environment Variables Only

Use this exact existing contract. Do not add new variables.

```txt
AI_PROVIDER=openai                 # openai or anthropic
AI_MODEL=gpt-4o-mini
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LANCEDB_DIR=
EMBEDDING_MODEL=text-embedding-3-large
MARIADB_HOST=localhost
MARIADB_PORT=3306
MARIADB_USER=root
MARIADB_PASSWORD=
MARIADB_DATABASE=minds
CHAT_DB_HOST=falls back to MARIADB_HOST
CHAT_DB_PORT=falls back to MARIADB_PORT
CHAT_DB_USER=falls back to MARIADB_USER
CHAT_DB_PASSWORD=falls back to MARIADB_PASSWORD
CHAT_DB_NAME=minds_chat
CHAT_DB_CONNECTION_LIMIT=10
CHAT_STORE_THINKING=false
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=*
```

Safety features such as no-row-data-to-LLM, SQL validation, and LLM payload audit must always be enforced in code and must not depend on env flags.

---

# Phase 0: Repository Reconnaissance

## Task 0.1: Inspect current codebase

Find and document:

- NestJS app/module structure.
- Current `chat.service` and `pipeUIMessageStreamToResponse` usage.
- Current AI SDK/provider setup for `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY`.
- Current MariaDB connection code.
- Current schema-retrieval usage if any.
- Current frontend stream/UI message format.
- Test framework.

Create:

```txt
docs/ai-agent-harness/repo-findings.md
```

Acceptance:

- No behavior changes.
- Findings include actual file paths to modify.

---

# Phase 1: Mastra Setup

## Task 1.1: Add Mastra dependencies

Add only required packages, for example:

```txt
@mastra/core
@mastra/nestjs
zod
jmespath
```

Use existing AI SDK/provider packages if already present. Do not add duplicate provider stacks.

Acceptance:

- App builds.
- No new env vars.

## Task 1.2: Create focused Mastra module structure

Create a minimal structure:

```txt
src/ai/mastra/
  mastra.ts
  agents/
    intent.agent.ts
    context.agent.ts
    sql.agent.ts
    transform.agent.ts
    visualization.agent.ts
    answer.agent.ts
  tools/
    lancedb-retrieve.tool.ts
    sql-generate.tool.ts
    sql-validate.tool.ts
    sql-execute.tool.ts
    transform-plan.tool.ts
    transform-execute.tool.ts
    json-render.tool.ts
  harness/
    data-agent-harness.service.ts
    harness.types.ts
    harness-stream.adapter.ts
  safety/
    sql-safety.service.ts
    llm-data-boundary.guard.ts
    audit.service.ts
  visualization/
    json-render.schema.ts
    component-allowlist.ts
```

Acceptance:

- Mastra is registered in NestJS.
- Existing app startup still works.

---

# Phase 2: Shared Types and Response Contract

## Task 2.1: Define harness state and events

Create types similar to:

```ts
export type DataAgentMode =
  | 'intent'
  | 'retrieve_context'
  | 'generate_sql'
  | 'validate_sql'
  | 'execute_sql'
  | 'transform_data'
  | 'visualize'
  | 'answer'
  | 'done'
  | 'failed';

export type HarnessRunState = {
  runId: string;
  conversationId?: string;
  iteration: number;
  mode: DataAgentMode;
  currentAgent?: string;
  currentTool?: string;
  status: 'running' | 'waiting' | 'done' | 'failed';
  question: string;
  retrievalContext?: RetrievedContext;
  generatedSql?: string;
  validatedSql?: string;
  executionMeta?: QueryExecutionMeta;
  transformExpression?: string;
  visualizationSpec?: Record<string, unknown>;
  audits: LlmDataBoundaryAudit[];
};

export type HarnessStreamEvent = {
  type:
    | 'run.started'
    | 'agent.started'
    | 'agent.delta'
    | 'agent.completed'
    | 'tool.started'
    | 'tool.delta'
    | 'tool.completed'
    | 'mode.changed'
    | 'audit.completed'
    | 'run.completed'
    | 'run.failed';
  runId: string;
  mode: DataAgentMode;
  agent?: string;
  tool?: string;
  textDelta?: string;
  payload?: Record<string, unknown>;
  timestamp: string;
};
```

Acceptance:

- Frontend can identify active agent, active mode, active tool, and stream deltas.

## Task 2.2: Define final response contract

Use this shape:

```ts
export type TextToSqlVisualizationResponse = {
  answer: string;
  sql?: {
    text: string;
    dialect: 'mariadb';
    readOnly: true;
    validationReasons: string[];
  };
  assumptions: string[];
  references: Array<{
    source: 'lancedb';
    path?: string;
    title?: string;
    score?: number;
  }>;
  visualization: {
    renderer: 'json-render';
    spec: Record<string, unknown>;
    dataState: Record<string, unknown>;
    transformExpression: string;
    transformExpressionHash: string;
  };
  audit: {
    noDatabaseDataPassedToLlm: true;
    checkedAgents: string[];
    checkedLlmCalls: number;
    blockedLlmCalls: number;
  };
};
```

Important:

- `visualization.dataState` contains the real transformed data for the frontend.
- `visualization.dataState` must never be sent into an LLM prompt.
- Do not return raw `data.rows` as the normal contract.

Acceptance:

- Response can render directly with json-render.
- Audit summary is always included.

---

# Phase 3: LanceDB Context Retrieval

## Task 3.1: Implement the LanceDB hybrid-retrieval tool

Implement `LancedbRetrievalTool` using:

```txt
connect(LANCEDB_DIR) -> openTable('vdb_chunks')
embed(query, EMBEDDING_MODEL)            # text-embedding-3-large, 3072-dim
table.query()
  .fullTextSearch(query)                 # BM25 over content
  .nearestTo(queryVector)                # dense vector similarity
  .rerank(RRFReranker)                   # Reciprocal Rank Fusion
  .limit(topK)
```

Params:

```ts
{
  query: string;
  topK?: number;
}
```

Use `LANCEDB_DIR`, defaulting to `{cwd}/lancedb` if missing, and `EMBEDDING_MODEL`,
defaulting to `text-embedding-3-large`. Fall back to pure vector search if the FTS
index or hybrid query is unavailable.

Parse the top-k chunks into the schema whitelist and produce:

```ts
export type RetrievedContext = {
  query: string;
  answer: string;
  documents: Array<{
    text: string;
    path?: string;
    title?: string;
    score?: number;
  }>;
  references: Array<{
    path?: string;
    title?: string;
    score?: number;
  }>;
  sufficient: boolean;
  contextSummary: string;
};
```

Acceptance:

- Streams retrieval progress events into harness timeline as **Retrieve Context**.
- Handles the retrieved chunks safely.
- Handles retrieval failure with safe error response.

## Task 3.2: Implement ContextAgent / `retrieve_context`

ContextAgent responsibilities:

1. Convert user question into schema-oriented retrieval query.
2. Call the LanceDB hybrid-retrieval tool.
3. Build `RetrievedContext`.
4. Set `sufficient` based on whether enough schema/business context exists.
5. Hand off to SQL Agent only when sufficient.

Acceptance:

- SQL generation is blocked when the retrieved context is insufficient.
- The UI timeline shows **Retrieve Context** with retrieved summary and reference paths.
- Do not expose raw table names in final natural-language answer unless already allowed by existing product behavior.

---

# Phase 4: LLM Data Boundary and Audit

## Task 4.1: Implement global LLM data boundary guard

Create a wrapper used by every agent/model call.

It must inspect the LLM input and output payloads and block/log if they contain:

- Database row arrays.
- Raw query results.
- `visualization.dataState`.
- Known row/cell values from the latest query result.
- Large JSON objects that look like result rows.
- Keys such as `rows`, `resultRows`, `records`, `dataState` inside LLM prompt payloads.

Allowed LLM payload kinds:

```txt
user_question
retrieval_context
schema_metadata
column_metadata
sql_text
query_execution_metadata
visualization_intent
jmespath_expression
```

Create audit type:

```ts
export type LlmDataBoundaryAudit = {
  runId: string;
  agentId: string;
  llmCallId: string;
  checkedAt: string;
  containsDatabaseRows: false;
  containsDatabaseCellValues: false;
  containsRawQueryResult: false;
  allowedPayloadKinds: string[];
  payloadHash: string;
  blocked: boolean;
  blockedReasons: string[];
};
```

Acceptance:

- Every LLM call goes through this guard.
- If unsafe data is detected, the LLM call is blocked.
- Harness timeline emits `audit.completed` events.
- Tests prove row data cannot reach LLM prompts.

## Task 4.2: Quarantine database rows

Create a type and convention for database result rows that prevents accidental LLM use.

Example:

```ts
export type QuarantinedRows = {
  __kind: 'QUARANTINED_DATABASE_ROWS';
  queryId: string;
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  rows: Record<string, unknown>[];
};
```

Rules:

- Only SQL executor and deterministic ETL may receive `rows`.
- Agents may receive only column metadata, row count, and aggregate execution metadata.
- Do not stringify `QuarantinedRows` into any prompt.

Acceptance:

- Compile-time and runtime boundaries make accidental row passing difficult.

---

# Phase 5: SQL Generation and Safety

## Task 5.1: Implement SQL Agent

SQL Agent may use:

- User question.
- Retrieved `contextSummary` and documents.
- Schema metadata from the LanceDB retrieval.
- Column names/types.
- Business metric definitions from the retrieved context.

SQL Agent must not use:

- Query result rows.
- Sample database values.
- Previous `visualization.dataState`.

Output:

```ts
{
  sql: string;
  assumptions: string[];
  selectedContextReferences: string[];
}
```

Acceptance:

- SQL Agent emits active stream deltas to frontend.
- Generated SQL is not executed directly.

## Task 5.2: Implement MariaDB SQL safety service

Validate:

- Only `SELECT` or read-only `WITH` queries.
- No `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `REPLACE`, stored procedures, or multi-statement SQL.
- No comments used to hide extra statements.
- Add or enforce `LIMIT` for non-aggregate detail queries.
- Reject queries that cannot be parsed or normalized.

Output:

```ts
{
  valid: boolean;
  normalizedSql?: string;
  readOnly: boolean;
  reasons: string[];
}
```

Acceptance:

- Invalid SQL never reaches executor.
- Validation is deterministic backend code, not an LLM decision.

## Task 5.3: Implement read-only MariaDB executor

Use existing `MARIADB_*` env variables.

Executor returns `QuarantinedRows` and execution metadata:

```ts
{
  queryId: string;
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  rows: Record<string, unknown>[];
  executionMs: number;
}
```

Acceptance:

- Executes only validated SQL.
- Re-validates SQL immediately before execution.
- Rows are not logged into normal app logs.
- Rows are not sent to any LLM.

---

# Phase 6: Deterministic ETL / JMESPath Transform

## Task 6.1: Implement Transform Agent

Transform Agent generates only a transform plan/expression from metadata.

It may see:

- User question.
- Column names/types.
- Row count.
- Visualization intent.
- SQL text.

It must not see:

- Real row values.
- Row samples.
- `QuarantinedRows.rows`.
- `visualization.dataState`.

Output:

```ts
{
  transformExpression: string;
  targetDataShape: Record<string, unknown>;
  explanation: string;
}
```

Acceptance:

- Transform expression is auditable and hashable.
- LLM payload audit confirms no row data.

## Task 6.2: Implement backend ETL/JMESPath executor

Use deterministic backend code to apply the transform expression to `QuarantinedRows.rows`.

Required behavior:

- Validate transform expression before execution.
- Apply expression to real rows only inside backend ETL service.
- Produce `visualization.dataState`.
- Hash the transform expression.
- Emit timeline event **Transform Data**.

Example output:

```ts
{
  dataState: {
    series: [...],
    summary: {...}
  },
  transformExpression: '...',
  transformExpressionHash: 'sha256:...'
}
```

Acceptance:

- ETL works without calling LLM.
- Real data appears only in `dataState` returned to frontend.
- Tests prove ETL does not call LLM.

---

# Phase 7: json-render Visualization

## Task 7.1: Define json-render component allowlist

Start small:

```ts
export const JSON_RENDER_COMPONENT_ALLOWLIST = [
  'Dashboard',
  'Grid',
  'Card',
  'MetricCard',
  'DataTable',
  'BarChart',
  'LineChart',
  'PieChart'
] as const;
```

Acceptance:

- No arbitrary component names are allowed.

## Task 7.2: Implement Visualization Agent

Visualization Agent creates only the json-render spec/layout.

It may see:

- User question.
- Column metadata.
- Row count.
- Transform target shape.
- Transform expression.
- Allowed components.

It must not see:

- Raw rows.
- Data samples.
- `visualization.dataState`.

Output:

```ts
{
  renderer: 'json-render';
  spec: Record<string, unknown>;
}
```

Acceptance:

- Spec references `dataState` paths, for example `$.series`.
- Spec does not embed raw data.
- Spec validates against component allowlist.

## Task 7.3: Validate json-render spec

Validation must check:

- Only allowlisted components.
- No script/code injection fields.
- No inline row data arrays inside spec.
- Data paths reference `visualization.dataState` only.

Acceptance:

- Invalid specs are rejected or repaired safely.

---

# Phase 8: Harness Runtime Loop

## Task 8.1: Implement actual loop, not one-shot chain

Create `DataAgentHarnessService` that owns `HarnessRunState` and iterates until done.

Loop policy:

```txt
start
  -> intent
  -> retrieve_context
  -> if insufficient: ask clarification or fail safely
  -> generate_sql
  -> validate_sql
  -> if invalid and retries < max: refine SQL and loop back to generate_sql
  -> if invalid after retries: fail safely
  -> execute_sql
  -> transform_data
  -> visualize
  -> answer
  -> done
```

Rules:

- Max iterations: hard-code a safe default in code, e.g. 8. Do not add env var.
- Each iteration emits stream events.
- Each LLM call passes data-boundary audit.
- SQL validation failure can trigger SQL refinement.
- Retrieval insufficiency can trigger clarification response.

Acceptance:

- Runtime has `runId`, `iteration`, `mode`, `currentAgent`, `currentTool`, and stop condition.
- Tests verify retry/refine behavior.
- It cannot skip retrieval, SQL validation, or ETL.

## Task 8.2: Implement Mastra tools

Create these tools:

```txt
retrieveContextTool
inspectContextTool / answerFromContextTool
_generateSqlTool
validateSqlTool
executeReadOnlySqlTool
generateTransformPlanTool
executeDeterministicEtlTool
generateJsonRenderSpecTool
validateJsonRenderSpecTool
```

Acceptance:

- Tools have Zod input/output schemas.
- Tools emit timeline events.
- Tools enforce no-row-data-to-LLM boundary where relevant.

## Task 8.3: Implement Mastra agents

Create focused agents:

```txt
IntentAgent
ContextAgent
SqlAgent
TransformAgent
VisualizationAgent
AnswerAgent
```

Keep prompts short and role-specific.

Acceptance:

- Each agent has a clear allowed input list.
- Each agent streams active output to frontend.
- Every agent call has audit output.

---

# Phase 9: Streaming Integration

## Task 9.1: Preserve existing AI SDK stream response

Keep using existing `chat.service` pattern with `pipeUIMessageStreamToResponse`.

Add an adapter:

```txt
Mastra/Harness events
  -> HarnessStreamAdapter
  -> AI SDK UI message stream
  -> pipeUIMessageStreamToResponse
  -> frontend
```

Acceptance:

- Existing chat streaming still works.
- New harness timeline events are streamed through the same response channel.

## Task 9.2: Stream active agent status like Claude Code / Codex

Frontend must receive events that allow it to show:

- Current agent name.
- Current mode.
- Current tool.
- Agent text delta.
- Tool started/completed.
- Schema retrieval progress.
- SQL validation status.
- SQL execution status without row data.
- Transform status.
- Visualization status.
- Final answer.

Example UI event:

```json
{
  "type": "agent.delta",
  "runId": "run_123",
  "mode": "generate_sql",
  "agent": "SqlAgent",
  "textDelta": "Generating read-only SQL from retrieved schema context..."
}
```

Acceptance:

- Frontend can render a harness timeline.
- Frontend can highlight the currently running agent.
- No raw DB rows appear in stream events.

---

# Phase 10: NestJS API

## Task 10.1: Integrate with current chat endpoint or add focused ask endpoint

Prefer extending the existing chat endpoint if that is how the frontend already streams.

Support request:

```ts
{
  conversationId?: string;
  prompt: string;
}
```

Response should stream events and end with `TextToSqlVisualizationResponse`.

Acceptance:

- No auth implementation added.
- No new env vars.
- Works with existing frontend streaming client.

## Task 10.2: Error responses

Safe failures:

- Retrieval unavailable.
- Context insufficient.
- SQL invalid after retry.
- Database execution failed.
- ETL transform invalid.
- json-render spec invalid.
- LLM data-boundary violation.

Acceptance:

- Failures stream clear status to frontend.
- No sensitive internals or rows are leaked.

---

# Phase 11: Audit and Logging

## Task 11.1: Add audit service

Audit these events:

- Harness run started/completed/failed.
- Schema context retrieval request metadata.
- SQL generated.
- SQL validation result.
- SQL execution metadata only, no rows.
- Transform expression and hash.
- json-render spec validation.
- Every LLM data-boundary check.

Acceptance:

- Audit logs do not contain row values.
- Each run has traceable `runId`.

## Task 11.2: Add no-data-to-LLM detection report

At final response, include:

```ts
{
  noDatabaseDataPassedToLlm: true,
  checkedAgents: [...],
  checkedLlmCalls: 5,
  blockedLlmCalls: 0
}
```

Acceptance:

- If any unsafe LLM call is blocked, final response must not claim success.

---

# Phase 12: Tests

## Task 12.1: Safety tests

Add tests for:

- Reject DDL/DML SQL.
- Reject multi-statement SQL.
- Enforce read-only SQL.
- Block LLM prompt containing `rows`.
- Block LLM prompt containing `dataState`.
- Block LLM prompt containing known row/cell values.
- Ensure ETL receives rows but LLM does not.
- Ensure json-render spec does not embed row arrays.

## Task 12.2: Harness tests

Add tests for:

- Normal successful path.
- Insufficient retrieved context path.
- SQL validation failure then retry/refine.
- SQL validation failure after max retry.
- Stream event sequence includes active agents.
- Final response contains `visualization.spec` and `visualization.dataState`.

## Task 12.3: Retrieval tests

Add tests for:

- Hybrid search returns the schema whitelist.
- References extraction.
- `sufficient` true/false behavior.
- Vector-search fallback when FTS is unavailable.

Acceptance:

- All critical safety tests pass.
- No snapshot/test fixture includes real database rows unless synthetic and clearly marked.

---

# Phase 13: Minimal Documentation

## Task 13.1: Architecture doc

Create:

```txt
docs/ai-agent-harness/architecture.md
```

Include:

- Harness loop diagram.
- Agent responsibilities.
- No-row-data-to-LLM boundary.
- LanceDB retrieval flow.
- SQL validation flow.
- ETL/JMESPath flow.
- json-render response contract.
- Streaming event contract.

## Task 13.2: Developer guide

Create:

```txt
docs/ai-agent-harness/local-dev.md
```

Include:

- Required existing env vars.
- How to prepare the LanceDB retrieval table.
- How to start backend.
- Example prompt.
- Example streamed event sequence.

---

# Suggested Implementation Order

1. Repository reconnaissance.
2. Mastra setup.
3. Shared types and response contract.
4. LanceDB hybrid-retrieval tool and ContextAgent.
5. LLM data-boundary guard and audit.
6. SQL generation tool and SQL safety validator.
7. MariaDB read-only executor with quarantined rows.
8. Transform Agent and deterministic ETL/JMESPath executor.
9. json-render spec generator and validator.
10. Harness runtime loop.
11. Streaming adapter into `pipeUIMessageStreamToResponse`.
12. NestJS endpoint integration.
14. Minimal docs.

---

# Definition of Done

The feature is complete when:

- A user can ask a natural-language data question.
- The harness retrieves schema context from the LanceDB hybrid search.
- SQL is generated from the retrieved schema context.
- SQL is validated as read-only before execution.
- MariaDB executes the query in backend only.
- Real database rows are quarantined and never passed to LLM.
- Transform Agent creates a JMESPath-like plan from metadata only.
- Backend ETL applies the transform to real rows and produces `visualization.dataState`.
- Visualization Agent creates a valid json-render spec from metadata only.
- Frontend receives streamed active-agent updates like Claude Code/Codex.
- Final response includes answer, optional SQL metadata, retrieval references, `visualization.spec`, `visualization.dataState`, and no-data-to-LLM audit summary.
- No new environment variables are introduced.
- Authentication is not added in this implementation.
- Safety and harness tests pass.
