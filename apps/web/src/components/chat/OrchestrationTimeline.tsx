import type { TimestampFormat } from "@t3tools/contracts/settings";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  HourglassIcon,
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
import type {
  MessageRow,
  MilestoneRow,
  WaitingRow,
} from "../../hooks/useOrchestrationTimeline.logic";
import { estimateOrchestrationTimelineRowHeight } from "../../hooks/useOrchestrationTimeline.logic";
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

function resolveMilestoneBadgeVariant(row: MilestoneRow): {
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

const OrchestrationMilestone = memo(function OrchestrationMilestone({
  row,
}: {
  row: MilestoneRow;
}) {
  const { variant, icon } = resolveMilestoneBadgeVariant(row);

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

const OrchestrationMessage = memo(function OrchestrationMessage({
  row,
  markdownCwd,
  onNavigateToThread,
  onOpenTicketLink,
}: {
  row: MessageRow;
  markdownCwd: string | undefined;
  onNavigateToThread: ((threadId: string) => void) | undefined;
  onOpenTicketLink?: (identifier: string) => void | Promise<void>;
}) {
  const sourceVariant =
    row.threadKind === "working" ? "success" : row.threadKind === "review" ? "info" : "outline";

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 px-3 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant={sourceVariant} size="sm">
          {row.threadKind === "working" ? (
            <FileCode2Icon className="size-3" />
          ) : row.threadKind === "review" ? (
            <SearchCheckIcon className="size-3" />
          ) : (
            <BotIcon className="size-3" />
          )}
          {row.sourceLabel}
        </Badge>
        {row.ticketIdentifier && (
          <Badge variant="outline" size="sm">
            {row.ticketIdentifier}
          </Badge>
        )}
        {row.isActiveSource && (
          <Badge variant="outline" size="sm">
            Active
          </Badge>
        )}
        <span className="flex-1" />
        {onNavigateToThread ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onNavigateToThread(row.threadId)}
          >
            Open thread
            <ExternalLinkIcon className="mb-px ml-1 inline size-2.5" />
          </button>
        ) : null}
      </div>

      {row.message.role === "assistant" && row.reviewOutput ? (
        <ReviewOutputCard
          output={row.reviewOutput}
          heading={
            row.reviewIteration ? `Automated review ${row.reviewIteration}` : "Automated review"
          }
        />
      ) : row.message.role === "assistant" ? (
        <div className="min-w-0 px-1 py-0.5">
          <ChatMarkdown
            text={row.message.text || (row.message.streaming ? "" : "(empty response)")}
            cwd={markdownCwd}
            isStreaming={Boolean(row.message.streaming)}
            {...(onOpenTicketLink ? { onOpenTicketLink } : {})}
          />
        </div>
      ) : row.message.role === "system" ? (
        <div className="py-1 text-center">
          <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/40">
            {row.message.text}
          </span>
        </div>
      ) : (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
            <div className="text-sm">{row.message.text}</div>
          </div>
        </div>
      )}
    </div>
  );
});

const OrchestrationWaitingRow = memo(function OrchestrationWaitingRow({
  row,
  onNavigateToThread,
}: {
  row: WaitingRow;
  onNavigateToThread: ((threadId: string) => void) | undefined;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-3 py-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={row.threadKind === "working" ? "success" : "info"} size="sm">
          <HourglassIcon className="size-3" />
          {row.sourceLabel}
        </Badge>
        {row.ticketIdentifier && (
          <Badge variant="outline" size="sm">
            {row.ticketIdentifier}
          </Badge>
        )}
        <span className="flex-1" />
        {onNavigateToThread ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onNavigateToThread(row.threadId)}
          >
            Open thread
            <ExternalLinkIcon className="mb-px ml-1 inline size-2.5" />
          </button>
        ) : null}
      </div>
      <p className="mt-2">{row.text}</p>
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
              {row.kind === "milestone" && <OrchestrationMilestone row={row} />}
              {row.kind === "message" && (
                <OrchestrationMessage
                  row={row}
                  markdownCwd={markdownCwd}
                  onNavigateToThread={onNavigateToThread}
                  {...(onOpenTicketLink ? { onOpenTicketLink } : {})}
                />
              )}
              {row.kind === "waiting" && (
                <OrchestrationWaitingRow row={row} onNavigateToThread={onNavigateToThread} />
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
