import type { TicketHistoryAction, TicketPriority, TicketStatus } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const STATUS_CONFIG: Record<
  TicketStatus,
  {
    label: string;
    dotClass: string;
    badgeVariant:
      | "default"
      | "destructive"
      | "error"
      | "info"
      | "outline"
      | "secondary"
      | "success"
      | "warning";
  }
> = {
  backlog: { label: "Backlog", dotClass: "bg-muted-foreground/50", badgeVariant: "outline" },
  todo: { label: "To Do", dotClass: "bg-blue-500", badgeVariant: "info" },
  in_progress: { label: "In Progress", dotClass: "bg-amber-500", badgeVariant: "warning" },
  blocked: { label: "Blocked", dotClass: "bg-red-500", badgeVariant: "destructive" },
  in_review: { label: "In Review", dotClass: "bg-violet-500", badgeVariant: "secondary" },
  done: { label: "Done", dotClass: "bg-emerald-500", badgeVariant: "success" },
  canceled: { label: "Canceled", dotClass: "bg-muted-foreground/30", badgeVariant: "outline" },
};

export const ALL_STATUSES: TicketStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "canceled",
];

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const PRIORITY_CONFIG: Record<TicketPriority, { label: string; dotClass: string }> = {
  urgent: { label: "Urgent", dotClass: "bg-red-500" },
  high: { label: "High", dotClass: "bg-orange-500" },
  medium: { label: "Medium", dotClass: "bg-yellow-500" },
  low: { label: "Low", dotClass: "bg-blue-400" },
  none: { label: "None", dotClass: "bg-muted-foreground/30" },
};

export const ALL_PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low", "none"];

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (Math.abs(diffMs) < 60_000) return "Just now";
  if (Math.abs(diffMs) < 3_600_000) {
    const mins = Math.round(Math.abs(diffMs) / 60_000);
    return diffMs > 0 ? `${mins}m ago` : `in ${mins}m`;
  }
  if (Math.abs(diffMs) < 86_400_000) {
    const hours = Math.round(Math.abs(diffMs) / 3_600_000);
    return diffMs > 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  const days = Math.round(Math.abs(diffMs) / 86_400_000);
  if (days < 30) return diffMs > 0 ? `${days}d ago` : `in ${days}d`;
  return date.toLocaleDateString();
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const HISTORY_ACTION_LABELS: Record<TicketHistoryAction, string> = {
  created: "Created ticket",
  updated: "Updated ticket",
  status_changed: "Changed status",
  dependency_added: "Added dependency",
  dependency_removed: "Removed dependency",
  label_added: "Added label",
  label_removed: "Removed label",
  comment_added: "Added comment",
  comment_updated: "Updated comment",
  comment_deleted: "Deleted comment",
  artifact_added: "Added artifact",
  artifact_updated: "Updated artifact",
  artifact_deleted: "Deleted artifact",
};

export function historyActionLabel(action: TicketHistoryAction): string {
  return HISTORY_ACTION_LABELS[action] ?? action;
}
