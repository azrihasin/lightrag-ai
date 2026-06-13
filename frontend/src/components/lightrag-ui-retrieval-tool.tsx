"use client";

import { memo } from "react";
import { ComponentIcon, ExternalLinkIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import {
  ToolFallbackError,
  ToolFallbackPostText,
} from "@/components/assistant-ui/tool-fallback";

interface KgSource {
  reference_id?: string;
  file_path: string;
}

function parseSources(result: unknown): KgSource[] {
  if (!result) return [];
  const text = typeof result === "string" ? result : JSON.stringify(result);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.sources)) {
      return parsed.sources.filter(
        (s: unknown): s is KgSource =>
          s !== null &&
          typeof s === "object" &&
          typeof (s as KgSource).file_path === "string",
      );
    }
  } catch {
    /* not JSON */
  }
  return [];
}

function sourceLabel(filePath: string): string {
  // Show just the filename without leading path separators
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

const LightragUiRetrievalToolImpl: ToolCallMessagePartComponent = ({
  toolCallId,
  result,
  status,
}) => {
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";
  const sources = parseSources(result);

  return (
    <div className="flex flex-col gap-2">
      <ToolFallbackError status={status} />

      {/* LLM explanation: 2-3 sentences why this component was chosen */}
      {!isCancelled && (
        <ToolFallbackPostText toolCallId={toolCallId} />
      )}

      {/* Sources cited by LightRAG */}
      {!isCancelled && sources.length > 0 && (
        <div className="border-t border-dashed pt-2 flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Sources
          </p>
          <div className="flex flex-wrap gap-2">
            {sources.map((src) => (
              <div
                key={src.reference_id ?? src.file_path}
                title={src.file_path}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border/50",
                  "bg-muted/30 px-2.5 py-1.5 text-sm text-muted-foreground",
                  "hover:bg-muted/50 hover:text-foreground transition-colors",
                )}
              >
                <ComponentIcon className="size-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
                <span className="truncate max-w-[220px]">
                  {sourceLabel(src.file_path)}
                </span>
                {src.reference_id && (
                  <ExternalLinkIcon className="size-3 shrink-0 opacity-50" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const LightragUiRetrievalTool = memo(LightragUiRetrievalToolImpl);
LightragUiRetrievalTool.displayName = "LightragUiRetrievalTool";
