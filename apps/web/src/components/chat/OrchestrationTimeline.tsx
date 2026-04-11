import type { TimestampFormat } from "@t3tools/contracts/settings";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2Icon,
  CircleIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  Loader2Icon,
  PauseCircleIcon,
  PlayCircleIcon,
  SearchCheckIcon,
  UserCircle2Icon,
  XCircleIcon,
} from "lucide-react";
import { memo, useEffect } from "react";

import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "../../chat-scroll";
import { useOrchestrationTimeline } from "../../hooks/useOrchestrationTimeline";
import type { SeparatorRow, ThreadBlockRow } from "../../hooks/useOrchestrationTimeline.logic";
import { estimateOrchestrationTimelineRowHeight } from "../../hooks/useOrchestrationTimeline.logic";
import { parseReviewOutputText } from "../../lib/reviewOutput";
import type { Thread } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import ReviewOutputCard from "./ReviewOutputCard";

interface OrchestrationTimelineProps {
  thread: Thread;
  projectId: string;
  scrollContainer: HTMLDivElement | null;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  onNavigateToThread: ((threadId: string) => void) | undefined;
  onOpenTicketLink?: (identifier: string) => void | Promise<void>;
}

type BadgeVariant = "info" | "success" | "warning" | "error" | "outline";

function resolveSeparatorBadgeVariant(row: SeparatorRow): {
  variant: BadgeVariant;
  icon: React.ReactNode;
} {
  if (row.reviewState === "started") {
    return { variant: "info", icon: <SearchCheckIcon /> };
  }
  if (row.reviewState === "approved") {
    return { variant: "success", icon: <CheckCircle2Icon /> };
  }
  if (row.reviewState === "requested-changes") {
    return { variant: "warning", icon: <PauseCircleIcon /> };
  }
  if (row.reviewState === "blocked") {
    return { variant: "error", icon: <XCircleIcon /> };
  }

  const kind = row.activityKind;
  if (kind.includes("completed") || kind.includes("done")) {
    return { variant: "success", icon: <CheckCircle2Icon /> };
  }
  if (kind.includes("paused")) {
    return { variant: "warning", icon: <PauseCircleIcon /> };
  }
  if (kind.includes("resumed")) {
    return { variant: "info", icon: <PlayCircleIcon /> };
  }
  if (kind.includes("takeover")) {
    return { variant: "warning", icon: <UserCircle2Icon /> };
  }
  if (kind.includes("started")) {
    return { variant: "info", icon: <PlayCircleIcon /> };
  }
  if (kind.includes("canceled") || kind.includes("failed") || row.tone === "error") {
    return { variant: "error", icon: <XCircleIcon /> };
  }

  return { variant: "outline", icon: <CircleIcon /> };
}

const OrchestrationSeparator = memo(function OrchestrationSeparator({
  row,
}: {
  row: SeparatorRow;
}) {
  const { variant, icon } = resolveSeparatorBadgeVariant(row);

  return (
    <div className="my-3 flex items-center justify-center gap-1.5">
      <Badge variant={variant}>
        {icon}
        {row.summary}
      </Badge>
      {row.ticketIdentifier && (
        <Badge variant="outline" size="sm">
          {row.ticketIdentifier}
        </Badge>
      )}
      {row.reviewIteration !== undefined && (
        <Badge variant="outline" size="sm">
          Review {row.reviewIteration}
        </Badge>
      )}
    </div>
  );
});

const TimelineSection = memo(function TimelineSection({
  row,
  markdownCwd,
  onNavigateToThread,
  onOpenTicketLink,
}: {
  row: ThreadBlockRow;
  markdownCwd: string | undefined;
  onNavigateToThread: ((threadId: string) => void) | undefined;
  onOpenTicketLink?: (identifier: string) => void | Promise<void>;
}) {
  const isReview = row.sectionKind === "review";
  const canNavigate = onNavigateToThread !== undefined;
  let reviewCardCount = 0;

  const sectionLabel = isReview
    ? row.reviewOutcome === "approved"
      ? "Review Passed"
      : row.reviewOutcome === "requested-changes"
        ? "Review Failed"
        : row.reviewOutcome === "blocked"
          ? "Review Blocked"
          : "Review"
    : "Implementation";

  return (
    <div>
      {canNavigate ? (
        <button
          type="button"
          className="group/section mb-3 flex w-full items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-accent/50"
          onClick={() => onNavigateToThread(row.threadId)}
        >
          {isReview ? (
            <SearchCheckIcon className="size-3 shrink-0 text-info-foreground" />
          ) : (
            <FileCode2Icon className="size-3 shrink-0 text-success-foreground" />
          )}
          <span className="text-xs text-muted-foreground">{sectionLabel}</span>
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground/0 transition-colors group-hover/section:text-muted-foreground/70">
            Open thread
            <ExternalLinkIcon className="mb-px ml-1 inline size-2.5" />
          </span>
        </button>
      ) : (
        <div className="mb-3 flex items-center gap-2.5 px-1 py-1">
          {isReview ? (
            <SearchCheckIcon className="size-3 shrink-0 text-info-foreground" />
          ) : (
            <FileCode2Icon className="size-3 shrink-0 text-success-foreground" />
          )}
          <span className="text-xs text-muted-foreground">{sectionLabel}</span>
        </div>
      )}

      {row.messages.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground/40">
          {row.emptyStateText ?? (isReview ? "No review messages yet" : "No messages yet")}
        </p>
      ) : (
        <div className="space-y-3">
          {row.messages.map((message) => {
            if (message.role === "assistant") {
              const reviewOutput = isReview ? parseReviewOutputText(message.text) : null;

              if (reviewOutput) {
                reviewCardCount += 1;
                const heading =
                  row.reviewIteration !== undefined && reviewCardCount === 1
                    ? `Automated review ${row.reviewIteration}`
                    : `Automated review ${reviewCardCount}`;

                return (
                  <ReviewOutputCard key={message.id} output={reviewOutput} heading={heading} />
                );
              }

              return (
                <div key={message.id} className="min-w-0 px-1 py-0.5">
                  <ChatMarkdown
                    text={message.text || (message.streaming ? "" : "(empty response)")}
                    cwd={markdownCwd}
                    isStreaming={Boolean(message.streaming)}
                    {...(onOpenTicketLink ? { onOpenTicketLink } : {})}
                  />
                </div>
              );
            }

            if (message.role === "system") {
              return (
                <div key={message.id} className="py-1 text-center">
                  <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/40">
                    {message.text}
                  </span>
                </div>
              );
            }

            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
                  <div className="text-sm">{message.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

function LoadingSkeleton() {
  return (
    <div className="space-y-4 py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border/40" />
            <span className="h-5 w-32 animate-skeleton rounded-full bg-muted" />
            <span className="h-px flex-1 bg-border/40" />
          </div>
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

export function OrchestrationTimeline({
  thread,
  projectId,
  scrollContainer,
  resolvedTheme: _resolvedTheme,
  timestampFormat: _timestampFormat,
  markdownCwd,
  workspaceRoot: _workspaceRoot,
  onNavigateToThread,
  onOpenTicketLink,
}: OrchestrationTimelineProps) {
  const timeline = useOrchestrationTimeline(
    thread.isOrchestrationThread ? thread : null,
    projectId,
  );

  const { timelineRows } = timeline;

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
              {row.kind === "thread-block" && (
                <TimelineSection
                  row={row}
                  markdownCwd={markdownCwd}
                  onNavigateToThread={onNavigateToThread}
                  {...(onOpenTicketLink ? { onOpenTicketLink } : {})}
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
