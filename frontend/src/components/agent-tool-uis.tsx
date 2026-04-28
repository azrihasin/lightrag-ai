"use client";

import { memo, type ReactNode } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useToolOutputStreamStore } from "@/lib/tool-output-stream";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(s: unknown): Record<string, unknown> {
  if (s === null || s === undefined) return {};
  const str = typeof s === "string" ? s : JSON.stringify(s);
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function trunc(v: unknown, max = 60): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ─── Shared wrapper ───────────────────────────────────────────────────────────

type StatusType = { type: string } | undefined;

type AgentToolGroupProps = {
  label: string;
  status: StatusType;
  toolCallId?: string;
  children?: ReactNode;
};

function NodeStreamingText({ toolCallId, status }: { toolCallId?: string; status: StatusType }) {
  const partial = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );
  if (!partial || status?.type !== "running") return null;
  return (
    <p className="mt-1 px-1 text-xs text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">
      {partial}
    </p>
  );
}

function AgentToolGroup({ label, status, toolCallId, children }: AgentToolGroupProps) {
  const isRunning = status?.type === "running";
  return (
    <ToolGroupRoot variant="ghost" defaultOpen className="my-1 mx-2">
      <ToolGroupTrigger count={1} label={label} active={isRunning} />
      <ToolGroupContent>
        {children}
        <NodeStreamingText toolCallId={toolCallId} status={status} />
      </ToolGroupContent>
    </ToolGroupRoot>
  );
}

// ─── Retrieve Context — rich streaming display ────────────────────────────────

type RetrievedItem = { title?: string; source?: string; score?: number };

function RetrieveContextStream({
  toolCallId,
  status,
  result,
}: {
  toolCallId?: string;
  status: StatusType;
  result: string | undefined;
}) {
  const partial = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );
  const isRunning = status?.type === "running";
  const out = parseJson(result);

  // ── Running: stream the initial delta text ────────────────────────────────
  if (isRunning && partial) {
    return (
      <div className="mt-1 px-1">
        <p className="text-xs text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">
          {partial}
          <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-muted-foreground/50 align-middle" />
        </p>
      </div>
    );
  }

  // ── Complete: code block + summary + source badges ────────────────────────
  if (!isRunning && result) {
    const rawItems = out.items;
    const items: RetrievedItem[] = Array.isArray(rawItems)
      ? (rawItems as RetrievedItem[])
      : [];
    const rawSources = out.sources;
    const sources: string[] = Array.isArray(rawSources)
      ? (rawSources as unknown[]).map((s) => String(s))
      : [];
    const summary = typeof out.summary === "string" ? out.summary : "";

    const codeLines = items.map((item, i) => {
      const title = item.title ?? `Item ${i + 1}`;
      const src = item.source ?? "—";
      const score =
        typeof item.score === "number"
          ? ` (score: ${item.score.toFixed(2)})`
          : "";
      return `[${i + 1}] ${title}\n    source: ${src}${score}`;
    });

    return (
      <div className="mt-1.5 space-y-2.5 px-1">
        {/* Retrieved items code block */}
        {codeLines.length > 0 && (
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs font-mono leading-relaxed text-muted-foreground">
            {codeLines.join("\n\n")}
          </pre>
        )}

        {/* Streaming summary */}
        {summary && (
          <p className="text-xs leading-relaxed text-muted-foreground/75">
            {summary}
          </p>
        )}

        {/* Source file references */}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="self-center text-xs text-muted-foreground/40 mr-0.5">
              sources:
            </span>
            {sources.slice(0, 8).map((src, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground ring-1 ring-inset ring-muted-foreground/20"
              >
                {src}
              </span>
            ))}
            {sources.length > 8 && (
              <span className="self-center text-xs text-muted-foreground/40">
                +{sources.length - 8} more
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Phase 1 – Context & Clarification ───────────────────────────────────────

export const RetrieveContextUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const isRunning = status?.type === "running";
    return (
      <ToolGroupRoot variant="ghost" defaultOpen className="my-1 mx-2">
        <ToolGroupTrigger count={1} label="Retrieve Context" active={isRunning} />
        <ToolGroupContent>
          <RetrieveContextStream
            toolCallId={toolCallId}
            status={status}
            result={result}
          />
        </ToolGroupContent>
      </ToolGroupRoot>
    );
  },
);
RetrieveContextUI.displayName = "RetrieveContextUI";

export const AnswerFromContextUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Answer from Context" status={status} toolCallId={toolCallId}>
        {out.responseLength ? (
          <p className="px-1 text-xs text-muted-foreground/50">
            {String(out.responseLength)} chars composed
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
AnswerFromContextUI.displayName = "AnswerFromContextUI";

export const ClarificationRequestUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Clarification Request" status={status} toolCallId={toolCallId}>
        {out.responseLength ? (
          <p className="px-1 text-xs text-muted-foreground/50">
            {String(out.responseLength)} chars
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
ClarificationRequestUI.displayName = "ClarificationRequestUI";

export const GenericSearchUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Generic Search" status={status} toolCallId={toolCallId}>
      {result !== undefined ? (
        <p className="px-1 text-xs text-muted-foreground/50">{trunc(result, 80)}</p>
      ) : null}
    </AgentToolGroup>
  ),
);
GenericSearchUI.displayName = "GenericSearchUI";

export const CalculatorUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Calculator" status={status} toolCallId={toolCallId}>
      {result !== undefined ? (
        <p className="px-1 text-xs text-muted-foreground/50">= {trunc(result)}</p>
      ) : null}
    </AgentToolGroup>
  ),
);
CalculatorUI.displayName = "CalculatorUI";

// ─── Phase 2 – SQL / Action ───────────────────────────────────────────────────

export const GenerateSqlUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Generate SQL" status={status} toolCallId={toolCallId}>
        {out.sql ? (
          <p className="px-1 text-xs text-muted-foreground/50 truncate">{trunc(out.sql, 80)}</p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
GenerateSqlUI.displayName = "GenerateSqlUI";

export const ValidateSqlUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    const text = out.status
      ? `${out.status}${out.reason ? ` · ${trunc(out.reason, 40)}` : ""}`
      : undefined;
    return (
      <AgentToolGroup label="Validate SQL" status={status} toolCallId={toolCallId}>
        {text ? <p className="px-1 text-xs text-muted-foreground/50">{text}</p> : null}
      </AgentToolGroup>
    );
  },
);
ValidateSqlUI.displayName = "ValidateSqlUI";

export const ExecuteSqlUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    const text =
      out.rowCount !== undefined
        ? `${out.rowCount} rows`
        : result !== undefined
          ? trunc(result, 60)
          : undefined;
    return (
      <AgentToolGroup label="Execute SQL" status={status} toolCallId={toolCallId}>
        {text ? <p className="px-1 text-xs text-muted-foreground/50">{text}</p> : null}
      </AgentToolGroup>
    );
  },
);
ExecuteSqlUI.displayName = "ExecuteSqlUI";

