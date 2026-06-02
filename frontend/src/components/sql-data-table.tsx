"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";

import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table";

export type SqlRow = Record<string, unknown>;

/** Leading checkbox column for row selection (select-all in header, per-row body). */
function selectionColumn(): ColumnDef<SqlRow> {
  return {
    id: "__select",
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
  };
}

/**
 * Build TanStack column definitions from a list of SQL column names.
 * Cells render NULL/undefined values as muted italics; everything else renders
 * as plain text using the default shadcn table styling.
 */
export function makeSqlColumns(columns: string[]): ColumnDef<SqlRow>[] {
  return columns.map((col) => ({
    id: col,
    accessorFn: (row) => row[col],
    header: col,
    cell: ({ getValue }) => {
      const value = getValue();
      if (value === null || value === undefined) {
        return <span className="italic text-muted-foreground">NULL</span>;
      }
      return String(value);
    },
  }));
}

export interface SqlDataTableProps {
  columns: string[];
  rows: SqlRow[];
  /** Total rows reported by the backend (may exceed loaded rows while streaming). */
  rowCount?: number | null;
  /** Whether the result set has finished streaming. Defaults to true. */
  isComplete?: boolean;
  /** Whether the query is still executing (shows a streaming placeholder row). */
  isRunning?: boolean;
  /** When set, paginate with this page size instead of scrolling. */
  pageSize?: number;
  /** Page-size choices for the "Rows per page" dropdown. Defaults to [5, 10, 20, 50]. */
  pageSizeOptions?: number[];
  /** Enable client-side sorting on every column. */
  enableSorting?: boolean;
  /** Show a filter input bound to this SQL column. */
  filterColumn?: string;
  /** Show a client-side search box that filters across all columns. */
  searchable?: boolean;
  /** Placeholder for the global search box. Defaults to "Search…". */
  searchPlaceholder?: string;
  /** Show the "Columns" dropdown to toggle column visibility. */
  enableColumnToggle?: boolean;
  /** Add a leading checkbox column for row selection. */
  enableRowSelection?: boolean;
  /** Scroll-container className when not paginating (e.g. "max-h-72"). */
  scrollClassName?: string;
  className?: string;
}

/**
 * Standardized SQL result table. Wraps the canonical {@link DataTable} so every
 * SQL result surface (live stream, agent timeline, history re-run, final answer)
 * shares one consistent, official-shadcn-styled table. All toolbar/selection
 * features are opt-in so the streaming preview stays minimal by default.
 */
export function SqlDataTable({
  columns,
  rows,
  rowCount,
  isComplete = true,
  isRunning = false,
  pageSize,
  pageSizeOptions,
  enableSorting,
  filterColumn,
  searchable,
  searchPlaceholder,
  enableColumnToggle,
  enableRowSelection,
  scrollClassName,
  className,
}: SqlDataTableProps) {
  const cols = React.useMemo(() => {
    const dataCols = makeSqlColumns(columns);
    return enableRowSelection ? [selectionColumn(), ...dataCols] : dataCols;
  }, [columns, enableRowSelection]);

  const loadedCount = rows.length;
  const totalCount = rowCount ?? loadedCount;

  const footerStart = isComplete
    ? `${totalCount} ${totalCount === 1 ? "row" : "rows"}`
    : `${loadedCount} / ${totalCount} rows…`;

  const appendRows =
    isRunning && loadedCount > 0 ? (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={Math.max(1, cols.length)} className="py-1">
          <span className="inline-block h-3 w-1.5 animate-pulse bg-current opacity-50" />
        </TableCell>
      </TableRow>
    ) : null;

  return (
    <DataTable
      columns={cols}
      data={rows}
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      enableSorting={enableSorting}
      filterColumn={filterColumn}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      enableColumnToggle={enableColumnToggle}
      scrollClassName={scrollClassName}
      emptyMessage={isComplete ? "No rows returned" : "Running query…"}
      footerStart={footerStart}
      showFooter
      appendRows={appendRows}
      className={className}
    />
  );
}
