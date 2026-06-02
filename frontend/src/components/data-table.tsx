"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Enable client-side sorting on sortable columns. */
  enableSorting?: boolean;
  /** When > 0, paginate client-side with this page size and show Prev/Next controls. */
  pageSize?: number;
  /**
   * Page-size choices for the "Rows per page" dropdown shown alongside the
   * pagination controls. Defaults to `[5, 10, 20, 50]`. Pass `[]` to hide it.
   */
  pageSizeOptions?: number[];
  /**
   * Show a filter input bound to this column id. The placeholder defaults to
   * `Filter <columnId>…` unless {@link filterPlaceholder} is set.
   */
  filterColumn?: string;
  /** Placeholder for the filter input. Defaults to `Filter <filterColumn>…`. */
  filterPlaceholder?: string;
  /**
   * Show a client-side search box that filters rows across ALL columns
   * (case-insensitive substring match). Use this instead of {@link filterColumn}
   * for arbitrary/unknown columns. The placeholder defaults to "Search…".
   */
  searchable?: boolean;
  /** Placeholder for the global search box. Defaults to "Search…". */
  searchPlaceholder?: string;
  /** Show the "Columns" dropdown to toggle column visibility. */
  enableColumnToggle?: boolean;
  /** Message shown when there are no rows. */
  emptyMessage?: string;
  /** Scroll-container className for the table (e.g. "max-h-72"). */
  scrollClassName?: string;
  /** Extra rows rendered after the data rows (e.g. a streaming placeholder). */
  appendRows?: React.ReactNode;
  /** Content rendered at the start (left) of the footer row, e.g. a row count. */
  footerStart?: React.ReactNode;
  /** Force the footer to render even when pagination is disabled. */
  showFooter?: boolean;
  className?: string;
}

/**
 * Reusable data table built on TanStack Table and the shadcn `<Table />`
 * primitives, following https://ui.shadcn.com/docs/components/radix/data-table.
 *
 * This is the canonical table component for the app — every tabular display
 * should route through it so sorting, filtering, column visibility, row
 * selection, pagination, empty states and styling stay consistent. Every
 * feature beyond core rendering is opt-in via props so lightweight surfaces
 * (e.g. a streaming SQL preview) stay minimal.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  enableSorting = false,
  pageSize,
  pageSizeOptions = [5, 10, 20, 50],
  filterColumn,
  filterPlaceholder,
  searchable = false,
  searchPlaceholder,
  enableColumnToggle = false,
  emptyMessage = "No results.",
  scrollClassName,
  appendRows,
  footerStart,
  showFooter,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const paginated = typeof pageSize === "number" && pageSize > 0;
  const filterable = typeof filterColumn === "string" && filterColumn.length > 0;
  // Any feature that needs the filtered row model: per-column filter or search.
  const usesFilterModel = filterable || searchable;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    // Case-insensitive substring match across every column (stringifies values),
    // instead of TanStack's "auto" which varies the matcher by value type.
    globalFilterFn: "includesString",
    // Row models are only wired up for the features that are enabled; the
    // matching state is always controlled but harmlessly inert when off.
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: usesFilterModel ? getFilteredRowModel() : undefined,
    getPaginationRowModel: paginated ? getPaginationRowModel() : undefined,
    initialState: paginated ? { pagination: { pageSize } } : undefined,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
  });

  const hasToolbar = filterable || searchable || enableColumnToggle;
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const hasSelection = selectedCount > 0;
  const hasFooter =
    showFooter || paginated || footerStart != null || hasSelection;

  return (
    <div className={className}>
      {hasToolbar && (
        <div className="flex items-center py-4">
          {searchable && (
            <Input
              placeholder={searchPlaceholder ?? "Search…"}
              value={globalFilter}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              className="max-w-sm"
            />
          )}
          {filterable && (
            <Input
              placeholder={filterPlaceholder ?? `Filter ${filterColumn}…`}
              value={
                (table.getColumn(filterColumn!)?.getFilterValue() as string) ??
                ""
              }
              onChange={(event) =>
                table
                  .getColumn(filterColumn!)
                  ?.setFilterValue(event.target.value)
              }
              className="max-w-sm"
            />
          )}
          {enableColumnToggle && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="ml-auto">
                  Columns <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <div className={cn("overflow-x-auto", scrollClassName)}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
              {appendRows}
            </TableBody>
          </Table>
        </div>
      </div>

      {hasFooter && (
        <div className="flex items-center justify-end space-x-2 py-4">
          <div className="flex-1 text-sm text-muted-foreground">
            {hasSelection
              ? `${selectedCount} of ${table.getFilteredRowModel().rows.length} row(s) selected.`
              : footerStart}
          </div>
          {paginated && (
            <div className="flex items-center gap-4 lg:gap-6">
              {pageSizeOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Rows per page</span>
                  <Select
                    value={`${table.getState().pagination.pageSize}`}
                    onValueChange={(value) => table.setPageSize(Number(value))}
                  >
                    <SelectTrigger size="sm" className="w-[72px]">
                      <SelectValue
                        placeholder={table.getState().pagination.pageSize}
                      />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {pageSizeOptions.map((size) => (
                        <SelectItem key={size} value={`${size}`}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <span className="text-sm font-medium">
                Page {table.getState().pagination.pageIndex + 1} of{" "}
                {table.getPageCount() || 1}
              </span>
              <div className="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
