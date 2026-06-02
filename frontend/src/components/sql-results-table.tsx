import { useSqlTableStreamStore } from "@/lib/sql-table-stream";
import { SqlDataTable } from "@/components/sql-data-table";
import { DatabaseIcon } from "lucide-react";

interface SqlResultsTableProps {
  runId: string;
  columns: string[];
  rowCount: number;
  executionMs?: number;
}

export function SqlResultsTable({ runId, columns, rowCount, executionMs }: SqlResultsTableProps) {
  const tableData = useSqlTableStreamStore((s) => s.tables[runId]);

  const cols = tableData?.columns ?? columns;
  const rows = tableData?.rows ?? [];
  const isComplete = tableData?.isComplete ?? false;

  return (
    <div className="mt-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <DatabaseIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium text-muted-foreground">Query Results</span>
        {isComplete && executionMs != null && (
          <span className="text-xs tabular-nums text-muted-foreground">{executionMs}ms</span>
        )}
      </div>

      <SqlDataTable
        columns={cols}
        rows={rows}
        rowCount={rowCount}
        isComplete={isComplete}
        isRunning={!isComplete}
        pageSize={5}
        enableSorting
        enableColumnToggle
        enableRowSelection
        searchable
      />
    </div>
  );
}
