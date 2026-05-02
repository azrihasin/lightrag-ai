---
name: agent-dev
description: Add or modify AI tools, LangGraph nodes, NestJS services, or agent orchestration in minds-ai-agent. Auto-invoked when working on anything in the minds-ai-agent/ directory — new tools, graph edges, providers, DTOs, or NestJS modules.
when_to_use: Use when adding a new AI tool, modifying the LangGraph StateGraph, changing the agent orchestration flow, adding NestJS providers/modules, adjusting the chat streaming pipeline, or extending AgentState.
---

## Stack

- **NestJS 11** + **TypeScript** (strict)
- **LangGraph** (`@langchain/langgraph`) — `StateGraph` with `MemorySaver` checkpointing
- **LangChain** (`@langchain/core`, `@langchain/anthropic`) — LLM client, message types
- **ai SDK v6** (`ai`) — `tool()` helper, `createUIMessageStream`, `pipeUIMessageStreamToResponse`
- **Zod 4** — state schema, tool input schemas, LLM JSON parsing
- **Pino** (`nestjs-pino`) — structured logging
- **Swagger/OpenAPI** — auto-generated from decorators

## File layout

```
src/
  chat/
    tools/              # one file per AI tool — <name>.tool.ts
    providers/
      model.provider.ts # LLM client factory
    adapters/
      render.adapter.ts
    agent/              # agent orchestrator + state
    agents/             # strategy agents
    discovery/          # UI discovery service
    dto/                # ChatRequestDto, SseEventDto
    chat.service.ts     # LangGraph graph + streaming
    chat.controller.ts  # POST /chat SSE endpoint
    chat.module.ts      # NestJS module wiring
  app.module.ts
  app.controller.ts
```

## Conventions

### NestJS
- All classes are `@Injectable()`. Inject dependencies via constructor with typed tokens.
- Declare providers in the appropriate `*.module.ts`. Never instantiate services manually.
- Use `@InjectPinoLogger(ClassName.name)` for structured logging inside services.
- DTOs live in `dto/` and use Zod schemas (not `class-validator`) for validation.

### AI Tools
Every tool is a standalone `@Injectable()` class with a single `asTool()` method:

```typescript
import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class MyTool {
  asTool() {
    return tool({
      description: 'One-sentence description used by the LLM to decide when to call this tool.',
      inputSchema: z.object({
        param: z.string().describe('What this param represents'),
      }),
      execute: async ({ param }) => ({
        // typed return value consumed by the graph node
      }),
    });
  }
}
```

- File name: `<kebab-name>.tool.ts` under `src/chat/tools/`.
- Input schemas use Zod `.describe()` on every field — the LLM reads these.
- `execute` must return a plain object (no class instances).
- Register in `ToolRegistry` so nodes can call it via `callTool(tools, 'tool_name', input)`.

### LangGraph — AgentState
State lives in `AgentStateSchema` (Zod object in `chat.service.ts`). Rules:
- All fields are **optional** except `messages` and `retryCount`.
- Add new fields to the schema before using them in nodes.
- Infer the TypeScript type: `type AgentState = z.infer<typeof AgentStateSchema>`.

### LangGraph — Nodes
Node factories follow this signature:

```typescript
async function myNode(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
  // read from state, call tools or LLM, return only the fields you changed
  return { fieldName: value };
}
```

- Return only the slice of state this node updates — LangGraph merges it.
- Use `callTool(tools, 'tool_name', input)` for tool execution.
- Use `llmJson(llm, systemPrompt, userPrompt, ZodSchema, config)` for structured LLM calls.
- Use `llm.stream(messages, config)` + `extractDelta(chunk.content)` for streaming text nodes.

### LangGraph — Streaming to Frontend
The streaming pipeline in `chat.service.ts`:

1. **Tool groups**: on `on_chain_start` emit `tool-input-available`; on `on_chain_end` emit `tool-output-available`.
2. **Text streaming**: streaming nodes listed in `STREAMING_NODES` emit `text-start → text-delta → text-end`.
3. **Visualizations**: `renderVisualization` node emits a `data-spec` part with `{ componentType, props }`.

When adding a new node:
- Add it to `resolveToolName()` so the frontend shows the right tool group label.
- Add it to `resolveStartingMessage()` so the tool group is never blank.
- Add it to `extractNodeArgs()` to populate the tool input shown to the user.
- Add it to `summarizeNodeOutput()` to populate the tool result.
- If it streams text, add its name to `STREAMING_NODES`.

### LLM Client
Get the LangChain chat model from `ModelProvider.getChatModel()`. This returns a LangChain `BaseChatModel` configured for the active provider (Anthropic by default).

### Structured LLM JSON calls
Use the `llmJson` helper — it handles prompting, JSON extraction, and Zod parsing:

```typescript
const result = await llmJson(
  llm,
  'System: instruct LLM to return JSON with key "foo".',
  `User message with context.`,
  z.object({ foo: z.string() }),
  config,
);
```

Always include `"Reply with a single JSON object only. No markdown fences."` implicitly — the helper appends it.

### Error handling
- Catch errors inside nodes and return a safe partial state (never throw out of a node unless you want the graph to abort).
- Log with `logger.error({ threadId, err }, 'description')`.
- The stream's catch block emits `{ type: 'error', errorText: message }` to the frontend.

## Adding a new tool — checklist
1. Create `src/chat/tools/<name>.tool.ts` following the template above.
2. Add `@Injectable()` class and implement `asTool()`.
3. Register the class in `src/chat/chat.module.ts` providers array.
4. Add to `ToolRegistry.getAll()` with a snake_case key matching the tool name used in `callTool`.
5. (Optional) Add a graph node that calls the tool, wire edges in `buildGraph()`.
6. Update `resolveToolName`, `resolveStartingMessage`, `extractNodeArgs`, `summarizeNodeOutput`.

## Running the service
```bash
cd minds-ai-agent
npm run start:dev   # watch mode with hot reload
npm run test        # Jest unit tests
```

The service listens on port **3000** by default and exposes `/api` (Swagger UI at `/api/docs`).
