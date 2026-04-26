"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClockIcon,
  LoaderIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useProgressStore,
  PHASE_LABELS,
  type ProgressEvent,
  type ProgressStatus,
} from "@/lib/progress-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByPhase(events: ProgressEvent[]): Array<{
  phase: string;
  label: string;
  items: ProgressEvent[];
  phaseStatus: ProgressStatus;
  phaseStart: number;
  phaseEnd: number | null;
}> {
  const seen = new Map<
    string,
    { phase: string; label: string; items: ProgressEvent[] }
  >();

  for (const ev of events) {
    if (!seen.has(ev.phase)) {
      seen.set(ev.phase, {
        phase: ev.phase,
        label: PHASE_LABELS[ev.phase] ?? ev.phase,
        items: [],
      });
    }
    seen.get(ev.phase)!.items.push(ev);
  }

  return Array.from(seen.values()).map((group) => {
    const hasError = group.items.some((e) => e.status === "error");
    const allDone = group.items.every((e) => e.status !== "running");
    const phaseStatus: ProgressStatus = hasError
      ? "error"
      : allDone
        ? "complete"
        : "running";

    const phaseStart = group.items.reduce(
      (min, e) => Math.min(min, e.ts),
      Infinity,
    );
    const phaseEnd =
      allDone
        ? group.items.reduce((max, e) => Math.max(max, e.ts), 0)
        : null;

    return { ...group, phaseStatus, phaseStart, phaseEnd };
  });
}

