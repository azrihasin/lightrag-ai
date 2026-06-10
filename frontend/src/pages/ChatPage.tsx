import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  useAuiState,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
  ActionProvider,
  type DataPart,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  useJsonRenderMessage,
} from "@json-render/react";
import { StreamdownText } from "@/components/assistant-ui/streamdown-text";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { Sources } from "@/components/assistant-ui/sources";
import { splitReasoningText, extractSources, extractCodeBlock, extractRetrievalTiming } from "@/lib/reasoning-format";
import { CodeBlock } from "@/components/assistant-ui/code-block";
import { RetrievalTimingBadge } from "@/components/assistant-ui/retrieval-timing";
import { Badge } from "@/components/ui/badge";
import { DatabaseIcon } from "lucide-react";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import type { ReasoningMessagePartComponent } from "@assistant-ui/react";
import { getAgentForTool } from "@/lib/tool-agent-map";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  AssistantActionBar,
  BranchPicker,
  MessageError,
  Shadcn,
} from "@/components/assistant-ui/shadcn";
import {
  AnalyzeIntentUI,
  AgentToolTimeline,
  StrategyDecisionUI,
  RetrieveContextUI,
  PlanNextStepUI,
  ClarificationRequestUI,
  GenericSearchUI,
  CalculatorUI,
  GenerateSqlUI,
  ValidateSqlUI,
  ExecuteSqlUI,
  GenerateActionUI,
  ValidateActionUI,
  ExecuteSystemActionUI,
  DecideNextStepUI,
  PrepareVisualizationUI,
  DecideVisualizationUI,
  RenderVisualizationUI,
  HumanReviewUI,
  SummarizeResultUI,
  ComposeResponseUI,
} from "@/components/agent-tool-uis";
import { registry } from "@/lib/registry";
import { SqlResultsTable } from "@/components/sql-results-table";
import { SqlRerunCard } from "@/components/sql-rerun-card";
import { createStreamingFetch } from "@/lib/streaming-fetch";
import {
  ChatHistoryThreadListAdapter,
  createBackendHistoryAdapter,
} from "@/lib/chat-thread-adapter";
import { getResourceId } from "@/lib/resource-id";
import { useMemo, useRef, useEffect, type FC } from "react";

// ─── Fallback for unrecognised tools ─────────────────────────────────────────

const ToolFallbackWithAgent: ToolCallMessagePartComponent = (props) => (
  <div className="m-2">
    <ToolFallback {...(props as any)} agentName={getAgentForTool(props.toolName)} />
  </div>
);

// ─── API URL ──────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/chat";

// ─── Backend thread list adapter (singleton) ──────────────────────────────────

const backendAdapter = new ChatHistoryThreadListAdapter();

// ─── Tool registry ────────────────────────────────────────────────────────────

const toolsByName = {
  analyze_user_intent:        AnalyzeIntentUI,
  strategy_decision:          StrategyDecisionUI,
  retrieve_context:           RetrieveContextUI,
  plan_next_step:             PlanNextStepUI,
  clarification_request:      ClarificationRequestUI,
  generic_search:             GenericSearchUI,
  calculator:                 CalculatorUI,
  generate_sql:               GenerateSqlUI,
  validate_sql:               ValidateSqlUI,
  execute_sql:                ExecuteSqlUI,
  generate_action:            GenerateActionUI,
  validate_action:            ValidateActionUI,
  execute_system_action:      ExecuteSystemActionUI,
  decide_next_step:           DecideNextStepUI,
  prepare_visualization_data: PrepareVisualizationUI,
  decide_visualization:       DecideVisualizationUI,
  render_visualization:       RenderVisualizationUI,
  human_review_gate:          HumanReviewUI,
  summarize_result:           SummarizeResultUI,
  compose_final_response:     ComposeResponseUI,
} as const;

const NoOp = () => null;

