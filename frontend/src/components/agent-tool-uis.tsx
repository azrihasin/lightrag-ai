"use client";

import { memo, useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useToolOutputStreamStore } from "@/lib/tool-output-stream";
import { useSqlTableStreamStore } from "@/lib/sql-table-stream";
import { useSqlGeneratedStore } from "@/lib/sql-generated-store";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { useJmespathStore } from "@/lib/jmespath-store";
import { SqlDataTable } from "@/components/sql-data-table";
import { CodeBlock } from "@/components/assistant-ui/code-block";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought";
import {
  Brain,
  Target,
  Search,
  ListOrdered,
  HelpCircle,
  Calculator,
  Code2,
  ShieldCheck,
  Play,
  Wrench,
  Terminal,
  GitBranch,
  BarChart2,
  Layers,
  ImageIcon,
  FileText,
  Eye,
  PenSquare,
} from "lucide-react";

const PAGE_SIZE = 10;

export function AgentToolTimeline({ children }: { children: ReactNode }) {
  return (
    <ChainOfThought>
      {children}
    </ChainOfThought>
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

function NodeStreamingText({ toolCallId, status }: { toolCallId?: string; status?: StatusType }) {
  const partial = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );
  const isRunning = status?.type === "running";
  if (!partial) return null;
  return (
    <ChainOfThoughtItem>
      <Streamdown isAnimating={isRunning} mode="streaming" className="text-sm">
        {partial}
      </Streamdown>
    </ChainOfThoughtItem>
  );
}

// ─── Shared chain-of-thought step wrapper ─────────────────────────────────────

type AgentToolGroupProps = {
  label: string;
  status: StatusType;
  toolCallId?: string;
  children?: ReactNode;
  hideStreamingText?: boolean;
  icon: ReactNode;
};

function AgentToolGroup({
  label,
  status,
  toolCallId,
  children,
  hideStreamingText,
  icon,
}: AgentToolGroupProps) {
  const isRunning = status?.type === "running";
  const [open, setOpen] = useState(true);
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    if (isRunning && !hasOpenedRef.current) {
      hasOpenedRef.current = true;
      setOpen(true);
    }
  }, [isRunning]);

  return (
    <ChainOfThoughtStep open={open} onOpenChange={setOpen}>
      <ChainOfThoughtTrigger leftIcon={icon}>
        <span className={cn("flex items-center gap-2", isRunning && "shimmer text-foreground/40")}>
          {label}
        </span>
      </ChainOfThoughtTrigger>
      <ChainOfThoughtContent>
        {children}
        {!hideStreamingText && <NodeStreamingText toolCallId={toolCallId} status={status} />}
      </ChainOfThoughtContent>
    </ChainOfThoughtStep>
  );
}

// ─── Retrieve Context — rich streaming display ────────────────────────────────

type RetrievedDocument = {
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
};

function RetrieveContextStream({
  status,
  result,
  toolCallId,
}: {
  status: StatusType;
  result: string | undefined;
  toolCallId?: string;
}) {
  const isRunning = status?.type === "running";
  const streamingText = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );

  if (isRunning) {
    if (!streamingText) return null;
    return (
      <ChainOfThoughtItem>
        <CodeBlock
          label="Retrieving Context"
          code={streamingText}
          meta={<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />}
          bodyClassName="whitespace-pre-wrap"
        />
      </ChainOfThoughtItem>
    );
  }

  if (!result) {
    if (!streamingText) return null;
    return (
      <ChainOfThoughtItem>
        <CodeBlock label="Retrieved Context" code={streamingText} bodyClassName="whitespace-pre-wrap" />
      </ChainOfThoughtItem>
    );
  }

  const out = parseJson(result);

  const documents = Array.isArray(out.documents)
    ? (out.documents as RetrievedDocument[])
    : [];

  const answer = documents.find((d) => d.id === "retrieval-answer");
  const refs = documents.filter((d) => d.id !== "retrieval-answer");

  if (!answer && refs.length === 0) {
    if (!streamingText) return null;
    return (
      <ChainOfThoughtItem>
        <CodeBlock label="Retrieved Context" code={streamingText} bodyClassName="whitespace-pre-wrap" />
      </ChainOfThoughtItem>
    );
  }

  return (
    <>
      {answer && (
        <ChainOfThoughtItem>
          <CodeBlock label="Retrieved Context" code={answer.content} bodyClassName="whitespace-pre-wrap" />
        </ChainOfThoughtItem>
      )}

      {refs.length > 0 && (
        <ChainOfThoughtItem>
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
        </ChainOfThoughtItem>
      )}
    </>
  );
}

// ─── Phase 0 – Intent & Strategy ─────────────────────────────────────────────

export const AnalyzeIntentUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Analyzing Intent"
      status={status}
      toolCallId={toolCallId}
      icon={<Brain className="size-4" />}
    />
  ),
);
AnalyzeIntentUI.displayName = "AnalyzeIntentUI";

