"use client";

import { memo } from "react";
import { CalculatorIcon, LoaderIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

function parseArgs(
  argsText?: string,
): { expression?: string; a?: number; b?: number } {
  try {
    if (argsText) return JSON.parse(argsText);
  } catch {
    /* ignore */
  }
  return {};
}

const CalculatorToolImpl: ToolCallMessagePartComponent = ({
  argsText,
  result,
  status,
}) => {
  const isRunning = status?.type === "running";
  const args = parseArgs(argsText);
  const expression =
    args.expression ??
    (args.a !== undefined && args.b !== undefined
      ? `${args.a} × ${args.b}`
      : "—");
  const resultText =
    typeof result === "string"
      ? result
      : result !== undefined
        ? String(result)
        : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
        {isRunning ? (
          <LoaderIcon className="size-4 animate-spin" />
        ) : (
          <CalculatorIcon className="size-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">Calculate</div>
        <div className="text-sm font-medium font-mono truncate">{expression}</div>
      </div>
      {!isRunning && resultText && (
        <div className="shrink-0 text-right text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
          {resultText}
        </div>
      )}
    </div>
  );
};

export const CalculatorTool = memo(CalculatorToolImpl);
CalculatorTool.displayName = "CalculatorTool";
