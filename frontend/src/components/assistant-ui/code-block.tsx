"use client";

import { type FC, type ReactNode, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copy-to-clipboard button matching the shared code-block header design.
 * Swaps to a check icon for 2s after a successful copy.
 */
export const CopyButton: FC<{ text: string; className?: string }> = ({
  text,
  className,
}) => {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    if (!text || copied) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={onCopy}
      className={cn(
        "ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10",
        className,
      )}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
    </button>
  );
};

/**
 * Shared header bar for every code block in the app — a label on the left and a
 * copy button pushed to the right. `meta` renders a muted hint (e.g. dialect or
 * component type) next to the label.
 */
export const CodeBlockHeader: FC<{
  label: string;
  code: string;
  meta?: ReactNode;
}> = ({ label, code, meta }) => (
  <div className="flex items-center rounded-t-xl bg-[oklch(0.97_0_0)] px-3 py-2 dark:bg-[oklch(0.16_0_0)]">
    <span className="text-sm font-medium">{label}</span>
    {meta != null && meta !== "" && (
      <span className="ml-2 text-xs text-muted-foreground/70">{meta}</span>
    )}
    <CopyButton text={code} />
  </div>
);

/**
 * Full code block: the shared header bar plus a scrollable code body. Pass raw
 * text via `code`, or render a custom body with `children` (the copy button
 * still copies `code`).
 */
export const CodeBlock: FC<{
  label: string;
  code: string;
  meta?: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
}> = ({ label, code, meta, children, bodyClassName }) => (
  <div className="overflow-hidden rounded-xl border border-border">
    <CodeBlockHeader label={label} code={code} meta={meta} />
    {children ?? (
      <pre
        className={cn(
          "overflow-x-auto bg-[oklch(0.97_0_0)] p-3 text-xs leading-relaxed text-foreground dark:bg-[oklch(0.16_0_0)]",
          bodyClassName,
        )}
      >
        <code>{code}</code>
      </pre>
    )}
  </div>
);