// Renders a reasoning block as a natural activity-feed item. The backend streams
// the wording (active-progress title while running, past-tense outcome title +
// body once complete); we show the latest heading as the title. See
// lib/reasoning-format.ts.
const GhostReasoning: ReasoningMessagePartComponent = ({ text, status }) => {
  const active = status.type === "running";
  // The retrieve-context block carries the retrieval counts/timing metrics as an
  // invisible comment — lift those out first so the comment never reaches the
  // code-block / title parsers below, then work on the stripped text.
  const timing = useMemo(() => extractRetrievalTiming(text), [text]);
  const baseText = timing ? timing.rest : text;
  // The retrieve-context block carries the raw retrieved schema as a fenced
  // ```json block — streamed live as it arrives and possibly sitting BEFORE the
  // final outcome heading. Lift it out of the full block text first (so it
  // survives the running→outcome heading flip and its commas don't pollute the
  // source-table list), then derive the title/body from what's left.
  const codeBlock = useMemo(() => extractCodeBlock(baseText), [baseText]);
  const { title, body } = useMemo(
    () => splitReasoningText(codeBlock ? codeBlock.rest : baseText),
    [codeBlock, baseText],
  );
  const proseBody = body;
  // Retrieve-context blocks list the relevant source tables — render those as
  // badges (all of them) instead of a truncated comma-joined sentence.
  const sources = useMemo(() => extractSources(proseBody), [proseBody]);

  return (
    <Reasoning.Root variant="ghost" defaultOpen>
      <Reasoning.Trigger active={active} label={title || (active ? "Working…" : "Done")} />
      {(proseBody || codeBlock || timing) && (
        <Reasoning.Content>
          <div className="flex flex-col gap-2">
            {sources ? (
              <>
                {sources.lead && <Reasoning.Text>{sources.lead}</Reasoning.Text>}
                <div className="flex flex-wrap gap-1.5">
                  {sources.sources.map((source) => (
                    <Badge key={source} variant="secondary" className="gap-1.5 font-mono">
                      <DatabaseIcon className="size-3 shrink-0" />
                      {source}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              proseBody && <Reasoning.Text>{proseBody}</Reasoning.Text>
            )}
            {codeBlock && (
              <CodeBlock
                label="Schema Retrieval"
                code={codeBlock.code}
                meta={codeBlock.lang}
                bodyClassName="max-h-72"
              />
            )}
            {timing && (
              <div className="flex">
                <RetrievalTimingBadge timing={timing.timing} />
              </div>
            )}
          </div>
        </Reasoning.Content>
      )}
    </Reasoning.Root>
  );
};

// ─── Assistant message ────────────────────────────────────────────────────────

interface SqlTableMeta {
  runId: string;
  columns: string[];
  rowCount: number;
  executionMs?: number;
}

interface RerunMeta {
  messageId: string;
  sql: string;
  columns: string[];
  rowCount: number | null;
}

const ChatAssistantMessage: FC = () => {
  const parts = useAuiState((s) => s.message.parts);
  const threadId = useAuiState((s) => s.threadListItem.externalId);
  const hasToolParts = parts.some((p) => p.type === "tool-call");

  const sqlTableMeta = useMemo((): SqlTableMeta | undefined => {
    const part = parts.find((p) => p.type === "data" && (p as any).name === "sql-table");
    return part ? (part as any).data as SqlTableMeta : undefined;
  }, [parts]);

  // History-loaded turns that ran a query carry a "rerun" data part instead of
  // the (unpersisted) table + chart. Render a card that re-executes on demand.
  const rerunMeta = useMemo((): RerunMeta | undefined => {
    const part = parts.find((p) => p.type === "data" && (p as any).name === "rerun");
    return part ? ((part as any).data as RerunMeta) : undefined;
  }, [parts]);

  const jsonRenderParts = useMemo(
    (): DataPart[] =>
      parts.reduce<DataPart[]>((acc, part) => {
        if (part.type === "text") {
          acc.push({ type: "text", text: part.text });
          return acc;
        }
        if (part.type === "data" && part.name === "spec") {
          const raw = part.data as { componentType: string; props: Record<string, unknown> };
          acc.push({
            type: "data-spec",
            data: { type: "nested", spec: { type: raw.componentType, props: raw.props } },
          });
        }
        return acc;
      }, []),
    [parts],
  );
  const { spec, hasSpec } = useJsonRenderMessage(jsonRenderParts);

  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        {hasToolParts && (
          <AgentToolTimeline>
            <MessagePrimitive.Parts
              components={{
                Text: NoOp,
                Reasoning: NoOp,
                tools: { by_name: toolsByName, Fallback: ToolFallbackWithAgent },
              }}
            />
          </AgentToolTimeline>
        )}

        <MessagePrimitive.Parts
          components={{
            Text: StreamdownText,
            Reasoning: GhostReasoning,
            Source: Sources,
            tools: { Fallback: NoOp },
          }}
        />

        {sqlTableMeta && (
          <SqlResultsTable
            runId={sqlTableMeta.runId}
            columns={sqlTableMeta.columns}
            rowCount={sqlTableMeta.rowCount}
            executionMs={sqlTableMeta.executionMs}
          />
        )}

        {rerunMeta && threadId && (
          <SqlRerunCard
            threadId={threadId}
            messageId={rerunMeta.messageId}
            sql={rerunMeta.sql}
            columns={rerunMeta.columns}
            rowCount={rerunMeta.rowCount}
          />
        )}

        {hasSpec && spec && <Renderer spec={spec} registry={registry} />}
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

// ─── Per-thread runtime hook ──────────────────────────────────────────────────
// Called once per active thread. Creates a chat runtime with Mastra's
// resourceId + threadId lifecycle: the externalId IS the Mastra threadId.

function ChatRuntimeHook() {
  const fetchRef = useRef(createStreamingFetch());
  const externalId = useAuiState((s) => s.threadListItem.externalId);
  const historyAdapter = useMemo(
    () => createBackendHistoryAdapter(externalId),
    [externalId],
  );

  // Add resourceId + the real thread UUID to every chat request body. The AI SDK
  // transport otherwise sends its own chat id ("DEFAULT_THREAD_ID"), which would
  // collapse every conversation into a single Mastra thread. externalId IS the
  // Mastra threadId the history adapter later reads back, so write/read keys match.
  const resourceId = getResourceId();

  return useChatRuntime({
    transport: new AssistantChatTransport({
      api: API_URL,
      fetch: fetchRef.current,
      body: { resourceId, threadId: externalId },
    }),
    adapters: { history: historyAdapter },
  });
}

// ─── Thread URL sync ──────────────────────────────────────────────────────────
// Keeps ?thread=<id> in the URL in sync with the active thread.
// Must be rendered inside AssistantRuntimeProvider.

const ThreadUrlSync: FC = () => {
  const externalId = useAuiState((s) => s.threadListItem.externalId);

  useEffect(() => {
    if (!externalId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("thread", externalId);
    window.history.replaceState(null, "", url.toString());
  }, [externalId]);

  return null;
};

// ─── Chat area ────────────────────────────────────────────────────────────────

const ChatArea: FC = () => {
  // Restore the thread from ?thread=<id> on load. assistant-ui switches the
  // active thread to it (via adapter.fetch), so a refresh continues the same
  // conversation instead of opening an empty draft. Captured once at mount.
  const initialThreadId = useMemo(
    () => new URLSearchParams(window.location.search).get("thread") ?? undefined,
    [],
  );

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: ChatRuntimeHook,
    adapter: backendAdapter,
    initialThreadId,
  });


  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <StateProvider initialState={{}}>
        <VisibilityProvider>
          <ActionProvider
            handlers={{
              submit: (params) => console.log("Submit:", params),
              navigate: (params) => console.log("Navigate:", params),
            }}
          >
            <ValidationProvider customFunctions={{}}>
              <div className="flex h-full w-full flex-col">
                <div className="flex flex-1 min-h-0">
                  <ThreadUrlSync />
                  <Shadcn assistantMessage={ChatAssistantMessage} />
                </div>
              </div>
            </ValidationProvider>
          </ActionProvider>
        </VisibilityProvider>
      </StateProvider>
    </AssistantRuntimeProvider>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  return (
    <div className="flex h-full w-full">
      <ChatArea />
    </div>
  );
}
