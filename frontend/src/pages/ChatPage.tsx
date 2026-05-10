import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  useAuiState,
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
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/assistant-ui/reasoning";
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
import { createStreamingFetch } from "@/lib/streaming-fetch";
import { useMemo, useRef, type FC } from "react";

// ─── Fallback for unrecognised tools ─────────────────────────────────────────

const ToolFallbackWithAgent: ToolCallMessagePartComponent = (props) => (
  <div className="m-2">
    <ToolFallback {...(props as any)} agentName={getAgentForTool(props.toolName)} />
  </div>
);

// ─── API URL ──────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/chat";

// ─── Assistant message ────────────────────────────────────────────────────────

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

const ChatAssistantMessage: FC = () => {
  const parts = useAuiState((s) => s.message.parts);
  const messageStatus = useAuiState((s) => s.message.status);
  const isRunning = (messageStatus as { type?: string } | undefined)?.type === "running";

  const hasToolParts = parts.some((p) => p.type === "tool-call");

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
          <ReasoningRoot variant="ghost" defaultOpen>
            <ReasoningTrigger active={isRunning} />
            <ReasoningContent>
              <AgentToolTimeline>
                <MessagePrimitive.Parts
                  components={{
                    Text: NoOp,
                    tools: { by_name: toolsByName, Fallback: ToolFallbackWithAgent },
                  }}
                />
              </AgentToolTimeline>
            </ReasoningContent>
          </ReasoningRoot>
        )}

        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: { Fallback: NoOp },
          }}
        />

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const fetchRef = useRef(createStreamingFetch());
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: API_URL, fetch: fetchRef.current }),
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
                  <Shadcn assistantMessage={ChatAssistantMessage} />
                </div>
              </div>
            </ValidationProvider>
          </ActionProvider>
        </VisibilityProvider>
      </StateProvider>
    </AssistantRuntimeProvider>
  );
}
