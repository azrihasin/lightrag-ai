"use client";

import { memo, useMemo, type ReactNode } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useToolOutputStreamStore } from "@/lib/tool-output-stream";
import { useSqlTableStreamStore } from "@/lib/sql-table-stream";
import { useSqlGeneratedStore } from "@/lib/sql-generated-store";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline";

export function AgentToolTimeline({ children }: { children: ReactNode }) {
  return (
    <Timeline defaultValue={999} className="w-full">
      {children}
    </Timeline>
  );
}

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

// ─── Streaming text ───────────────────────────────────────────────────────────

type StatusType = { type: string } | undefined;

function NodeStreamingText({ toolCallId }: { toolCallId?: string }) {
  const partial = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );
  if (!partial) return null;
  return (
    <p className="text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed mt-1">
      {partial}
    </p>
  );
}

// ─── Shared timeline item wrapper ─────────────────────────────────────────────

type AgentToolGroupProps = {
  label: string;
  status: StatusType;
  toolCallId?: string;
  children?: ReactNode;
};

function AgentToolGroup({ label, toolCallId, children }: AgentToolGroupProps) {
  return (
    <TimelineItem step={1}>
      <TimelineHeader>
        <TimelineTitle>{label}</TimelineTitle>
      </TimelineHeader>
      <TimelineIndicator />
      <TimelineSeparator />
      <TimelineContent>
        {children}
        <NodeStreamingText toolCallId={toolCallId} />
      </TimelineContent>
    </TimelineItem>
  );
}

// ─── Retrieve Context — rich streaming display ────────────────────────────────

type LightRagDocument = {
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
};

function RetrieveContextStream({
  status,
  result,
}: {
  status: StatusType;
  result: string | undefined;
}) {
  const isRunning = status?.type === "running";
  const out = parseJson(result);

  if (isRunning || !result) return null;

  const documents = Array.isArray(out.documents)
    ? (out.documents as LightRagDocument[])
    : [];

  const answer = documents.find((d) => d.id === "lightrag-answer");
  const refs = documents.filter((d) => d.id !== "lightrag-answer");

  if (!answer && refs.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {answer && (
        <div className="overflow-hidden rounded-md border border-border bg-muted/40">
          <div className="border-b border-border px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Retrieved Context</span>
          </div>
          <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
            <code>{answer.content}</code>
          </pre>
        </div>
      )}

      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {refs.map((ref, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground",
              )}
            >
              <FileTextIcon className="size-3 shrink-0" />
              <span className="truncate max-w-[200px] font-mono">{ref.source}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
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
  ({ result, status, toolCallId }) => (
    <AgentToolGroup label="Retrieve Context" status={status} toolCallId={toolCallId}>
      <RetrieveContextStream status={status} result={result} />
    </AgentToolGroup>
  ),
);
RetrieveContextUI.displayName = "RetrieveContextUI";

export const PlanNextStepUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Planning Next Step" status={status} toolCallId={toolCallId} />
  ),
);
PlanNextStepUI.displayName = "PlanNextStepUI";

export const ClarificationRequestUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Clarification Request" status={status} toolCallId={toolCallId} />
  ),
);
ClarificationRequestUI.displayName = "ClarificationRequestUI";

export const GenericSearchUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Generic Search" status={status} toolCallId={toolCallId} />
  ),
);
GenericSearchUI.displayName = "GenericSearchUI";

export const CalculatorUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Calculator" status={status} toolCallId={toolCallId} />
  ),
);
CalculatorUI.displayName = "CalculatorUI";

// ─── SQL result table ─────────────────────────────────────────────────────────

