"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartStatus } from "@assistant-ui/react";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/assistant-ui/reasoning";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import { useSqlTableStreamStore } from "@/lib/sql-table-stream";

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Module-level store
//
// Associates each execute_sql_agent_tool render with the most-recent
// create_sql_agent_tool that has not yet been matched.  Uses registration
// order — the query-maker always registers its ID before the execution tool
// renders (they appear in DOM order in the same message).
// ---------------------------------------------------------------------------

export type ExecutionSnapshot = {
  toolCallId: string;
  toolName: string;
  argsText: string;
  result: unknown;
  status: ToolCallMessagePartStatus;
};

const _queryMakerOrder: string[] = [];
const _executionByMaker = new Map<string, ExecutionSnapshot>();
const _storeListeners = new Set<() => void>();

function _notifyStore() {
  _storeListeners.forEach((fn) => fn());
}

/** Called by SqlQueryMakerTool on mount. */
export function registerQueryMaker(id: string) {
  if (!_queryMakerOrder.includes(id)) {
    _queryMakerOrder.push(id);
  }
}

/**
 * Called by SqlExecutionRegistrar on every render.
 * Associates the snapshot with the most-recent unmatched query-maker.
 */
export function registerExecution(snap: ExecutionSnapshot) {
  for (let i = _queryMakerOrder.length - 1; i >= 0; i--) {
    const makerId = _queryMakerOrder[i];
    if (!_executionByMaker.has(makerId)) {
      _executionByMaker.set(makerId, snap);
      _notifyStore();
      return;
    }
  }
  // All matched — update the most-recent maker (handles result/status updates)
  if (_queryMakerOrder.length > 0) {
    const lastId = _queryMakerOrder[_queryMakerOrder.length - 1];
    _executionByMaker.set(lastId, snap);
    _notifyStore();
  }
}

function getExecutionFor(queryMakerId: string): ExecutionSnapshot | undefined {
  return _executionByMaker.get(queryMakerId);
}

