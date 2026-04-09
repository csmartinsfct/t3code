import type { OrchestrationRun, OrchestrationRunStatus } from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationProgressHeaderProps {
  run: OrchestrationRun | null;
  /** Current ticket label, e.g. "ORCH-7 — Rename sidebar label" */
  currentTicketLabel: string | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Status badge variant
// ---------------------------------------------------------------------------

type BadgeVariant = "info" | "success" | "warning" | "error" | "outline";

function statusBadgeProps(status: OrchestrationRunStatus): {
  label: string;
  variant: BadgeVariant;
  icon: React.ReactNode;
} {
  switch (status) {
    case "running":
      return {
        label: "Running",
        variant: "warning",
        icon: <Loader2Icon className="animate-spin" />,
      };
    case "paused":
      return { label: "Paused", variant: "outline", icon: <PauseIcon /> };
    case "completed":
      return { label: "Completed", variant: "success", icon: <CheckCircle2Icon /> };
    case "failed":
      return { label: "Failed", variant: "error", icon: <XCircleIcon /> };
    case "canceled":
      return { label: "Canceled", variant: "outline", icon: <XIcon /> };
    case "pending":
      return {
        label: "Pending",
        variant: "outline",
        icon: <Loader2Icon className="animate-spin" />,
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
    <div className="flex gap-0.5 opacity-50">
      {Array.from({ length: ticketCount }, (_, i) => {
        const isCompleted = isTerminal ? status === "completed" : i < currentIndex;
        const isCurrent = !isTerminal && i === currentIndex;

        return (
          <div
            key={i}
            className={cn(
              "h-0.5 flex-1 rounded-full transition-colors duration-300",
              isCompleted && "bg-emerald-500",
              isCurrent && "bg-amber-500",
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
  currentTicketLabel,
  onPause,
  onResume,
  onCancel,
}: OrchestrationProgressHeaderProps) {
  if (!run) return null;

  const badge = statusBadgeProps(run.status);
  const ticketCount = run.ticketOrder.length;
  const currentIndex = run.currentTicketIndex;
  const isTerminal =
    run.status === "completed" || run.status === "failed" || run.status === "canceled";

  const completedCount = isTerminal
    ? run.status === "completed"
      ? ticketCount
      : currentIndex
    : currentIndex;

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-5 py-2">
      <div className="mx-auto flex max-w-3xl items-center gap-2.5">
        {/* Status badge */}
        <Badge variant={badge.variant} size="sm">
          {badge.icon}
          {badge.label}
        </Badge>

        {/* Current ticket — truncates or hides when space is tight */}
        {currentTicketLabel && !isTerminal && (
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
            {currentTicketLabel}
          </span>
        )}

        <span className="flex-1" />

        {/* Ticket progress counter */}
        <span className="shrink-0 text-xs text-muted-foreground">
          {completedCount}/{ticketCount}
        </span>

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
