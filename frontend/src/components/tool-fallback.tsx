"use client";

import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { useToolOutputStreamStore } from "@/lib/tool-output-stream";
import { useToolAnnotationStore } from "@/lib/tool-annotation-stream";

function ToolFallbackPreText({
  toolCallId,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  toolCallId?: string;
}) {
  const text = useToolAnnotationStore(
    (s) => (toolCallId ? (s.preText[toolCallId] ?? "") : ""),
  );
  const isComplete = useToolAnnotationStore(
    (s) => (toolCallId ? (s.preComplete[toolCallId] ?? false) : false),
  );

  if (!text) return null;

  return (
    <div
      data-slot="tool-fallback-pre-text"
      className={cn("aui-tool-fallback-pre-text mb-2", className)}
      {...props}
    >
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        {!isComplete && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current opacity-70 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  );
}

function ToolFallbackPostText({
  toolCallId,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  toolCallId?: string;
}) {
  const text = useToolAnnotationStore(
    (s) => (toolCallId ? (s.postText[toolCallId] ?? "") : ""),
  );
  const isComplete = useToolAnnotationStore(
    (s) => (toolCallId ? (s.postComplete[toolCallId] ?? false) : false),
  );

  if (!text) return null;

  return (
    <div
      data-slot="tool-fallback-post-text"
      className={cn(
        "aui-tool-fallback-post-text border-t border-dashed pt-2",
        className,
      )}
      {...props}
    >
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        {!isComplete && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current opacity-70 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  );
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  argsText?: string;
}) {
  if (!argsText) return null;

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn("aui-tool-fallback-args", className)}
      {...props}
    >
      <pre className="aui-tool-fallback-args-value whitespace-pre-wrap">
        {argsText}
      </pre>
    </div>
  );
}

const MAX_COLLAPSED_HEIGHT = 192; // px (~8 lines)

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function deepDecodeHtml(value: unknown): unknown {
  if (typeof value === "string") return decodeHtmlEntities(value);
  if (Array.isArray(value)) return value.map(deepDecodeHtml);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        deepDecodeHtml(v),
      ]),
    );
  return value;
}

function unescapeJsonString(s: string): string {
  return s.replace(/\\(["\\\/bfnrt])/g, (_, char: string) => {
    switch (char) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default:   return `\\${char}`;
    }
  });
}

