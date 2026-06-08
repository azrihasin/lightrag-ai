# Repository Findings — Minds AI Agent Harness

## NestJS App/Module Structure

```
AppModule
├── ConfigModule.forRoot() — global env
├── LoggerModule (nestjs-pino) — structured logging
├── DatabaseModule — exports DRIZZLE (Drizzle ORM mysql2, MARIADB_*)
├── ChatHistoryModule — chat sessions + messages (separate pool CHAT_DB_*)
└── ChatModule — main agents, tools, streaming
    ├── ModelProvider — reads AI_PROVIDER / AI_MODEL
    ├── MindsAgentService — Mastra supervisor + 3 sub-agents
    ├── ToolRegistry — 15 NestJS-injectable tool classes
    ├── ChatService — streams via pipeUIMessageStreamToResponse
    └── ChatController — POST /chat/stream
```

## Files to Modify

| File | Why |
|------|-----|
| `src/chat/chat.module.ts` | Import AiMastraModule |
| `src/chat/chat.service.ts` | Route text-to-SQL questions to DataAgentHarnessService |
| `src/app.module.ts` | No change needed (ChatModule handles it) |

## pipeUIMessageStreamToResponse Usage

`src/chat/chat.service.ts` — `stream()` method:
- Creates UI message stream with `createUIMessageStream({ execute: async ({ writer }) => ... })`
- Iterates `agentResult.fullStream` and maps Mastra chunks → AI SDK UI chunks
- Writes custom sidecar events via `(writer as any).write({ type: '...', ... })`
- Pipes to response with `pipeUIMessageStreamToResponse({ response: res, stream: uiStream })`

## AI Provider Setup

`src/chat/providers/model.provider.ts`:
- `AI_PROVIDER` — "openai" | "anthropic" (default: "openai")
- `AI_MODEL` — model id (default: gpt-4o-mini or claude-sonnet-4-6)
- Returns `LanguageModel` via `@ai-sdk/openai` or `@ai-sdk/anthropic`

## MariaDB Connection

`src/database/database.module.ts`:
- Drizzle ORM with mysql2/promise
- Provider symbol: `DRIZZLE`
- Config: `MARIADB_HOST`, `MARIADB_PORT`, `MARIADB_USER`, `MARIADB_PASSWORD`, `MARIADB_DATABASE`
- Used by: `ExecuteSqlTool` via `@Inject(DRIZZLE)`

## Schema Retrieval (LanceDB hybrid search)

`src/ai/mastra/tools/lancedb-retrieve.tool.ts`:
- Connects to `LANCEDB_DIR` (default `{cwd}/lancedb`), opens the `vdb_chunks` table
- Embeds the query with `EMBEDDING_MODEL` (text-embedding-3-large, 3072-dim)
- Hybrid search: BM25 full-text over `content` + dense vector similarity, fused with RRF
- Falls back to pure vector search if hybrid/FTS is unavailable
- Returns `{ query, schemaJson }` where `schemaJson` is the strict whitelist `{ tables: [{ table, columns }] }`

## Existing Tools (15 total)

retrieve_context, answer_from_context, clarification_request,
generic_search, generate_sql, validate_sql, execute_sql,
generate_action, validate_action, execute_system_action,
prepare_visualization_data, render_visualization,
human_review_gate, summarize_result, calculator

## Test Framework

- Jest v30 + ts-jest
- `src/**/*.spec.ts` pattern
- `@nestjs/testing` for module isolation
- `npm run test` / `npm run test:cov`

## Custom SSE Sidecar Event Types (existing)

goal_received, step_started, step_completed, agent_iteration,
agent_final, agent_error, sql-table-start, sql-table-row,
sql-table-end, sql-generated, data-spec
