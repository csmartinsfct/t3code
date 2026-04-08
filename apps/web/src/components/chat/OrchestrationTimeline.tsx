import type { OrchestrationThreadActivityTone } from "@t3tools/contracts";
import { memo, useEffect } from "react";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2Icon,
  CircleIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PauseCircleIcon,
  PlayCircleIcon,
  TicketIcon,
  XCircleIcon,
} from "lucide-react";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "../../chat-scroll";
import { useOrchestrationTimeline } from "../../hooks/useOrchestrationTimeline";
import type { SeparatorRow, TicketGroupRow } from "../../hooks/useOrchestrationTimeline.logic";
import { estimateOrchestrationTimelineRowHeight } from "../../hooks/useOrchestrationTimeline.logic";
import type { Thread } from "../../types";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import type { TimestampFormat } from "@t3tools/contracts/settings";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationTimelineProps {
  thread: Thread;
  projectId: string;
  scrollContainer: HTMLDivElement | null;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  onNavigateToThread: ((threadId: string) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Separator icon lookup
// ---------------------------------------------------------------------------

function separatorIcon(activityKind: string, tone: OrchestrationThreadActivityTone) {
  if (activityKind.includes("completed") || activityKind.includes("done")) {
    return <CheckCircle2Icon className="size-3 text-emerald-500" />;
  }
  if (activityKind.includes("paused")) {
    return <PauseCircleIcon className="size-3 text-amber-500" />;
  }
  if (activityKind.includes("started")) {
    return <PlayCircleIcon className="size-3 text-blue-500" />;
  }
  if (activityKind.includes("canceled") || activityKind.includes("failed") || tone === "error") {
    return <XCircleIcon className="size-3 text-red-500" />;
  }
  return <CircleIcon className="size-3 text-muted-foreground/50" />;
}

function toneColor(tone: OrchestrationThreadActivityTone): string {
  switch (tone) {
    case "error":
      return "text-destructive-foreground";
    case "approval":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground/80";
  }
}

// ---------------------------------------------------------------------------
// SeparatorRow component
// ---------------------------------------------------------------------------

const OrchestrationSeparator = memo(function OrchestrationSeparator({
  row,
}: {
  row: SeparatorRow;
}) {
  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]",
          toneColor(row.tone),
        )}
      >
        {separatorIcon(row.activityKind, row.tone)}
        {row.summary}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// TicketGroupRow component
// ---------------------------------------------------------------------------

const OrchestrationTicketGroup = memo(function OrchestrationTicketGroup({
  row,
  markdownCwd,
  resolvedTheme: _resolvedTheme,
  onNavigateToThread,
}: {
  row: TicketGroupRow;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  onNavigateToThread: ((threadId: string) => void) | undefined;
}) {
  const statusDot = row.isCompleted
    ? "bg-emerald-500"
    : row.isActive
      ? "bg-amber-500 animate-pulse"
      : "bg-muted-foreground/30";

  const statusLabel = row.isCompleted ? "Completed" : row.isActive ? "Working" : "Pending";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/25 px-3 py-2.5",
        row.isActive ? "border-primary/20 bg-primary/[0.02]" : "border-border/45",
      )}
    >
      {/* Ticket header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TicketIcon className="size-3.5 text-muted-foreground/50" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Ticket {row.ticketIndex + 1} of {row.totalTickets}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", statusDot)} />
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/55">
              {statusLabel}
            </span>
          </div>
        </div>
        {row.threadId && onNavigateToThread && (
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground/70"
            onClick={() => onNavigateToThread(row.threadId)}
          >
            View thread
            <ExternalLinkIcon className="size-2.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      {row.messages.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground/40">
          {row.isActive ? "Waiting for agent response..." : "No messages yet"}
        </p>
      ) : (
        <div className="space-y-3">
          {row.messages.map((message) => (
            <div key={message.id} data-message-id={message.id}>
              {message.role === "user" && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
                    <div className="text-sm">{message.text}</div>
                  </div>
                </div>
              )}
              {message.role === "assistant" && (
                <div className="min-w-0 px-1 py-0.5">
                  <ChatMarkdown
                    text={message.text || (message.streaming ? "" : "(empty response)")}
                    cwd={markdownCwd}
                    isStreaming={Boolean(message.streaming)}
                  />
                </div>
              )}
              {message.role === "system" && (
                <div className="flex items-center gap-3 py-1">
                  <span className="h-px flex-1 bg-border/50" />
                  <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/40">
                    {message.text}
                  </span>
                  <span className="h-px flex-1 bg-border/50" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-4 py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          {/* Separator skeleton */}
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border/40" />
            <span className="h-5 w-32 animate-skeleton rounded-full bg-muted" />
            <span className="h-px flex-1 bg-border/40" />
          </div>
          {/* Card skeleton */}
          <div className="rounded-xl border border-border/30 bg-card/15 px-3 py-3">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-3 w-3 animate-skeleton rounded bg-muted" />
              <span className="h-3 w-24 animate-skeleton rounded bg-muted" />
            </div>
            <div className="space-y-2">
              <span className="block h-4 w-3/4 animate-skeleton rounded bg-muted" />
              <span className="block h-4 w-1/2 animate-skeleton rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Loader2Icon className="mb-3 size-5 animate-spin text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground/50">No orchestration activity yet</p>
      <p className="mt-1 text-xs text-muted-foreground/30">
        Activity will appear here as tickets are processed
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OrchestrationTimeline({
  thread,
  projectId,
  scrollContainer,
  resolvedTheme,
  timestampFormat: _timestampFormat,
  markdownCwd,
  workspaceRoot: _workspaceRoot,
  onNavigateToThread,
}: OrchestrationTimelineProps) {
  const timeline = useOrchestrationTimeline(
    thread.isOrchestrationThread ? thread : null,
    projectId,
  );

  const { timelineRows } = timeline;

  // ── Virtualizer ─────────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count: timelineRows.length,
    getScrollElement: () => scrollContainer,
    getItemKey: (index: number) => timelineRows[index]?.id ?? String(index),
    estimateSize: (index: number) => {
      const row = timelineRows[index];
      if (!row) return 96;
      return estimateOrchestrationTimelineRowHeight(row);
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 4,
  });

  // Adjust scroll position sanely
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const itemIntersectsViewport =
        item.end > scrollOffset && item.start < scrollOffset + viewportHeight;
      if (itemIntersectsViewport) return false;
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualRow) => {
          const row = timelineRows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full pb-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.kind === "separator" && <OrchestrationSeparator row={row} />}
              {row.kind === "ticket-group" && (
                <OrchestrationTicketGroup
                  row={row}
                  markdownCwd={markdownCwd}
                  resolvedTheme={resolvedTheme}
                  onNavigateToThread={onNavigateToThread}
                />
              )}
              {row.kind === "loading" && <LoadingSkeleton />}
              {row.kind === "empty" && <EmptyState />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { OrchestrationTimelineProps };
