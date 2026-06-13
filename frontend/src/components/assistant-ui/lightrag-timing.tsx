"use client";

import { ArrowDownIcon, ArrowUpIcon, GaugeIcon } from "lucide-react";
import type { FC } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LightragTiming } from "@/lib/reasoning-format";

// Modelled on assistant-ui's MessageTiming badge
// (https://www.assistant-ui.com/docs/ui/message-timing): a compact font-mono
// trigger that reveals the full breakdown in a popover. Here it reports the
// estimated input/output tokens and timing of the LightRAG retrieval call rather
// than the whole-message stream timing, since those tokens are LightRAG-specific.

const formatMs = (ms: number | undefined): string => {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTokens = (n: number): string => n.toLocaleString();

const Row: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono tabular-nums">{value}</span>
  </div>
);

export const LightragTimingBadge: FC<{
  timing: LightragTiming;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}> = ({ timing, className, side = "top" }) => {
  // Output tokens per second over the call's wall-clock duration. LightRAG
  // reports no usage, so this mirrors the estimate used for the token counts.
  const tokensPerSecond =
    timing.durationMs > 0
      ? timing.outputTokens / (timing.durationMs / 1000)
      : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="lightrag-timing-trigger"
          aria-label="LightRAG token usage"
          className={cn(
            "flex items-center gap-1.5 rounded-md p-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            className,
          )}
        >
          <GaugeIcon className="size-3 shrink-0" />
          <span className="flex items-center gap-0.5">
            <ArrowUpIcon className="size-3 shrink-0" />
            {formatTokens(timing.inputTokens)}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowDownIcon className="size-3 shrink-0" />
            {formatTokens(timing.outputTokens)}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={8}
        data-slot="lightrag-timing-popover"
        className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md [&_span>svg]:hidden!"
      >
        <div className="grid min-w-44 gap-1.5 text-xs">
          <div className="mb-0.5 font-medium text-foreground">LightRAG retrieval</div>
          <Row label="Input tokens" value={formatTokens(timing.inputTokens)} />
          <Row label="Output tokens" value={formatTokens(timing.outputTokens)} />
          {timing.ttftMs !== undefined && (
            <Row label="First chunk" value={formatMs(timing.ttftMs)} />
          )}
          <Row label="Total" value={formatMs(timing.durationMs)} />
          {tokensPerSecond !== undefined && (
            <Row label="Speed" value={`${tokensPerSecond.toFixed(1)} tok/s`} />
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