function subscribeStore(fn: () => void): () => void {
  _storeListeners.add(fn);
  return () => {
    _storeListeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Inner execution block — rendered nested inside SqlQueryMakerTool.
//
// Subscribes to useSqlTableStreamStore for live row-by-row streaming.
// The backend emits sql-table-start / sql-table-row / sql-table-end events
// which streaming-fetch.ts routes to the store.  Each arriving row causes a
// new <TableRow> to appear instantly in the shadcn Table.
// Errors (snap.result JSON with success:false) are shown as an error banner.
// ---------------------------------------------------------------------------
function SqlExecutionBlock({ snap }: { snap: ExecutionSnapshot }) {
  const isRunning = snap.status?.type === "running";
  const [page, setPage] = useState(0);

  // Live table data accumulating from structured sql-table-* events.
  const tableData = useSqlTableStreamStore(
    (s) => s.tables[snap.toolCallId] ?? null,
  );

  // Reset to first page whenever the result set changes identity.
  useEffect(() => {
    setPage(0);
  }, [snap.toolCallId]);

  // Detect error from the final JSON result (success: false case).
  const errorMessage = useMemo<string | null>(() => {
    if (!snap.result || typeof snap.result !== "string") return null;
    try {
      const parsed = JSON.parse(snap.result) as Record<string, unknown>;
      if (parsed.success === false && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch {
      // Not an error JSON — ignore.
    }
    return null;
  }, [snap.result]);

  const hasTableData = tableData !== null && tableData.columns.length > 0;

  const totalRows = tableData?.rows.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = tableData?.rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE) ?? [];
  const showPagination = totalRows > PAGE_SIZE;

  return (
    <div className="mt-2 border-t border-dashed pt-2">
      <ReasoningRoot variant="ghost" defaultOpen={true}>
        <ReasoningTrigger active={isRunning} label="SQL Execution" />
        <ReasoningContent>
          {errorMessage ? (
            <div className="text-destructive mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {errorMessage}
            </div>
          ) : hasTableData ? (
            <div className="mt-2 rounded-md border overflow-x-auto">
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
                        className="text-muted-foreground text-center py-4"
                      >
                        No rows returned
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedRows.map((row, i) => (
                      <TableRow key={safePage * PAGE_SIZE + i}>
                        {tableData.columns.map((col) => {
                          const cell = row[col];
                          return (
                            <TableCell key={col}>
                              {cell === null || cell === undefined ? (
                                <span className="text-muted-foreground italic">NULL</span>
                              ) : (
                                String(cell)
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
                  {/* Placeholder row while more rows are streaming in */}
                  {isRunning && tableData.rows.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={tableData.columns.length} className="py-1">
                        <span className="inline-block w-1.5 h-3 bg-current opacity-50 animate-pulse" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t px-3 py-1.5">
                <span className="text-muted-foreground text-xs">
                  {tableData.isComplete
                    ? `${tableData.rowCount ?? totalRows} row${(tableData.rowCount ?? totalRows) !== 1 ? "s" : ""}`
                    : `${totalRows} row${totalRows !== 1 ? "s" : ""} so far…`}
                </span>
                {showPagination && (
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs">
                      Page {safePage + 1} of {totalPages}
                    </span>
                    <Pagination className="w-auto mx-0">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            aria-disabled={safePage === 0}
                            className={safePage === 0 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                          />
                        </PaginationItem>
                        <PaginationItem>
                          <PaginationNext
                            aria-disabled={safePage >= totalPages - 1}
                            className={safePage >= totalPages - 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </div>
            </div>
          ) : !isRunning && snap.result ? (
            <ToolFallback
              toolCallId={snap.toolCallId}
              toolName={snap.toolName}
              argsText={snap.argsText}
              result={snap.result}
              status={snap.status}
            />
          ) : null}
        </ReasoningContent>
      </ReasoningRoot>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SQL Query Maker tool — open by default, execution nested inside.
// ---------------------------------------------------------------------------
const SqlQueryMakerToolImpl: ToolCallMessagePartComponent = (props) => {
  const isRunning = props.status?.type === "running";

  useEffect(() => {
    registerQueryMaker(props.toolCallId);
  }, [props.toolCallId]);

  const executionSnap = useSyncExternalStore(
    subscribeStore,
    () => getExecutionFor(props.toolCallId),
  );

  return (
    <ReasoningRoot variant="ghost" defaultOpen={true} className="m-2">
      <ReasoningTrigger active={isRunning} label="SQL Query Maker" />
      <ReasoningContent>
        <ToolFallback {...props} />
        {executionSnap && <SqlExecutionBlock snap={executionSnap} />}
      </ReasoningContent>
    </ReasoningRoot>
  );
};

export const SqlQueryMakerTool = memo(
  SqlQueryMakerToolImpl,
) as ToolCallMessagePartComponent;
SqlQueryMakerTool.displayName = "SqlQueryMakerTool";

// ---------------------------------------------------------------------------
// Execution registrar — lives inside the Fallback (NOT in by_name).
//
// Returning null from a by_name component causes assistant-ui to fall through
// to Fallback anyway, so we keep this out of by_name entirely and route it
// from Fallback explicitly.  Returns an empty fragment (a valid React element
// that produces no DOM) so Fallback does not show a visible tool block.
// ---------------------------------------------------------------------------
const SqlExecutionRegistrarImpl: ToolCallMessagePartComponent = (props) => {
  // Run on every render so status and result updates propagate to the store.
  useEffect(() => {
    registerExecution({
      toolCallId: props.toolCallId,
      toolName:   props.toolName,
      argsText:   props.argsText,
      result:     props.result,
      status:     props.status,
    });
  });

  // Empty fragment — renders nothing visible but IS a valid React element,
  // so Fallback treats it as "handled" and does not render ToolFallbackWithAgent.
  return <></>;
};

export const SqlExecutionRegistrar = memo(
  SqlExecutionRegistrarImpl,
) as ToolCallMessagePartComponent;
SqlExecutionRegistrar.displayName = "SqlExecutionRegistrar";
