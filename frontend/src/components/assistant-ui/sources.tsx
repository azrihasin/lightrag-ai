"use client";

import type { SourceMessagePartComponent } from "@assistant-ui/react";
import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sources: SourceMessagePartComponent = ({ url, title }) => {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-sm text-muted-foreground",
        "hover:bg-muted/50 hover:text-foreground transition-colors"
      )}
    >
      <ExternalLinkIcon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{title ?? url}</span>
    </a>
  );
};
