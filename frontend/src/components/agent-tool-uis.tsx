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

function NodeStreamingText({ toolCallId }: { toolCallId?: string }) {
  const partial = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );
  if (!partial) return null;
  return (
    <p className="mt-1 px-1 text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed">
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
        <NodeStreamingText toolCallId={toolCallId} />
      </ToolGroupContent>
    </ToolGroupRoot>
  );
}

// ─── Retrieve Context — rich streaming display ────────────────────────────────

function RetrieveContextStream({
  status,
  result,
}: {
  status: StatusType;
  result: string | undefined;
}) {
  const isRunning = status?.type === "running";
  const out = parseJson(result);

  // ── Complete: source badges only ─────────────────────────────────────────
  if (!isRunning && result) {
    const rawSources = out.sources;
    const sources: string[] = Array.isArray(rawSources)
      ? (rawSources as unknown[]).map((s) => String(s))
      : [];

    if (sources.length === 0) return null;

    return (
      <div className="mt-1.5 px-1">
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
      </div>
    );
  }

  return null;
}

// ─── Phase 0 – Intent & Strategy ─────────────────────────────────────────────

export const AnalyzeIntentUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Analyzing Intent" status={status} toolCallId={toolCallId} />
  ),
);
AnalyzeIntentUI.displayName = "AnalyzeIntentUI";

export const StrategyDecisionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Planning Strategy" status={status} toolCallId={toolCallId} />
  ),
);
StrategyDecisionUI.displayName = "StrategyDecisionUI";

// ─── Phase 1 – Context & Clarification ───────────────────────────────────────

export const RetrieveContextUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    const isRunning = status?.type === "running";
    return (
      <ToolGroupRoot variant="ghost" defaultOpen className="my-1 mx-2">
        <ToolGroupTrigger count={1} label="Retrieve Context" active={isRunning} />
        <ToolGroupContent>
          <NodeStreamingText toolCallId={toolCallId} />
          <RetrieveContextStream
            status={status}
            result={result}
          />
        </ToolGroupContent>
      </ToolGroupRoot>
    );
  },
);
RetrieveContextUI.displayName = "RetrieveContextUI";

export const PlanNextStepUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Planning Next Step" status={status} toolCallId={toolCallId} />
  ),
);
PlanNextStepUI.displayName = "PlanNextStepUI";

export const ClarificationRequestUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Clarification Request" status={status} toolCallId={toolCallId} />
    );
  },
);
ClarificationRequestUI.displayName = "ClarificationRequestUI";

export const GenericSearchUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Generic Search" status={status} toolCallId={toolCallId} />
  ),
);
GenericSearchUI.displayName = "GenericSearchUI";

export const CalculatorUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Calculator" status={status} toolCallId={toolCallId} />
  ),
);
CalculatorUI.displayName = "CalculatorUI";

// ─── Phase 2 – SQL / Action ───────────────────────────────────────────────────

export const GenerateSqlUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Generate SQL" status={status} toolCallId={toolCallId} />
    );
  },
);
GenerateSqlUI.displayName = "GenerateSqlUI";

export const ValidateSqlUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Validate SQL" status={status} toolCallId={toolCallId} />
    );
  },
);
ValidateSqlUI.displayName = "ValidateSqlUI";

export const ExecuteSqlUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Execute SQL" status={status} toolCallId={toolCallId} />
    );
  },
);
ExecuteSqlUI.displayName = "ExecuteSqlUI";

export const GenerateActionUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Generate Action" status={status} toolCallId={toolCallId} />
    );
  },
);
GenerateActionUI.displayName = "GenerateActionUI";

export const ValidateActionUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Validate Action" status={status} toolCallId={toolCallId} />
    );
  },
);
ValidateActionUI.displayName = "ValidateActionUI";

export const ExecuteSystemActionUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Execute System Action" status={status} toolCallId={toolCallId} />
  ),
);
ExecuteSystemActionUI.displayName = "ExecuteSystemActionUI";

// ─── Phase 3 – Result & Visualization ────────────────────────────────────────

export const InspectResultUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Inspect Result" status={status} toolCallId={toolCallId} />
    );
  },
);
InspectResultUI.displayName = "InspectResultUI";

export const DecideNextStepUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Deciding Next Step" status={status} toolCallId={toolCallId} />
  ),
);
DecideNextStepUI.displayName = "DecideNextStepUI";

export const PrepareVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Prepare Visualization" status={status} toolCallId={toolCallId} />
    );
  },
);
PrepareVisualizationUI.displayName = "PrepareVisualizationUI";

export const RenderVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Render Visualization" status={status} toolCallId={toolCallId} />
    );
  },
);
RenderVisualizationUI.displayName = "RenderVisualizationUI";

// ─── Phase 4 – Review & Response ─────────────────────────────────────────────

export const SummarizeResultUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Summarize Result" status={status} toolCallId={toolCallId} />
    );
  },
);
SummarizeResultUI.displayName = "SummarizeResultUI";

export const HumanReviewUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Human Review" status={status} toolCallId={toolCallId} />
    );
  },
);
HumanReviewUI.displayName = "HumanReviewUI";

export const ComposeResponseUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => {
    void parseJson(result);
    return (
      <AgentToolGroup label="Compose Response" status={status} toolCallId={toolCallId} />
    );
  },
);
ComposeResponseUI.displayName = "ComposeResponseUI";
