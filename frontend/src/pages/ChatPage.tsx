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
import { LightragUiRetrievalTool } from "@/components/lightrag-ui-retrieval-tool";
import { SqlQueryMakerTool, SqlExecutionRegistrar } from "@/components/sql-tool";
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
import { registry } from "@/lib/registry";
import { createStreamingFetch } from "@/lib/streaming-fetch";
import { useMemo, useRef, type FC } from "react";

function withGhostReasoning(
  Component: ToolCallMessagePartComponent,
  label: string,
): ToolCallMessagePartComponent {
  return (props) => {
    const isRunning = props.status?.type === "running";
    return (
      <ReasoningRoot variant="ghost" defaultOpen={true} className="m-2">
        <ReasoningTrigger active={isRunning} label={label} />
        <ReasoningContent>
          <Component {...props} />
        </ReasoningContent>
      </ReasoningRoot>
    );
  };
}


const ToolFallbackWithAgent: ToolCallMessagePartComponent = (props) => (
  <div className="m-2">
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
    <ToolFallback {...(props as any)} agentName={getAgentForTool(props.toolName)} />
  </div>
);

// Use the local backend by default so the UI talks to the LightRAG SSE endpoint.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/chat";


const ChatAssistantMessage: FC = () => {
  const parts = useAuiState((s) => s.message.parts);

  const jsonRenderParts = useMemo(
    (): DataPart[] =>
      parts.reduce<DataPart[]>((acc, part) => {
        if (part.type === "text") {
          acc.push({ type: "text", text: part.text });
          return acc;
        }

        if (part.type === "data" && part.name === "spec") {
          acc.push({ type: "data-spec", data: part.data });
        } else {
          const p = part as { type?: string; data?: unknown };
          if (p.type === "data-spec" && p.data) {
            acc.push({ type: "data-spec", data: p.data });
          }
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
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: {
              by_name: {
                // Phase 1 – Data Gathering: raw code block display
                synthesize_gathered_data: withGhostReasoning(ToolFallback, "Structured data"),
                search: withGhostReasoning(ToolFallback, "Search"),
                calculator: withGhostReasoning(ToolFallback, "Calculator"),
                multiply_numbers: withGhostReasoning(ToolFallback, "Calculator"),
                retrieval_agent_tool: withGhostReasoning(ToolFallback, "Retrieval"),
                create_sql_agent_tool: SqlQueryMakerTool,
                execute_sql_agent_tool: SqlExecutionRegistrar,
                // Phase 2 – UI Discovery
                lightrag_ui_component_retrieve: withGhostReasoning(LightragUiRetrievalTool, "UI Component Discovery"),
                // Phase 2.5 – Normalization Agent
                normalize_data: withGhostReasoning(ToolFallback, "Normalization Agent"),
              },
              Fallback: ToolFallbackWithAgent,
            },
          }}
        />
        {hasSpec && spec && (
          <Renderer spec={spec} registry={registry} />
        )}
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

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
