import {
  makeAssistantTool,
  useAuiState,
} from "@assistant-ui/react";
import type { ToolCallMessagePart } from "@assistant-ui/react";
import { CodeIcon, EyeIcon, TerminalIcon, XIcon } from "lucide-react";
import { useState, type FC } from "react";
import { z } from "zod";

export const RenderHTMLTool = makeAssistantTool({
  toolName: "render_html",
  description:
    "Whenever the user asks for HTML, a webpage, a UI component, or any visual content, call this function. The user will see the HTML rendered live in their browser.",
  parameters: z.object({
    code: z.string().describe("The complete HTML code to render, including inline CSS and JavaScript if needed."),
  }),
  execute: async () => ({}),
  render: () => (
    <div className="my-2 inline-flex items-center gap-2 rounded-full border bg-primary px-4 py-2 text-primary-foreground text-sm">
      <TerminalIcon className="size-4" />
      render_html({"{ code: \"...\" }"})
    </div>
  ),
});

export const ArtifactsPanel: FC = () => {
  const [tab, setTab] = useState<"source" | "preview">("source");

  const lastToolCall = useAuiState((s) => {
    const messages = s.thread.messages;
    return messages
      .flatMap((m) =>
        m.content.filter(
          (c): c is ToolCallMessagePart =>
            c.type === "tool-call" && c.toolName === "render_html",
        ),
      )
      .at(-1);
  });

  const code = lastToolCall?.args?.code as string | undefined;
  const isComplete = lastToolCall?.result !== undefined;

  if (!code) return null;

  return (
    <div className="flex flex-grow basis-full min-w-0 p-3 border-l border-border">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border bg-background">
        {/* Tab bar */}
        <div className="flex shrink-0 border-b bg-muted/30">
          <button
            type="button"
            onClick={() => setTab("source")}
            className={`inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 font-medium text-sm transition-colors ${
              tab === "source"
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CodeIcon className="size-4" />
            Source Code
          </button>
          <button
            type="button"
            onClick={() => isComplete && setTab("preview")}
            disabled={!isComplete}
            className={`inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 font-medium text-sm transition-colors ${
              !isComplete
                ? "cursor-not-allowed opacity-50"
                : tab === "preview"
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <EyeIcon className="size-4" />
            Preview
            {!isComplete && (
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("source")}
            className="flex items-center px-3 text-muted-foreground hover:text-foreground"
            aria-label="Close preview"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        {/* Content */}
        {tab === "source" || !isComplete ? (
          <pre className="h-full overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm text-foreground leading-relaxed">
            {code}
          </pre>
        ) : (
          <iframe
            className="h-full w-full flex-grow"
            title="Artifact Preview"
            srcDoc={code}
            sandbox="allow-scripts"
          />
        )}
      </div>
    </div>
  );
};
