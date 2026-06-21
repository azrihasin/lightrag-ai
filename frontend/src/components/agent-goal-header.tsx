"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { useAgentHarnessStore, type AgentStep, type HarnessStatus } from "@/lib/agent-harness-store";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Cpu,
  Clock,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function agentDisplayName(name: string): string {
  // Convert camelCase / PascalCase / kebab-case agent IDs to readable labels
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ─── Step indicator ────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "running") {
    return <Loader2 className="size-3.5 animate-spin text-blue-400 shrink-0" />;
  }
  if (status === "complete") {
    return <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />;
  }
  if (status === "error") {
    return <AlertCircle className="size-3.5 text-red-400 shrink-0" />;
  }
  return <div className="size-3.5 rounded-full border border-muted-foreground/40 shrink-0" />;
}

function StepDelta({ step }: { step: AgentStep }) {
  const { textDelta, status } = step;
  if (!textDelta) return null;

  // Code-block output (e.g. SQL) — keep visible after completion
  if (textDelta.startsWith("```")) {
    const lang = textDelta.match(/^```(\w*)/)?.[1] ?? "";
    const code = textDelta.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    return (
      <div className="pl-5 mt-1">
        {lang && (
          <span className="text-[9px] text-muted-foreground/50 font-mono uppercase tracking-wider">
            {lang}
          </span>
        )}
        <pre className="mt-0.5 text-[11px] font-mono text-emerald-300/90 bg-muted/40 rounded px-2 py-1.5 overflow-x-auto max-h-40 leading-relaxed whitespace-pre">
          {code}
        </pre>
      </div>
    );
  }

  // Plain streaming text — only show while running (answer agent, intent summary)
  if (status === "running") {
    return (
      <p className="pl-5 text-[11px] text-muted-foreground/70 font-mono leading-tight after:content-['▋'] after:animate-pulse after:text-blue-400/70 after:ml-0.5">
        {textDelta}
      </p>
    );
  }

  return null;
}

function StepRow({ step }: { step: AgentStep }) {
  return (
    <div className="flex flex-col py-0.5">
      <div className="flex items-center gap-2">
        <StepIcon status={step.status} />
        <span
          className={cn(
            "text-xs",
            step.status === "running" && "text-foreground font-medium",
            step.status === "complete" && "text-muted-foreground",
            step.status === "error" && "text-red-400",
            step.status === "pending" && "text-muted-foreground/50",
          )}
        >
          {agentDisplayName(step.agentName)}
        </span>
        {step.durationMs !== undefined && step.status === "complete" && (
          <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono tabular-nums">
            {formatMs(step.durationMs)}
          </span>
        )}
      </div>
      <StepDelta step={step} />
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, durationMs }: { status: HarnessStatus; durationMs: number }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-blue-400 font-medium">
        <Loader2 className="size-3 animate-spin" />
        Working
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
        <CheckCircle2 className="size-3" />
        Done
        {durationMs > 0 && (
          <span className="text-muted-foreground/60 ml-1 font-normal">{formatMs(durationMs)}</span>
        )}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-400 font-medium">
        <AlertCircle className="size-3" />
        Error
      </span>
    );
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export const AgentGoalHeader = memo(function AgentGoalHeader() {
  const {
    status,
    goal,
    steps,
    currentIteration,
    totalToolCalls,
    totalDurationMs,
    errorMessage,
  } = useAgentHarnessStore();

  // Only show when there's an active or recently completed goal
  if (status === "idle" || !goal) return null;

  const runningStep = steps.find((s) => s.status === "running");
  const completedCount = steps.filter((s) => s.status === "complete").length;

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-(--thread-max-width) px-2 pb-1",
        "animate-in fade-in slide-in-from-top-1 duration-200",
      )}
    >
      <div
        className={cn(
          "rounded-lg border bg-card/60 backdrop-blur-sm overflow-hidden",
          status === "running" && "border-blue-500/20",
          status === "complete" && "border-emerald-500/15",
          status === "error" && "border-red-500/20",
        )}
      >
        {/* Header row */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
          <Cpu
            className={cn(
              "size-3.5 shrink-0",
              status === "running" && "text-blue-400",
              status === "complete" && "text-emerald-400",
              status === "error" && "text-red-400",
            )}
          />

          <p className="flex-1 text-xs text-foreground/80 line-clamp-1 font-medium">
            {goal}
          </p>

          <StatusBadge status={status} durationMs={totalDurationMs} />
        </div>

        {/* Steps timeline */}
        {steps.length > 0 && (
          <div className="px-3 py-2 flex flex-col gap-0.5">
            {steps.map((step) => (
              <StepRow key={`${step.stepId}-${step.startTs}`} step={step} />
            ))}
          </div>
        )}

        {/* Footer: iteration + tool stats */}
        {(currentIteration > 0 || totalToolCalls > 0 || runningStep) && (
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-1.5 border-t border-border/40",
              "bg-muted/20 text-[10px] text-muted-foreground/60 font-mono",
            )}
          >
            {currentIteration > 0 && (
              <span className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                {currentIteration} {currentIteration === 1 ? "step" : "steps"}
              </span>
            )}
            {totalToolCalls > 0 && status === "complete" && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {totalToolCalls} {totalToolCalls === 1 ? "tool call" : "tool calls"}
              </span>
            )}
            {completedCount > 0 && steps.length > 0 && (
              <span className="ml-auto">
                {completedCount}/{steps.length} agents
              </span>
            )}
          </div>
        )}

        {/* Error message */}
        {status === "error" && errorMessage && (
          <div className="px-3 py-2 border-t border-red-500/20 text-xs text-red-400/80">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
});