/** Extract ordered unique substep IDs preserving first-seen order. */
function substepOrder(items: ProgressEvent[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const ev of items) {
    if (ev.substepId && !seen.has(ev.substepId)) {
      seen.add(ev.substepId);
      order.push(ev.substepId);
    }
  }
  return order;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function StepIcon({
  status,
  size = "sm",
}: {
  status: ProgressStatus;
  size?: "sm" | "xs";
}) {
  const cls = size === "xs" ? "size-2.5" : "size-3";
  if (status === "running")
    return (
      <LoaderIcon
        className={cn(cls, "shrink-0 animate-spin text-blue-500 dark:text-blue-400")}
      />
    );
  if (status === "error")
    return <CircleAlertIcon className={cn(cls, "shrink-0 text-destructive")} />;
  return (
    <CheckIcon
      className={cn(cls, "shrink-0 text-emerald-500 dark:text-emerald-400")}
    />
  );
}

// ---------------------------------------------------------------------------
// Live timer (ticks every 100ms while a substep is running)
// ---------------------------------------------------------------------------

function LiveTimer({ startTs }: { startTs: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startTs);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTs), 100);
    return () => clearInterval(id);
  }, [startTs]);

  return (
    <span className="tabular-nums text-[10px] text-blue-400 dark:text-blue-500">
      {formatMs(elapsed)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Substep row
// ---------------------------------------------------------------------------

function SubstepRow({
  substepId,
  events,
}: {
  substepId: string;
  events: ProgressEvent[];
}) {
  const runningEv = events.find((e) => e.status === "running");
  const doneEv = events.find(
    (e) => e.status === "complete" || e.status === "error",
  );
  const current = doneEv ?? runningEv;
  if (!current) return null;

  const elapsedMs =
    runningEv && doneEv ? doneEv.ts - runningEv.ts : null;

  return (
    <div className="flex items-center gap-2 py-[3px] pl-5">
      {/* connector line + icon */}
      <span className="relative flex shrink-0 items-center">
        <span className="absolute -left-3.5 top-1/2 h-px w-3 -translate-y-1/2 bg-border/50" />
        <StepIcon status={current.status} size="xs" />
      </span>

      {/* label + detail */}
      <span
        className={cn(
          "flex-1 text-[11px] leading-snug",
          current.status === "error"
            ? "text-destructive"
            : current.status === "running"
              ? "text-foreground/90"
              : "text-foreground/60",
        )}
      >
        {current.message}
        {current.detail && (
          <span
            className={cn(
              "ml-1.5",
              current.status === "running"
                ? "text-blue-500/80 dark:text-blue-400/70"
                : "text-muted-foreground",
            )}
          >
            · {current.detail}
          </span>
        )}
      </span>

      {/* timing */}
      <span className="ml-auto shrink-0 pl-2">
        {current.status === "running" && runningEv ? (
          <LiveTimer startTs={runningEv.ts} />
        ) : elapsedMs !== null ? (
          <span className="tabular-nums text-[10px] text-muted-foreground/60">
            {formatMs(elapsedMs)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regular step row (non-substep)
// ---------------------------------------------------------------------------

function StepRow({ event }: { event: ProgressEvent }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="mt-0.5 shrink-0">
        <StepIcon status={event.status} />
      </span>
      <span
        className={cn(
          "text-xs leading-snug",
          event.status === "error" ? "text-destructive" : "text-foreground/80",
        )}
      >
        {event.message}
        {event.detail && (
          <span className="ml-1.5 text-muted-foreground">· {event.detail}</span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase group
// ---------------------------------------------------------------------------

function PhaseGroup({
  phase,
  label,
  items,
  phaseStatus,
  phaseStart,
  phaseEnd,
}: {
  phase: string;
  label: string;
  items: ProgressEvent[];
  phaseStatus: ProgressStatus;
  phaseStart: number;
  phaseEnd: number | null;
}) {
  const regularItems = items.filter((e) => !e.substepId);
  const substepIds = substepOrder(items);
  const hasSubsteps = substepIds.length > 0;

  const phaseDuration =
    phaseEnd !== null && phaseStart !== Infinity
      ? phaseEnd - phaseStart
      : null;

  return (
    <div data-phase={phase} className="flex gap-3">
      {/* Left rail */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "mt-1 size-2 rounded-full shrink-0",
            phaseStatus === "running" && "bg-blue-500 dark:bg-blue-400",
            phaseStatus === "complete" &&
              "bg-emerald-500 dark:bg-emerald-400",
            phaseStatus === "error" && "bg-destructive",
          )}
        />
        <div className="mt-1 w-px flex-1 bg-border/60" />
      </div>

      {/* Right: label + steps */}
      <div className="pb-3 min-w-0 flex-1">
        {/* Phase header */}
        <div className="mb-1.5 flex items-center gap-2">
          <p
            className={cn(
              "text-xs font-semibold",
              phaseStatus === "running" &&
                "text-blue-600 dark:text-blue-400",
              phaseStatus === "complete" && "text-foreground/70",
              phaseStatus === "error" && "text-destructive",
            )}
          >
            {label}
          </p>
          {/* Phase duration badge (shown when complete) */}
          {phaseDuration !== null && phaseStatus !== "running" && (
            <span className="flex items-center gap-0.5 rounded-full bg-muted/60 px-1.5 py-px text-[10px] text-muted-foreground tabular-nums">
              <ClockIcon className="size-2.5" />
              {formatMs(phaseDuration)}
            </span>
          )}
        </div>

        {/* Regular (non-substep) events */}
        {regularItems.length > 0 && (
          <div className="mb-1 flex flex-col gap-px">
            {regularItems.map((ev, i) => (
              <StepRow key={`${ev.phase}-${ev.step}-${i}`} event={ev} />
            ))}
          </div>
        )}

        {/* Substep list */}
        {hasSubsteps && (
          <div
            className={cn(
              "relative flex flex-col",
              "before:absolute before:left-[18px] before:top-0 before:h-full before:w-px",
              "before:bg-border/40",
            )}
          >
            {substepIds.map((sid) => (
              <SubstepRow
                key={sid}
                substepId={sid}
                events={items.filter((e) => e.substepId === sid)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AgentTimeline
// ---------------------------------------------------------------------------

export interface AgentTimelineProps {
  isRunning: boolean;
}

function AgentTimelineImpl({ isRunning }: AgentTimelineProps) {
  const { isActive, events } = useProgressStore();
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive && !isRunning && events.length > 0) {
      const id = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(id);
    }
  }, [isActive, isRunning, events.length]);

  useEffect(() => {
    if (isRunning && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events.length, isRunning]);

  if (events.length === 0) return null;

  const groups = groupByPhase(events);
  const overallRunning = events.some((e) => e.status === "running");

  return (
    <div
      className={cn(
        "mb-3 w-full rounded-xl border overflow-hidden",
        "border-blue-200/70 dark:border-blue-800/50",
        "bg-gradient-to-br from-blue-50/60 to-indigo-50/40",
        "dark:from-blue-950/30 dark:to-indigo-950/20",
        "transition-all duration-300",
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <ZapIcon
          className={cn(
            "size-3.5 shrink-0 text-blue-500 dark:text-blue-400",
            overallRunning && "animate-pulse",
          )}
        />
        <span className="flex-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
          {overallRunning ? "Running agent…" : "Execution trace"}
        </span>

        {overallRunning && (
          <LoaderIcon className="size-3 shrink-0 animate-spin text-blue-400" />
        )}

        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      {/* Body */}
      {open && (
        <div
          ref={bodyRef}
          className={cn(
            "border-t border-blue-200/50 dark:border-blue-800/40",
            "px-3.5 pt-3 pb-1",
            "max-h-72 overflow-y-auto",
            "scrollbar-thin scrollbar-thumb-border",
          )}
        >
          {groups.map((g) => (
            <PhaseGroup key={g.phase} {...g} />
          ))}
        </div>
      )}
    </div>
  );
}

export const AgentTimeline = memo(AgentTimelineImpl);
AgentTimeline.displayName = "AgentTimeline";