export const StrategyDecisionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Planning Strategy"
      status={status}
      toolCallId={toolCallId}
      icon={<Target className="size-4" />}
    />
  ),
);
StrategyDecisionUI.displayName = "StrategyDecisionUI";

// ─── Phase 1 – Context & Clarification ───────────────────────────────────────

export const RetrieveContextUI: ToolCallMessagePartComponent = memo(
  ({ result, status, toolCallId }) => (
    <AgentToolGroup
      label="Retrieve Context"
      status={status}
      toolCallId={toolCallId}
      icon={<Search className="size-4" />}
      hideStreamingText
    >
      <RetrieveContextStream status={status} result={result} toolCallId={toolCallId} />
    </AgentToolGroup>
  ),
);
RetrieveContextUI.displayName = "RetrieveContextUI";

export const PlanNextStepUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Planning Next Step"
      status={status}
      toolCallId={toolCallId}
      icon={<ListOrdered className="size-4" />}
    />
  ),
);
PlanNextStepUI.displayName = "PlanNextStepUI";

export const ClarificationRequestUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Clarification Request"
      status={status}
      toolCallId={toolCallId}
      icon={<HelpCircle className="size-4" />}
    />
  ),
);
ClarificationRequestUI.displayName = "ClarificationRequestUI";

export const GenericSearchUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Generic Search"
      status={status}
      toolCallId={toolCallId}
      icon={<Search className="size-4" />}
    />
  ),
);
GenericSearchUI.displayName = "GenericSearchUI";

export const CalculatorUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Calculator"
      status={status}
      toolCallId={toolCallId}
      icon={<Calculator className="size-4" />}
    />
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
  const liveTableData = useSqlTableStreamStore((s) => s.tables[toolCallId] ?? null);

  // When the live store is empty (e.g. after page refresh) fall back to
  // parsing the persisted result prop from the loaded message history.
  const tableData = useMemo(() => {
    if (liveTableData) return liveTableData;
    if (!result) return null;
    try {
      const parsed = JSON.parse(result) as Record<string, unknown>;
      if (parsed.success === false) return null; // error result — handled below
      if (Array.isArray(parsed.rows)) {
        const rows = parsed.rows as Record<string, unknown>[];
        return {
          columns: (parsed.columns as string[]) ?? Object.keys(rows[0] ?? {}),
          rows,
          rowCount: (parsed.rowCount as number) ?? rows.length,
          isComplete: true,
        };
      }
    } catch {
      // not a SQL result JSON
    }
    return null;
  }, [liveTableData, result]);

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
      <ChainOfThoughtItem>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      </ChainOfThoughtItem>
    );
  }

  if (!tableData || tableData.columns.length === 0) {
    if (isRunning) {
      return (
        <ChainOfThoughtItem>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
            Running query…
          </div>
        </ChainOfThoughtItem>
      );
    }
    return null;
  }

  return (
    <ChainOfThoughtItem>
      <SqlDataTable
        columns={tableData.columns}
        rows={tableData.rows}
        rowCount={tableData.rowCount}
        isComplete={tableData.isComplete}
        isRunning={isRunning}
        pageSize={PAGE_SIZE}
      />
    </ChainOfThoughtItem>
  );
}

// ─── Phase 2 – SQL / Action ───────────────────────────────────────────────────

function SqlCodeBlock({
  toolCallId,
  status,
  result,
}: {
  toolCallId: string;
  status: StatusType;
  result?: string;
}) {
  const liveEntry = useSqlGeneratedStore((s) => s.queries[toolCallId] ?? null);
  const isRunning = status?.type === "running";

  // Fall back to parsing the persisted result prop after a page refresh.
  const entry = useMemo(() => {
    if (liveEntry) return liveEntry;
    if (!result) return null;
    try {
      const parsed = JSON.parse(result) as Record<string, unknown>;
      if (typeof parsed.sql === "string") {
        return { sql: parsed.sql, dialect: (parsed.dialect as string) ?? "sql" };
      }
    } catch {
      // not a generate_sql result
    }
    return null;
  }, [liveEntry, result]);

  if (!entry) {
    if (isRunning) {
      return (
        <ChainOfThoughtItem>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
            Generating query…
          </div>
        </ChainOfThoughtItem>
      );
    }
    return null;
  }

  return (
    <ChainOfThoughtItem>
      <CodeBlock label="SQL" code={entry.sql} meta={entry.dialect} />
    </ChainOfThoughtItem>
  );
}

export const GenerateSqlUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId, result }) => (
    <AgentToolGroup
      label="Generate SQL"
      status={status}
      toolCallId={toolCallId}
      icon={<Code2 className="size-4" />}
    >
      <SqlCodeBlock toolCallId={toolCallId} status={status} result={result} />
    </AgentToolGroup>
  ),
);
GenerateSqlUI.displayName = "GenerateSqlUI";

