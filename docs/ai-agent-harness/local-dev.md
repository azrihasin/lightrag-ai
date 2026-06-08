# AI Agent Harness — Local Development Guide

## Environment Variables

Copy `minds-ai-agent/.env.example` to `minds-ai-agent/.env` and fill in the values below.

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `openai` | Model provider: `openai` or `anthropic` |
| `AI_MODEL` | `gpt-4o-mini` | Model name (e.g. `gpt-4o`, `claude-sonnet-4-6`) |
| `OPENAI_API_KEY` | — | Required when `AI_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=anthropic` |
| `LANCEDB_DIR` | `{cwd}/lancedb` | Directory holding the LanceDB database |
| `EMBEDDING_MODEL` | `text-embedding-3-large` | Embedding model for retrieval queries (must match the stored vectors, 3072-dim) |
| `LLM_BINDING_HOST` | `https://api.openai.com/v1` | OpenAI-compatible base URL (also used to embed queries) |
| `MARIADB_HOST` | `localhost` | MariaDB host for data queries |
| `MARIADB_PORT` | `3306` | MariaDB port |
| `MARIADB_USER` | `root` | MariaDB user |
| `MARIADB_PASSWORD` | — | MariaDB password |
| `MARIADB_DATABASE` | `minds` | Database name for data queries |
| `CHAT_DB_NAME` | `minds_chat` | Separate DB for chat history |
| `PORT` | `3000` | Backend HTTP port |
| `LOG_LEVEL` | `info` | Pino log level (`debug` recommended during dev) |

---

## Preparing the LanceDB retrieval table

Schema retrieval is served locally from the LanceDB `vdb_chunks` table — there is
no separate retrieval server to start. The table is checked in at
`minds-ai-agent/lancedb/vdb_chunks.lance` (103 rows, 3072-dim vectors).

To (re)build the table from the embeddings source `vdb_chunks.json`, start the
backend and call the conversion endpoint:

```bash
curl -X POST http://localhost:3000/api/lancedb/convert
```

The retrieval tool connects to `LANCEDB_DIR` (default `{cwd}/lancedb`), opens
`vdb_chunks`, embeds the query with `EMBEDDING_MODEL`, and runs a hybrid search
(dense vector similarity + BM25 full-text search, fused with Reciprocal Rank
Fusion). It idempotently builds the full-text index on `content` on first use.

> The embedding model **must** match the model that produced the stored vectors
> (`text-embedding-3-large`, 3072-dim). It is resolved through the same
> OpenAI-compatible `LLM_BINDING_HOST` / `OPENAI_API_KEY` used for the LLM, so
> point those at an embedding-capable endpoint.

---

## Starting the Backend

```bash
cd minds-ai-agent
cp .env.example .env          # then fill in your credentials
npm install
npm run start:dev             # NestJS with --watch
```

The server starts on `http://localhost:3000` (or `PORT` from `.env`).

To enable verbose harness logs:
```bash
LOG_LEVEL=debug npm run start:dev
```

---

## Example: Sending a Data Question

The harness is triggered automatically when `ChatService.isDataQuestion()` returns `true` for a user message. It is activated via the `/chat` streaming endpoint.

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How many orders were placed in each region last month?",
    "conversationId": "test-conv-001"
  }'
```

The response is an SSE stream. You will see harness sidecar events interleaved with the AssistantUI text stream.

---

## Example SSE Event Sequence

A successful harness run emits the following events in order (each on a separate `data:` line):

```
data: {"type":"run.started","runId":"run_1748526000_abc123","mode":"intent","payload":{"question":"How many orders..."},"timestamp":"2026-05-29T10:00:00.000Z"}

data: {"type":"mode.changed","runId":"run_...","mode":"intent","timestamp":"..."}
data: {"type":"agent.started","runId":"run_...","mode":"intent","agent":"IntentAgent","timestamp":"..."}
data: {"type":"agent.delta","runId":"run_...","mode":"intent","agent":"IntentAgent","textDelta":"Analyzing question intent...","timestamp":"..."}
data: {"type":"agent.completed","runId":"run_...","mode":"intent","agent":"IntentAgent","payload":{"intentSummary":"Count orders by region","isDataQuestion":true},"timestamp":"..."}

data: {"type":"mode.changed","runId":"run_...","mode":"retrieve_context","timestamp":"..."}
data: {"type":"tool.started","runId":"run_...","mode":"retrieve_context","tool":"harness_retrieve_context","timestamp":"..."}
data: {"type":"tool.completed","runId":"run_...","mode":"retrieve_context","tool":"harness_retrieve_context","payload":{"sufficient":true,"documentCount":3},"timestamp":"..."}

data: {"type":"mode.changed","runId":"run_...","mode":"generate_sql","timestamp":"..."}
data: {"type":"tool.completed","runId":"run_...","mode":"validate_sql","tool":"harness_validate_sql","payload":{"valid":true,"readOnly":true},"timestamp":"..."}

data: {"type":"mode.changed","runId":"run_...","mode":"execute_sql","timestamp":"..."}
data: {"type":"tool.completed","runId":"run_...","mode":"execute_sql","tool":"harness_execute_sql","payload":{"rowCount":12,"executionMs":34},"timestamp":"..."}

data: {"type":"mode.changed","runId":"run_...","mode":"transform_data","timestamp":"..."}
data: {"type":"mode.changed","runId":"run_...","mode":"visualize","timestamp":"..."}
data: {"type":"mode.changed","runId":"run_...","mode":"answer","timestamp":"..."}

data: {"type":"audit.completed","runId":"run_...","mode":"done","payload":{"noDatabaseDataPassedToLlm":true,"checkedAgents":["intent-agent","context-agent","sql-agent","transform-agent","answer-agent"],"checkedLlmCalls":5,"blockedLlmCalls":0},"timestamp":"..."}

data: {"type":"run.completed","runId":"run_...","mode":"done","payload":{"iterations":7,"rowCount":12},"timestamp":"..."}
```

After all harness events, the AssistantUI text stream delivers the final `TextToSqlVisualizationResponse` as a JSON message, which the frontend renders using the `json-render` component tree.

---

## Running Tests

```bash
cd minds-ai-agent

# All unit tests
npm test

# Harness-specific tests only
npx jest "src/ai/mastra" --no-coverage --verbose

# With coverage
npm run test:cov
```

Key test files:
- `src/ai/mastra/safety/sql-safety.service.spec.ts` — SQL validator
- `src/ai/mastra/safety/llm-data-boundary.guard.spec.ts` — LLM boundary guard
- `src/ai/mastra/harness/data-agent-harness.service.spec.ts` — full harness loop (mocked agents)

---

## Troubleshooting

**Harness never triggers:**
- Check `ChatService.isDataQuestion()` — keywords like "how many", "show me", "count", "list" trigger it.
- Enable `LOG_LEVEL=debug` to see routing decisions.

**Retrieval returns an empty schema:**
- Ensure the LanceDB `vdb_chunks` table exists (rebuild it via `POST /api/lancedb/convert`).
- Confirm `EMBEDDING_MODEL` matches the model that produced the stored vectors.
- Try a more specific query that matches your table names.

**SQL validation fails after retries:**
- Check the harness logs for the `sql.validation.failed` audit event.
- The fail reason is passed back to `SqlAgent` on retry. If validation always fails, the schema context may not contain the expected table names.

**`noDatabaseDataPassedToLlm=false` (audit violation):**
- This means `LlmDataBoundaryGuard.assertClean()` detected a forbidden key in an LLM payload.
- Check the `blockedReasons` in the audit for which key triggered the violation.
- This should never happen in normal operation — it indicates a harness code bug.
