"use client";

import { DatabaseIcon, GaugeIcon, SearchIcon } from "lucide-react";
import type { FC } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RetrievalTiming } from "@/lib/reasoning-format";

// Modelled on assistant-ui's MessageTiming badge
// (https://www.assistant-ui.com/docs/ui/message-timing): a compact font-mono
// trigger that reveals the full breakdown in a popover. Here it reports the hit
// counts and timing of the LanceDB hybrid-retrieval call rather than the
// whole-message stream timing.

const formatMs = (ms: number | undefined): string => {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatCount = (n: number): string => n.toLocaleString();

const Row: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono tabular-nums">{value}</span>
  </div>
);

export const RetrievalTimingBadge: FC<{
  timing: RetrievalTiming;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}> = ({ timing, className, side = "top" }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="retrieval-timing-trigger"
          aria-label="LanceDB retrieval hits"
          className={cn(
            "flex items-center gap-1.5 rounded-md p-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            className,
          )}
        >
          <GaugeIcon className="size-3 shrink-0" />
          <span className="flex items-center gap-0.5">
            <DatabaseIcon className="size-3 shrink-0" />
            {formatCount(timing.vectorHits)}
          </span>
          <span className="flex items-center gap-0.5">
            <SearchIcon className="size-3 shrink-0" />
            {formatCount(timing.ftsHits)}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={8}
        data-slot="retrieval-timing-popover"
        className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md [&_span>svg]:hidden!"
      >
        <div className="grid min-w-44 gap-1.5 text-xs">
          <div className="mb-0.5 font-medium text-foreground">LanceDB hybrid retrieval</div>
          <Row label="Vector hits" value={formatCount(timing.vectorHits)} />
          <Row label="Full-text hits" value={formatCount(timing.ftsHits)} />
          <Row label="Top K" value={formatCount(timing.topK)} />
          <Row label="Total" value={formatMs(timing.durationMs)} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