export const ValidateSqlUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Validate SQL"
      status={status}
      toolCallId={toolCallId}
      icon={<ShieldCheck className="size-4" />}
    />
  ),
);
ValidateSqlUI.displayName = "ValidateSqlUI";

export const ExecuteSqlUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId, result }) => (
    <AgentToolGroup
      label="Execute SQL"
      status={status}
      toolCallId={toolCallId}
      icon={<Play className="size-4" />}
    >
      <SqlResultTable toolCallId={toolCallId} result={result} status={status} />
    </AgentToolGroup>
  ),
);
ExecuteSqlUI.displayName = "ExecuteSqlUI";

export const GenerateActionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Generate Action"
      status={status}
      toolCallId={toolCallId}
      icon={<Wrench className="size-4" />}
    />
  ),
);
GenerateActionUI.displayName = "GenerateActionUI";

export const ValidateActionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Validate Action"
      status={status}
      toolCallId={toolCallId}
      icon={<ShieldCheck className="size-4" />}
    />
  ),
);
ValidateActionUI.displayName = "ValidateActionUI";

export const ExecuteSystemActionUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Execute System Action"
      status={status}
      toolCallId={toolCallId}
      icon={<Terminal className="size-4" />}
    />
  ),
);
ExecuteSystemActionUI.displayName = "ExecuteSystemActionUI";

// ─── Phase 3 – Result & Visualization ────────────────────────────────────────

export const DecideNextStepUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Deciding Next Step"
      status={status}
      toolCallId={toolCallId}
      icon={<GitBranch className="size-4" />}
    />
  ),
);
DecideNextStepUI.displayName = "DecideNextStepUI";

export const PrepareVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Prepare Visualization"
      status={status}
      toolCallId={toolCallId}
      icon={<BarChart2 className="size-4" />}
    />
  ),
);
PrepareVisualizationUI.displayName = "PrepareVisualizationUI";

function JmespathCodeBlock({ toolCallId, result }: { toolCallId?: string; result?: string }) {
  const storeEntry = useJmespathStore(
    (s) => (toolCallId ? (s.entries[toolCallId] ?? null) : null),
  );

  const query = storeEntry
    ? storeEntry.query
    : (() => {
        const parsed = parseJson(result);
        return typeof parsed.jmespathQuery === "string" ? parsed.jmespathQuery : undefined;
      })();

  if (!query) return null;

  return (
    <ChainOfThoughtItem>
      <CodeBlock label="JMESPath Query" code={query} />
    </ChainOfThoughtItem>
  );
}

export const DecideVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId, result }) => (
    <AgentToolGroup
      label="Decide Visualization"
      status={status}
      toolCallId={toolCallId}
      icon={<Layers className="size-4" />}
    >
      <JmespathCodeBlock toolCallId={toolCallId} result={result} />
    </AgentToolGroup>
  ),
);
DecideVisualizationUI.displayName = "DecideVisualizationUI";

function JmespathResultCodeBlock({ result, status }: { result?: string; status: StatusType }) {
  const isRunning = status?.type === "running";

  const dataSpec = useMemo(() => {
    if (!result) return undefined;
    const parsed = parseJson(result);
    return parsed.dataSpec as Record<string, unknown> | undefined;
  }, [result]);

  if (isRunning) {
    return (
      <ChainOfThoughtItem>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
          Building visualization…
        </div>
      </ChainOfThoughtItem>
    );
  }

  if (!dataSpec) return null;

  return (
    <ChainOfThoughtItem>
      <CodeBlock
        label="Render Spec"
        code={JSON.stringify(dataSpec, null, 2)}
        meta={String(dataSpec.componentType ?? "")}
        bodyClassName="max-h-64"
      />
    </ChainOfThoughtItem>
  );
}

export const RenderVisualizationUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId, result }) => (
    <AgentToolGroup
      label="Render Visualization"
      status={status}
      toolCallId={toolCallId}
      icon={<ImageIcon className="size-4" />}
    >
      <JmespathResultCodeBlock result={result} status={status} />
    </AgentToolGroup>
  ),
);
RenderVisualizationUI.displayName = "RenderVisualizationUI";

// ─── Phase 4 – Review & Response ─────────────────────────────────────────────

export const SummarizeResultUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Summarize Result"
      status={status}
      toolCallId={toolCallId}
      icon={<FileText className="size-4" />}
    />
  ),
);
SummarizeResultUI.displayName = "SummarizeResultUI";

export const HumanReviewUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Human Review"
      status={status}
      toolCallId={toolCallId}
      icon={<Eye className="size-4" />}
    />
  ),
);
HumanReviewUI.displayName = "HumanReviewUI";

export const ComposeResponseUI: ToolCallMessagePartComponent = memo(
  ({ status, toolCallId }) => (
    <AgentToolGroup
      label="Compose Response"
      status={status}
      toolCallId={toolCallId}
      icon={<PenSquare className="size-4" />}
    />
  ),
);
ComposeResponseUI.displayName = "ComposeResponseUI";
