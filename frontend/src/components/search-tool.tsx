"use client";

import { memo } from "react";
import { LoaderIcon, SearchIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

interface SearchData {
  results?: number | unknown[];
  relevance?: string;
}

function parseArgs(argsText?: string): { query?: string } {
  try {
    if (argsText) return JSON.parse(argsText);
  } catch { /* ignore */ }
  return {};
}

function parseResult(result: unknown): SearchData | null {
  if (!result) return null;
  const str = typeof result === "string" ? result : JSON.stringify(result);
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === "object" && parsed !== null) return parsed as SearchData;
  } catch { /* ignore */ }
  return null;
}

const SearchToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const isRunning = status?.type === "running";
  const args = parseArgs(argsText);
  const data = parseResult(result);

  const query = args.query ?? "—";
  const resultCount = Array.isArray(data?.results)
    ? data.results.length
    : typeof data?.results === "number"
      ? data.results
      : null;
  const relevance = data?.relevance;

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex size-8 items-center justify-center rounded-full bg-violet-500 shrink-0">
        {isRunning ? (
          <LoaderIcon className="size-4 animate-spin text-white" />
        ) : (
          <SearchIcon className="size-4 text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">Search query</div>
        <div className="text-sm truncate">&ldquo;{query}&rdquo;</div>
      </div>
      {!isRunning && resultCount !== null && (
        <div className="shrink-0 text-sm text-muted-foreground">
          {resultCount} result{resultCount !== 1 ? "s" : ""}
          {relevance ? ` · ${relevance}` : ""}
        </div>
      )}
    </div>
  );
};

export const SearchTool = memo(SearchToolImpl);
SearchTool.displayName = "SearchTool";
