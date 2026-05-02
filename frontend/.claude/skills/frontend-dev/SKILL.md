---
name: frontend-dev
description: Add or modify UI components, pages, or features in the React frontend. Auto-invoked when working on anything in the frontend/ directory — new components, chat UI, charts, shadcn primitives, TailwindCSS styling, or assistant-ui integrations.
when_to_use: Use when adding React components, updating pages, wiring AI chat UI, styling with Tailwind, adding shadcn/ui primitives, creating chart components, or changing state managed by Zustand.
---

## Stack

- **React 19** + **TypeScript** + **Vite 7**
- **TailwindCSS 4** — utility classes only, no inline styles
- **shadcn/ui** (Radix UI) — `src/components/ui/`
- **@assistant-ui/react** — AI chat thread, messages, tool calls
- **recharts** — data visualisations (`src/components/charts/`)
- **Zustand 5** — global state
- **Zod 4** — runtime validation at boundaries
- **ai SDK v6** + **@ai-sdk/openai** — LLM streaming

## File layout

```
src/
  components/
    assistant-ui/   # thread, composer, tool-fallback, reasoning, sources
    charts/         # recharts wrappers
    ui/             # shadcn primitives (Button, Card, Dialog…)
  pages/            # route-level components
  lib/
    utils.ts        # cn() helper
    tool-agent-map.ts
  constants/        # API URLs, config
  App.tsx
server/             # Express dev-proxy server
```

## Conventions

### Imports
- Use the `@/` alias (maps to `src/`) — never use relative `../../` across feature boundaries.
- Import shadcn primitives from `@/components/ui/<name>`.
- Import `cn` from `@/lib/utils` for conditional class merging.

### Components
- All components are typed with `FC` (or `FC<Props>`). No default exports — use named exports.
- Keep components small and single-responsibility.
- Co-locate component-specific helpers inside the same file; extract to `lib/` only when reused.

### Styling
- TailwindCSS 4 only. Use `cn()` for conditional/merged classes.
- Follow the existing `aui-*` class prefix for assistant-ui components so theming works.
- Use CSS custom properties (`--thread-max-width`, `--composer-radius`) when overriding layout tokens.
- Dark mode: use `dark:` variants, rely on `bg-background`, `text-foreground`, `text-muted-foreground`.

### shadcn/ui
- Never modify files under `src/components/ui/` directly — they are generated.
- Compose using shadcn primitives rather than raw HTML for forms, dialogs, dropdowns, etc.

### assistant-ui
- Chat thread is assembled in `src/components/assistant-ui/thread.tsx`.
- Tool call UI components live in `src/components/assistant-ui/` — one file per tool.
- Use `MessagePrimitive`, `ComposerPrimitive`, `ThreadPrimitive`, `ActionBarPrimitive` from `@assistant-ui/react`.
- Access message/thread state reactively via `useAuiState((s) => s.message.role)`.
- Conditional rendering uses `<AuiIf condition={(s) => ...}>` — avoid manual conditional hooks.
- Tool fallback: wrap unknown tools with `<ToolFallback>` from `tool-fallback.tsx`; pass `agentName` from `getAgentForTool`.

### Charts
- All chart components live in `src/components/charts/`.
- Use recharts composable API (`<ComposedChart>`, `<Bar>`, `<Line>`, etc.).
- Accept typed `props` — never embed raw data inside the component.

### State (Zustand)
- One store per feature domain. Define stores in `src/lib/` or a `src/store/` directory.
- Never mutate state directly — use Zustand's `set()`.

### Validation (Zod)
- Validate at API boundaries (server responses, form submissions) only.
- Infer TypeScript types from schemas with `z.infer<typeof Schema>`.

## Adding a new shadcn/ui component
Use the shadcn CLI (already configured). Claude should run:
```bash
npx shadcn@latest add <component-name>
```
This generates the file at `src/components/ui/<component>.tsx`.

## Adding a new chart
1. Create `src/components/charts/<ChartName>.tsx`.
2. Accept all data and config via typed props.
3. Import and re-export from an index if one exists.

## Adding a new tool-call UI panel
1. Create `src/components/assistant-ui/<tool-name>.tsx`.
2. Export a component that accepts `ToolCallMessagePartComponent` props.
3. Register it in the tool-agent map (`src/lib/tool-agent-map.ts`) so `ToolFallbackWithAgent` resolves it.

## Starting the dev server
```bash
cd frontend
npm run dev
```
The app proxies API requests to `http://localhost:3000` (minds-ai-agent).