export const GenerateActionUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Generate Action" status={status} toolCallId={toolCallId}>
        {out.toolName ? (
          <p className="px-1 text-xs text-muted-foreground/50">→ {String(out.toolName)}</p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
GenerateActionUI.displayName = "GenerateActionUI";

export const ValidateActionUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    const text = out.status
      ? `${out.status}${out.reason ? ` · ${trunc(out.reason, 40)}` : ""}`
      : undefined;
    return (
      <AgentToolGroup label="Validate Action" status={status} toolCallId={toolCallId}>
        {text ? <p className="px-1 text-xs text-muted-foreground/50">{text}</p> : null}
      </AgentToolGroup>
    );
  },
);
ValidateActionUI.displayName = "ValidateActionUI";

export const ExecuteSystemActionUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Execute System Action" status={status} toolCallId={toolCallId}>
      {result !== undefined ? (
        <p className="px-1 text-xs text-muted-foreground/50 truncate">{trunc(result, 80)}</p>
      ) : null}
    </AgentToolGroup>
  ),
);
ExecuteSystemActionUI.displayName = "ExecuteSystemActionUI";

// ─── Phase 3 – Result & Visualization ────────────────────────────────────────

export const InspectResultUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Inspect Result" status={status} toolCallId={toolCallId}>
        {out.complete !== undefined ? (
          <p className="px-1 text-xs text-muted-foreground/50">
            complete: {String(out.complete)}
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
InspectResultUI.displayName = "InspectResultUI";

export const PrepareVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Prepare Visualization" status={status} toolCallId={toolCallId}>
        {out.componentType ? (
          <p className="px-1 text-xs text-muted-foreground/50">
            component: {String(out.componentType)}
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
PrepareVisualizationUI.displayName = "PrepareVisualizationUI";

export const RenderVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    const text =
      out.rendered !== undefined
        ? out.rendered
          ? "rendered ✓"
          : "render failed"
        : undefined;
    return (
      <AgentToolGroup label="Render Visualization" status={status} toolCallId={toolCallId}>
        {text ? <p className="px-1 text-xs text-muted-foreground/50">{text}</p> : null}
      </AgentToolGroup>
    );
  },
);
RenderVisualizationUI.displayName = "RenderVisualizationUI";

// ─── Phase 4 – Review & Response ─────────────────────────────────────────────

export const SummarizeResultUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Summarize Result" status={status} toolCallId={toolCallId}>
        {out.summary ? (
          <p className="px-1 text-xs text-muted-foreground/50 truncate">
            {trunc(out.summary, 80)}
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
SummarizeResultUI.displayName = "SummarizeResultUI";

export const HumanReviewUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Human Review" status={status} toolCallId={toolCallId}>
        {out.reviewNotes ? (
          <p className="px-1 text-xs text-muted-foreground/50 truncate">
            {trunc(out.reviewNotes, 80)}
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
HumanReviewUI.displayName = "HumanReviewUI";

export const ComposeResponseUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Compose Response" status={status} toolCallId={toolCallId}>
        {out.responseLength ? (
          <p className="px-1 text-xs text-muted-foreground/50">
            {String(out.responseLength)} chars
          </p>
        ) : null}
      </AgentToolGroup>
    );
  },
);
ComposeResponseUI.displayName = "ComposeResponseUI";
