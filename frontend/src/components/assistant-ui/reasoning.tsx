"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
} from "react";
import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { useScrollLock } from "@assistant-ui/react";
import type {
  ReasoningGroupComponent,
  ReasoningMessagePartComponent,
} from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

const reasoningVariants = cva(
  "aui-reasoning-root group/reasoning-root w-full",
  {
    variants: {
      variant: {
        outline: "rounded-lg border py-3",
        ghost: "",
        muted: "rounded-lg border border-muted-foreground/30 bg-muted/30 py-3",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) lockScroll();
      if (!isControlled) setUncontrolledOpen(open);
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="reasoning-root"
      data-variant={variant ?? "outline"}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        reasoningVariants({ variant }),
        "group/reasoning-root",
        className,
      )}
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  );
}

function ReasoningTrigger({
  active = false,
  label,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean;
  label?: string;
}) {
  const triggerLabel = label ?? (active ? "Thinking..." : "Reasoned");

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      className={cn(
        "aui-reasoning-trigger group/trigger flex items-center gap-2 text-sm transition-colors",
        "group-data-[variant=outline]/reasoning-root:w-full group-data-[variant=outline]/reasoning-root:px-4",
        "group-data-[variant=muted]/reasoning-root:w-full group-data-[variant=muted]/reasoning-root:px-4",
        className,
      )}
      {...props}
    >
      {active && (
        <LoaderIcon
          data-slot="reasoning-trigger-loader"
          className="aui-reasoning-trigger-loader size-4 shrink-0 animate-spin"
        />
      )}
      <span
        data-slot="reasoning-trigger-label"
        className={cn(
          "aui-reasoning-trigger-label relative inline-block text-left font-medium leading-none",
          "group-data-[variant=outline]/reasoning-root:grow",
          "group-data-[variant=muted]/reasoning-root:grow",
        )}
      >
        <span>{triggerLabel}</span>
        {active && (
          <span
            aria-hidden
            data-slot="reasoning-trigger-shimmer"
            className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            {triggerLabel}
          </span>
        )}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className={cn(
          "aui-reasoning-trigger-chevron size-4 shrink-0",
          "transition-transform duration-(--animation-duration) ease-out",
          "group-data-[state=closed]/trigger:-rotate-90",
          "group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        "aui-reasoning-content relative overflow-hidden text-sm outline-none ease-out",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        "data-[state=closed]:fill-mode-forwards",
        "data-[state=closed]:pointer-events-none",
        "data-[state=open]:duration-(--animation-duration)",
        "data-[state=closed]:duration-(--animation-duration)",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "mt-2 flex flex-col gap-2",
          "group-data-[variant=outline]/reasoning-root:mt-3 group-data-[variant=outline]/reasoning-root:border-t group-data-[variant=outline]/reasoning-root:px-4 group-data-[variant=outline]/reasoning-root:pt-3",
          "group-data-[variant=muted]/reasoning-root:mt-3 group-data-[variant=muted]/reasoning-root:border-t group-data-[variant=muted]/reasoning-root:px-4 group-data-[variant=muted]/reasoning-root:pt-3",
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

function ReasoningText({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & { children?: string }) {
  return (
    <div
      data-slot="reasoning-text"
      className={cn(
        "aui-reasoning-text prose prose-sm dark:prose-invert max-w-none text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function ReasoningFade({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="reasoning-fade"
      className={cn(
        "aui-reasoning-fade pointer-events-none absolute bottom-0 left-0 right-0 h-12",
        "bg-gradient-to-t from-background to-transparent",
        "group-data-[variant=muted]/reasoning-root:from-muted/30",
        className,
      )}
      {...props}
    />
  );
}

// Single reasoning part
const ReasoningImpl: ReasoningMessagePartComponent = ({ text }) => {
  return (
    <ReasoningRoot defaultOpen>
      <ReasoningTrigger />
      <ReasoningContent>
        <ReasoningText>{text}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

// Groups consecutive reasoning parts
const ReasoningGroupImpl: ReasoningGroupComponent = ({ children }) => {
  return (
    <ReasoningRoot defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{children}</ReasoningContent>
    </ReasoningRoot>
  );
};

type ReasoningComponent = ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;
  Trigger: typeof ReasoningTrigger;
  Content: typeof ReasoningContent;
  Text: typeof ReasoningText;
  Fade: typeof ReasoningFade;
};

const Reasoning = memo(ReasoningImpl) as unknown as ReasoningComponent;
Reasoning.displayName = "Reasoning";
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;
Reasoning.Fade = ReasoningFade;

const ReasoningGroup = memo(
  ReasoningGroupImpl,
) as unknown as ReasoningGroupComponent & FC<PropsWithChildren>;
ReasoningGroup.displayName = "ReasoningGroup";

export {
  Reasoning,
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  ReasoningGroup,
};
