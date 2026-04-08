import type { OrchestrationRun, OrchestrationRunStatus } from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationProgressHeaderProps {
  run: OrchestrationRun | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

function statusBadge(status: OrchestrationRunStatus) {
  switch (status) {
    case "running":
      return {
        label: "Running",
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
        icon: <Loader2Icon className="size-3 animate-spin" />,
      };
    case "paused":
      return {
        label: "Paused",
        className: "bg-muted text-muted-foreground border-border",
        icon: <PauseIcon className="size-3" />,
      };
    case "completed":
      return {
        label: "Completed",
        className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        icon: <CheckCircle2Icon className="size-3" />,
      };
    case "failed":
      return {
        label: "Failed",
        className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
        icon: <XCircleIcon className="size-3" />,
      };
    case "canceled":
      return {
        label: "Canceled",
        className: "bg-muted text-muted-foreground/60 border-border",
        icon: <XIcon className="size-3" />,
      };
    case "pending":
      return {
        label: "Pending",
        className: "bg-muted text-muted-foreground border-border",
        icon: <Loader2Icon className="size-3 animate-spin" />,
      };
  }
}

// ---------------------------------------------------------------------------
// Segmented progress bar
// ---------------------------------------------------------------------------

function SegmentedProgressBar({
  ticketCount,
  currentIndex,
  status,
}: {
  ticketCount: number;
  currentIndex: number;
  status: OrchestrationRunStatus;
}) {
  if (ticketCount === 0) return null;

  const isTerminal = status === "completed" || status === "failed" || status === "canceled";

  return (
    <div className="flex gap-0.5">
      {Array.from({ length: ticketCount }, (_, i) => {
        const isCompleted = isTerminal ? status === "completed" : i < currentIndex;
        const isCurrent = !isTerminal && i === currentIndex;

        return (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              isCompleted && "bg-emerald-500",
              isCurrent && "bg-amber-500 animate-pulse",
              !isCompleted && !isCurrent && "bg-muted",
            )}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrchestrationProgressHeader({
  run,
  onPause,
  onResume,
  onCancel,
}: OrchestrationProgressHeaderProps) {
  if (!run) return null;

  const badge = statusBadge(run.status);
  const ticketCount = run.ticketOrder.length;
  const currentIndex = run.currentTicketIndex;
  const isTerminal =
    run.status === "completed" || run.status === "failed" || run.status === "canceled";

  const phaseLabel = run.currentPhase === "reviewing" ? "Reviewing" : "Working on";
  const progressLabel = isTerminal
    ? `${ticketCount} ticket${ticketCount !== 1 ? "s" : ""}`
    : `${phaseLabel} ticket ${currentIndex + 1} of ${ticketCount}`;

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-3 sm:px-5 py-2">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {/* Status badge */}
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
            badge.className,
          )}
        >
          {badge.icon}
          {badge.label}
        </span>

        {/* Progress text */}
        <span className="flex-1 text-xs text-muted-foreground/70">{progressLabel}</span>

        {/* Action buttons */}
        {run.status === "running" && (
          <div className="flex items-center gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={onPause}>
              <PauseIcon className="size-3" />
              Pause
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={onCancel}>
              <XIcon className="size-3" />
              Cancel
            </Button>
          </div>
        )}
        {run.status === "paused" && (
          <div className="flex items-center gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={onResume}>
              <PlayIcon className="size-3" />
              Resume
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={onCancel}>
              <XIcon className="size-3" />
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Segmented progress bar */}
      <div className="mx-auto mt-1.5 max-w-3xl">
        <SegmentedProgressBar
          ticketCount={ticketCount}
          currentIndex={currentIndex}
          status={run.status}
        />
      </div>
    </div>
  );
}

export type { OrchestrationProgressHeaderProps };