function SqlResultTable({
  toolCallId,
  result,
  status,
}: {
  toolCallId: string;
  result?: string;
  status: StatusType;
}) {
  const isRunning = status?.type === "running";
  const tableData = useSqlTableStreamStore((s) => s.tables[toolCallId] ?? null);

  const errorMessage = useMemo<string | null>(() => {
    if (!result || typeof result !== "string") return null;
    try {
      const parsed = JSON.parse(result) as Record<string, unknown>;
      if (parsed.success === false && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch {
      // not an error JSON
    }
    return null;
  }, [result]);

  if (errorMessage) {
    return (
      <div className="mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {errorMessage}
      </div>
    );
  }

  if (!tableData || tableData.columns.length === 0) {
    if (isRunning) {
      return (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
          Running query…
        </div>
      );
    }
    return null;
  }

  const rowCount = tableData.rowCount ?? tableData.rows.length;

  return (
    <div className="mt-2 rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {tableData.columns.map((col) => (
              <TableHead key={col}>{col}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableData.rows.length === 0 && tableData.isComplete ? (
            <TableRow>
              <TableCell
                colSpan={tableData.columns.length}
                className="py-4 text-center text-muted-foreground"
              >
                No rows returned
              </TableCell>
            </TableRow>
          ) : (
            tableData.rows.map((row, i) => (
              <TableRow key={i}>
                {tableData.columns.map((col) => {
                  const cell = row[col];
                  return (
                    <TableCell key={col}>
                      {cell === null || cell === undefined ? (
                        <span className="italic text-muted-foreground">NULL</span>
                      ) : (
                        String(cell)
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
          {isRunning && tableData.rows.length > 0 && (
            <TableRow>
              <TableCell colSpan={tableData.columns.length} className="py-1">
                <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {tableData.isComplete && (
          <TableFooter>
            <TableRow>
              <TableCell
                colSpan={tableData.columns.length}
                className="text-xs text-muted-foreground"
              >
                {rowCount} {rowCount === 1 ? "row" : "rows"}
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

// ─── Phase 2 – SQL / Action ───────────────────────────────────────────────────

function SqlCodeBlock({ toolCallId, status }: { toolCallId: string; status: StatusType }) {
  const entry = useSqlGeneratedStore((s) => s.queries[toolCallId] ?? null);
  const isRunning = status?.type === "running";

  if (!entry) {
    if (isRunning) {
      return (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
          Generating query…
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">SQL</span>
        <span className="text-xs text-muted-foreground/60">{entry.dialect}</span>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-foreground">
        <code>{entry.sql}</code>
      </pre>
    </div>
  );
}

export const GenerateSqlUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Generate SQL" status={status} toolCallId={toolCallId}>
      <SqlCodeBlock toolCallId={toolCallId} status={status} />
    </AgentToolGroup>
  ),
);
GenerateSqlUI.displayName = "GenerateSqlUI";

export const ValidateSqlUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Validate SQL" status={status} toolCallId={toolCallId} />
  ),
);
ValidateSqlUI.displayName = "ValidateSqlUI";

export const ExecuteSqlUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId, result }) => (
    <AgentToolGroup label="Execute SQL" status={status} toolCallId={toolCallId}>
      <SqlResultTable toolCallId={toolCallId} result={result} status={status} />
    </AgentToolGroup>
  ),
);
ExecuteSqlUI.displayName = "ExecuteSqlUI";

export const GenerateActionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Generate Action" status={status} toolCallId={toolCallId} />
  ),
);
GenerateActionUI.displayName = "GenerateActionUI";

export const ValidateActionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Validate Action" status={status} toolCallId={toolCallId} />
  ),
);
ValidateActionUI.displayName = "ValidateActionUI";

export const ExecuteSystemActionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Execute System Action" status={status} toolCallId={toolCallId} />
  ),
);
ExecuteSystemActionUI.displayName = "ExecuteSystemActionUI";

// ─── Phase 3 – Result & Visualization ────────────────────────────────────────

export const InspectResultUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Inspect Result" status={status} toolCallId={toolCallId} />
  ),
);
InspectResultUI.displayName = "InspectResultUI";

export const DecideNextStepUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Deciding Next Step" status={status} toolCallId={toolCallId} />
  ),
);
DecideNextStepUI.displayName = "DecideNextStepUI";

export const PrepareVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Prepare Visualization" status={status} toolCallId={toolCallId} />
  ),
);
PrepareVisualizationUI.displayName = "PrepareVisualizationUI";

export const RenderVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Render Visualization" status={status} toolCallId={toolCallId} />
  ),
);
RenderVisualizationUI.displayName = "RenderVisualizationUI";

// ─── Phase 4 – Review & Response ─────────────────────────────────────────────

export const SummarizeResultUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Summarize Result" status={status} toolCallId={toolCallId} />
  ),
);
SummarizeResultUI.displayName = "SummarizeResultUI";

export const HumanReviewUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Human Review" status={status} toolCallId={toolCallId} />
  ),
);
HumanReviewUI.displayName = "HumanReviewUI";

export const ComposeResponseUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup label="Compose Response" status={status} toolCallId={toolCallId} />
  ),
);
ComposeResponseUI.displayName = "ComposeResponseUI";
