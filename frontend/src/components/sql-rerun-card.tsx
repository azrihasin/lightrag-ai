/**
 * SqlRerunCard — shown for assistant turns loaded from chat history that ran a
 * SQL query. Database rows are never persisted (or sent to the LLM), so the
 * result table and visualization are not restored on refresh. This card surfaces
 * the saved query with a re-run button that re-executes it server-side and
 * rebuilds the table + chart on demand.
 */
import { useMemo, useState, type FC } from "react";
import { Renderer, useJsonRenderMessage, type DataPart } from "@json-render/react";
import { registry } from "@/lib/registry";
import { mastraThreadApi, type RerunResult } from "@/lib/chat-history-api";
import { getResourceId } from "@/lib/resource-id";
import { SqlDataTable } from "@/components/sql-data-table";
import { Loader2, Play } from "lucide-react";

interface SqlRerunCardProps {
  threadId: string;
  messageId: string;
  sql: string;
  columns: string[];
  rowCount: number | null;
}

export const SqlRerunCard: FC<SqlRerunCardProps> = ({
  threadId,
  messageId,
  sql,
  columns,
  rowCount,
}) => {
  const [result, setResult] = useState<RerunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rerun = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mastraThreadApi.rerunMessage(threadId, messageId, getResourceId());
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to re-run the query");
    } finally {
      setLoading(false);
    }
  };

  // Mirror ChatPage's live spec → json-render transform so the re-hydrated
  // visualization renders identically to a fresh stream.
  const jsonRenderParts = useMemo<DataPart[]>(() => {
    if (!result?.spec?.componentType) return [];
    return [
      {
        type: "data-spec",
        data: {
          type: "nested",
          spec: { type: result.spec.componentType, props: result.spec.props },
        },
      },
    ];
  }, [result]);
  const { spec, hasSpec } = useJsonRenderMessage(jsonRenderParts);

  const cols = result?.columns.map((c) => c.name) ?? columns;
  const rows = result?.rows ?? [];
  const displayCount = result?.rowCount ?? rowCount;

  return (
    <div className="mt-3 space-y-3">
      {!result && (
        <>
          <div className="my-4 overflow-hidden rounded-xl bg-[oklch(0.97_0_0)] dark:bg-[oklch(0.16_0_0)]">
            <div className="relative flex items-center gap-1 px-3 py-2">
              <span className="relative z-10 px-2.5 py-1 text-sm font-medium text-foreground">
                Saved Query
                {displayCount != null && (
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {`${displayCount} row${displayCount !== 1 ? "s" : ""} when last run`}
                  </span>
                )}
              </span>

              <button
                type="button"
                aria-label="Re-run query"
                title="Re-run query"
                onClick={rerun}
                disabled={loading}
                className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
            </div>

            <div className="p-4">
              <pre className="overflow-x-auto text-xs leading-relaxed text-foreground">
                <code>{sql}</code>
              </pre>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Results aren't stored. Click the re-run icon to execute this query again and
            rebuild the table and chart.
          </p>
        </>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <SqlDataTable
          columns={cols}
          rows={rows}
          rowCount={displayCount ?? undefined}
          isComplete
          pageSize={5}
          enableSorting
          searchable
          enableColumnToggle
        />
      )}

      {hasSpec && spec && <Renderer spec={spec} registry={registry} />}
    </div>
  );
};