function prettyFormatJson(value: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") {
    const unescaped = unescapeJsonString(value);
    const display = unescaped.replace(/\\/g, "\\\\").replace(/\r/g, "\\r");
    return `"${display}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = value
      .map((v) => `${pad}  ${prettyFormatJson(v, depth + 1)}`)
      .join(",\n");
    return `[\n${inner}\n${pad}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const inner = entries
      .map(
        ([k, v]) =>
          `${pad}  ${JSON.stringify(k)}: ${prettyFormatJson(v, depth + 1)}`,
      )
      .join(",\n");
    return `{\n${inner}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function prettifyIfJson(s: string): string {
  const trimmed = s.trim();
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    (trimmed.endsWith("}") || trimmed.endsWith("]"))
  ) {
    try {
      const decoded = deepDecodeHtml(JSON.parse(trimmed));
      return "```json\n" + prettyFormatJson(decoded) + "\n```";
    } catch {
      // not valid JSON — return as-is
    }
  }
  return s;
}

function ExpandableCodeBlock({
  children,
  ...props
}: React.ComponentProps<"pre">) {
  const [expanded, setExpanded] = useState(false);
  const [needsExpand, setNeedsExpand] = useState(false);

  const measureRef = useCallback((node: HTMLPreElement | null) => {
    if (node) {
      setNeedsExpand(node.scrollHeight > MAX_COLLAPSED_HEIGHT);
    }
  }, []);

  return (
    <div className="relative my-2">
      <pre
        ref={measureRef}
        {...props}
        style={!expanded && needsExpand ? { maxHeight: MAX_COLLAPSED_HEIGHT } : undefined}
        className="overflow-x-auto overflow-y-hidden rounded-md bg-[#f6f8fa] dark:bg-[#161b22] px-4 py-3 text-xs font-mono leading-relaxed transition-[max-height] duration-300 ease-in-out"
      >
        {children}
      </pre>

      {needsExpand && !expanded && (
        <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center rounded-b-md bg-gradient-to-t from-[#f6f8fa] dark:from-[#161b22] to-transparent pt-8 pb-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            See more
          </button>
        </div>
      )}

      {needsExpand && expanded && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            See less
          </button>
        </div>
      )}
    </div>
  );
}

function ToolFallbackResult({
  result,
  status,
  toolCallId,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  result?: unknown;
  status?: ToolCallMessagePartStatus;
  toolCallId?: string;
}) {
  const partialText = useToolOutputStreamStore(
    (s) => (toolCallId ? (s.partials[toolCallId] ?? "") : ""),
  );
  const isRunning = status?.type === "running";

  const hasPartial = isRunning && partialText.length > 0;
  if (!hasPartial && result === undefined) return null;

  const isString = !hasPartial && typeof result === "string";
  const displayContent = hasPartial
    ? partialText
    : isString
      ? prettifyIfJson(result as string)
      : prettyFormatJson(deepDecodeHtml(result));

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn(
        "aui-tool-fallback-result border-t border-dashed pt-2",
        className,
      )}
      {...props}
    >
      {hasPartial || isString ? (
        <div className="aui-tool-fallback-result-markdown prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children, ...props }) => (
                <ExpandableCodeBlock {...props}>{children}</ExpandableCodeBlock>
              ),
              code: ({ children, className, ...props }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <code {...props} className={className}>
                    {children}
                  </code>
                ) : (
                  <code
                    {...props}
                    className="rounded bg-[#f6f8fa] dark:bg-[#161b22] px-1 py-0.5 text-xs font-mono"
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="aui-tool-fallback-result-content whitespace-pre-wrap text-xs font-mono bg-muted/40 rounded p-2 overflow-x-auto">
          {displayContent}
        </pre>
      )}
    </div>
  );
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  status?: ToolCallMessagePartStatus;
}) {
  if (status?.type !== "incomplete") return null;

  const error = status.error;
  const errorText = error
    ? typeof error === "string"
      ? error
      : JSON.stringify(error)
    : null;

  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";
  const headerText = isCancelled ? "Cancelled reason:" : "Error:";

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn("aui-tool-fallback-error", className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header font-semibold text-muted-foreground">
        {headerText}
      </p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">
        {errorText}
      </p>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent & {
  defaultProps?: { agentName?: string };
} = ({
  toolCallId,
  toolName,
  argsText,
  result,
  status,
  ...rest
}) => {
  const agentName = (rest as { agentName?: string }).agentName;
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";

  void toolName;
  void agentName;

  return (
    <div className="flex flex-col gap-2">
      <ToolFallbackError status={status} />
      <ToolFallbackArgs
        argsText={argsText}
        className={cn(isCancelled && "opacity-60")}
      />
      {!isCancelled && (
        <ToolFallbackResult result={result} status={status} toolCallId={toolCallId} />
      )}
      {!isCancelled && (
        <ToolFallbackPostText toolCallId={toolCallId} />
      )}
    </div>
  );
};

const ToolFallback = memo(
  ToolFallbackImpl,
) as unknown as ToolCallMessagePartComponent & {
  Args: typeof ToolFallbackArgs;
  Result: typeof ToolFallbackResult;
  Error: typeof ToolFallbackError;
};

ToolFallback.displayName = "ToolFallback";
ToolFallback.Args = ToolFallbackArgs;
ToolFallback.Result = ToolFallbackResult;
ToolFallback.Error = ToolFallbackError;

export {
  ToolFallback,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallbackPreText,
};
