"use client";

import { memo, type ReactNode } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { useToolOutputStreamStore } from "@/lib/tool-output-stream";
import {
  AlertTriangleIcon,
  BarChart2Icon,
  BookOpenIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  Code2Icon,
  DatabaseIcon,
  EyeIcon,
  HelpCircleIcon,
  LayoutIcon,
  ListIcon,
  LoaderIcon,
  PenLineIcon,
  PlayIcon,
  SearchIcon,
  ShieldCheckIcon,
  TerminalIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
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

// ─── Shared wrapper: one ToolGroupRoot per node ───────────────────────────────

type StatusType = { type: string } | undefined;

type AgentToolGroupProps = {
  label: string;
  status: StatusType;
  toolCallId?: string;
  children: ReactNode;
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

// ─── Shared content row ───────────────────────────────────────────────────────

type RowProps = {
  icon: ReactNode;
  detail?: string;
  result?: string;
  status: StatusType;
  className?: string;
};

function ToolRow({ icon, detail, result, status, className }: RowProps) {
  const isRunning = status?.type === "running";
  const isError = status?.type === "incomplete";

  return (
    <div className={cn("flex items-start gap-2.5 py-0.5 px-1", className)}>
      <div className="mt-0.5 shrink-0 text-muted-foreground/60">{icon}</div>
      <div className="min-w-0 flex-1">
        {detail && (
          <p className="truncate text-xs text-muted-foreground/75">{detail}</p>
        )}
        {result && !isRunning && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground/50">
            {result}
          </p>
        )}
      </div>
      <div className="mt-0.5 shrink-0">
        {isRunning && (
          <LoaderIcon className="size-3 animate-spin text-muted-foreground/50" />
        )}
        {!isRunning && !isError && status && (
          <CheckCircle2Icon className="size-3 text-green-500" />
        )}
        {isError && <XCircleIcon className="size-3 text-destructive" />}
      </div>
    </div>
  );
}

// ─── Phase 1 – Context & Clarification ───────────────────────────────────────

export const RetrieveContextUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Retrieve Context" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<DatabaseIcon className="size-3.5" />}
          detail={trunc(args.query)}
          result={
            out.documentCount !== undefined
              ? `${out.documentCount} docs · sufficient: ${out.sufficient}`
              : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
RetrieveContextUI.displayName = "RetrieveContextUI";

export const AnswerFromContextUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Answer from Context" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<BookOpenIcon className="size-3.5" />}
          detail={trunc(args.intent)}
          result={
            out.responseLength ? `${out.responseLength} chars composed` : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
AnswerFromContextUI.displayName = "AnswerFromContextUI";

export const ClarificationRequestUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Clarification Request" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<HelpCircleIcon className="size-3.5" />}
          detail={trunc(args.intent)}
          result={out.responseLength ? `${out.responseLength} chars` : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
ClarificationRequestUI.displayName = "ClarificationRequestUI";

export const GenericSearchUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    return (
      <AgentToolGroup label="Generic Search" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<SearchIcon className="size-3.5" />}
          detail={trunc(args.intent ?? args.query)}
          result={result !== undefined ? trunc(result, 80) : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
GenericSearchUI.displayName = "GenericSearchUI";

export const CalculatorUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    return (
      <AgentToolGroup label="Calculator" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<CalculatorIcon className="size-3.5" />}
          detail={trunc(args.expression ?? args.a ?? argsText)}
          result={result !== undefined ? `= ${trunc(result)}` : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
CalculatorUI.displayName = "CalculatorUI";

// ─── Phase 2 – SQL / Action ───────────────────────────────────────────────────

export const GenerateSqlUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Generate SQL" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<Code2Icon className="size-3.5" />}
          detail={`${args.dialect ?? "postgres"} · ${trunc(args.intent)}`}
          result={out.sql ? trunc(out.sql, 80) : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
GenerateSqlUI.displayName = "GenerateSqlUI";

export const ValidateSqlUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Validate SQL" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<ShieldCheckIcon className="size-3.5" />}
          detail={trunc(args.sql)}
          result={
            out.status
              ? `${out.status}${out.reason ? ` · ${trunc(out.reason, 40)}` : ""}`
              : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
ValidateSqlUI.displayName = "ValidateSqlUI";

export const ExecuteSqlUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Execute SQL" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<PlayIcon className="size-3.5" />}
          detail={trunc(args.sql)}
          result={
            out.rowCount !== undefined
              ? `${out.rowCount} rows`
              : result !== undefined
                ? trunc(result, 60)
                : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
ExecuteSqlUI.displayName = "ExecuteSqlUI";

export const GenerateActionUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Generate Action" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<ZapIcon className="size-3.5" />}
          detail={`${args.system ?? args.strategy ?? ""} · ${trunc(args.intent)}`}
          result={out.toolName ? `→ ${out.toolName}` : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
GenerateActionUI.displayName = "GenerateActionUI";

export const ValidateActionUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Validate Action" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<ShieldCheckIcon className="size-3.5" />}
          detail={trunc(args.toolName)}
          result={
            out.status
              ? `${out.status}${out.reason ? ` · ${trunc(out.reason, 40)}` : ""}`
              : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
ValidateActionUI.displayName = "ValidateActionUI";

export const ExecuteSystemActionUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    return (
      <AgentToolGroup label="Execute System Action" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<TerminalIcon className="size-3.5" />}
          detail={trunc(args.toolName ?? args.intent)}
          result={result !== undefined ? trunc(result, 80) : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
ExecuteSystemActionUI.displayName = "ExecuteSystemActionUI";

// ─── Phase 3 – Result & Visualization ────────────────────────────────────────

export const InspectResultUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Inspect Result" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<EyeIcon className="size-3.5" />}
          detail={trunc(args.intent)}
          result={
            out.complete !== undefined ? `complete: ${out.complete}` : undefined
          }
          status={status}
        />
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
        <ToolRow
          icon={<BarChart2Icon className="size-3.5" />}
          detail={`suitable: ${out.suitable ?? "…"}`}
          result={
            out.componentType ? `component: ${out.componentType}` : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
PrepareVisualizationUI.displayName = "PrepareVisualizationUI";

export const RenderVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Render Visualization" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<LayoutIcon className="size-3.5" />}
          detail={trunc(args.componentType)}
          result={
            out.rendered !== undefined
              ? out.rendered
                ? "rendered ✓"
                : "render failed"
              : undefined
          }
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
RenderVisualizationUI.displayName = "RenderVisualizationUI";

// ─── Phase 4 – Review & Response ─────────────────────────────────────────────

export const SummarizeResultUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Summarize Result" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<ListIcon className="size-3.5" />}
          detail={trunc(args.intent)}
          result={out.summary ? trunc(out.summary, 80) : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
SummarizeResultUI.displayName = "SummarizeResultUI";

export const HumanReviewUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    return (
      <AgentToolGroup label="Human Review" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={
            <AlertTriangleIcon className="size-3.5 text-amber-500 dark:text-amber-400" />
          }
          detail={`risk: ${args.riskLevel ?? "unknown"} · ${trunc(args.reason, 50)}`}
          result={out.reviewNotes ? trunc(out.reviewNotes, 80) : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
HumanReviewUI.displayName = "HumanReviewUI";

export const ComposeResponseUI: ToolCallMessagePartComponent = memo(
  ({ argsText, result, status, toolCallId }) => {
    const args = parseJson(argsText);
    const out = parseJson(result);
    const flags = [
      args.hasSummary && "summary",
      args.hasVisualization && "visualization",
    ]
      .filter(Boolean)
      .join(" + ");
    return (
      <AgentToolGroup label="Compose Response" status={status} toolCallId={toolCallId}>
        <ToolRow
          icon={<PenLineIcon className="size-3.5" />}
          detail={
            flags ? `${trunc(args.intent, 40)} · ${flags}` : trunc(args.intent)
          }
          result={out.responseLength ? `${out.responseLength} chars` : undefined}
          status={status}
        />
      </AgentToolGroup>
    );
  },
);
ComposeResponseUI.displayName = "ComposeResponseUI";
