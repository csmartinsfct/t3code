import type { OrchestrationRun, OrchestrationRunStatus } from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Group, GroupSeparator } from "../ui/group";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationProgressHeaderProps {
  run: OrchestrationRun | null;
  centerLabel: string | null;
  startupRecoveryState?: "active" | "dismissed" | null;
  onCenterLabelClick?: (() => void) | undefined;
  onPause: () => void;
  onResume: () => void;
  onResumeWithFreshAgent: () => void;
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
  centerLabel,
  startupRecoveryState = null,
  onCenterLabelClick,
  onPause,
  onResume,
  onResumeWithFreshAgent,
  onCancel,
}: OrchestrationProgressHeaderProps) {
  if (!run) return null;

  const badge = statusBadgeProps(run.status);
  const ticketCount = run.ticketOrder.length;
  const currentIndex = run.currentTicketIndex;
  const isTerminal =
    run.status === "completed" || run.status === "failed" || run.status === "canceled";
  const hasStartupRecoveryRun = run.status === "running" && startupRecoveryState !== null;
  const showStartupWasWorking = hasStartupRecoveryRun && startupRecoveryState === "active";
  const showRunningControls = run.status === "running" && !hasStartupRecoveryRun;
  const showResumeControls = run.status === "paused" || hasStartupRecoveryRun;

  const completedCount = isTerminal
    ? run.status === "completed"
      ? ticketCount
      : currentIndex
    : currentIndex;

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-5 py-2">
      <div className="mx-auto grid max-w-3xl grid-cols-[auto_1fr_auto] items-center gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {showStartupWasWorking ? (
            <span className="shrink-0 text-orange-600 text-xs font-medium dark:text-orange-300/90">
              Was working
            </span>
          ) : hasStartupRecoveryRun ? null : (
            <Badge variant={badge.variant} size="sm">
              {badge.icon}
              {badge.label}
            </Badge>
          )}

          {!isTerminal ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {completedCount}/{ticketCount}
            </span>
          ) : null}
        </div>

        <div className="min-w-0 px-2">
          {centerLabel ? (
            onCenterLabelClick ? (
              <button
                type="button"
                className="block w-full truncate text-center text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-4"
                onClick={onCenterLabelClick}
                title={centerLabel}
              >
                {centerLabel}
              </button>
            ) : (
              <span className="block truncate text-center text-xs text-muted-foreground">
                {centerLabel}
              </span>
            )
          ) : null}
        </div>

        <div className="ml-auto flex min-w-0 items-center justify-end gap-2.5">
          {isTerminal ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {completedCount}/{ticketCount}
            </span>
          ) : null}

          {showRunningControls && (
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
          {showResumeControls && (
            <div className="flex items-center gap-1.5">
              <Group aria-label="Orchestration resume actions">
                <Button type="button" size="xs" variant="outline" onClick={onResume}>
                  <PlayIcon className="size-3" />
                  Resume
                </Button>
                <GroupSeparator />
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        aria-label="Resume options"
                        size="icon-xs"
                        type="button"
                        variant="outline"
                      />
                    }
                  >
                    <ChevronDownIcon aria-hidden="true" className="size-4" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem onClick={onResumeWithFreshAgent}>
                      <PlayIcon className="size-3.5" />
                      Resume with fresh agent
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </Group>
              <Button type="button" size="xs" variant="outline" onClick={onCancel}>
                <XIcon className="size-3" />
                Cancel
              </Button>
            </div>
          )}
        </div>
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
