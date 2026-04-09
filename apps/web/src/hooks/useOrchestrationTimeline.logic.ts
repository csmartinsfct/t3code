import type {
  OrchestrationRun,
  OrchestrationThreadActivity,
  OrchestrationThreadActivityTone,
} from "@t3tools/contracts";
import type { ChatMessage, Thread } from "../types";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface SeparatorRow {
  kind: "separator";
  id: string;
  activityKind: string;
  summary: string;
  tone: OrchestrationThreadActivityTone;
  createdAt: string;
}

export interface TicketGroupRow {
  kind: "ticket-group";
  id: string;
  ticketId: string;
  threadId: string;
  ticketIndex: number;
  totalTickets: number;
  messages: ChatMessage[];
  activities: OrchestrationThreadActivity[];
  isActive: boolean;
  isCompleted: boolean;
}

export interface LoadingRow {
  kind: "loading";
  id: "loading";
}

export interface EmptyRow {
  kind: "empty";
  id: "empty";
}

export type OrchestrationTimelineRow = SeparatorRow | TicketGroupRow | LoadingRow | EmptyRow;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORCHESTRATION_ACTIVITY_PREFIX = "orchestration.run.";

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

function isOrchestrationActivity(activity: OrchestrationThreadActivity): boolean {
  return (
    typeof activity.kind === "string" && activity.kind.startsWith(ORCHESTRATION_ACTIVITY_PREFIX)
  );
}

function ticketIdFromActivity(activity: OrchestrationThreadActivity): string | null {
  const payload = activity.payload as Record<string, unknown> | null | undefined;
  if (payload && typeof payload === "object" && typeof payload.ticketId === "string") {
    return payload.ticketId;
  }
  return null;
}

export function buildOrchestrationTimelineRows(input: {
  parentActivities: ReadonlyArray<OrchestrationThreadActivity>;
  childThreadsByTicketId: ReadonlyMap<string, Thread>;
  run: OrchestrationRun | null;
}): OrchestrationTimelineRow[] {
  const { parentActivities, childThreadsByTicketId, run } = input;

  if (!run) return [];

  const orchestrationActivities = parentActivities
    .filter(isOrchestrationActivity)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

  const totalTickets = run.ticketOrder.length;
  const rows: OrchestrationTimelineRow[] = [];

  // Track which tickets we've already emitted groups for (via activities)
  const emittedTicketIds = new Set<string>();

  for (const activity of orchestrationActivities) {
    const actKind = activity.kind;

    if (actKind === "orchestration.run.ticket.started") {
      const ticketId = ticketIdFromActivity(activity);
      if (!ticketId) continue;
      if (emittedTicketIds.has(ticketId)) {
        continue;
      }

      // Emit the ticket-started separator
      rows.push({
        kind: "separator",
        id: `sep-${activity.id}`,
        activityKind: actKind,
        summary: activity.summary,
        tone: activity.tone,
        createdAt: activity.createdAt,
      });

      // Emit the ticket group
      const childThread = childThreadsByTicketId.get(ticketId);
      const ticketIndex = run.ticketOrder.findIndex((e) => e.ticketId === ticketId);
      const isLastStarted =
        orchestrationActivities.findLast((a) => a.kind === "orchestration.run.ticket.started")
          ?.id === activity.id;
      const hasCompletedActivity = orchestrationActivities.some(
        (a) =>
          a.kind === "orchestration.run.ticket.completed" && ticketIdFromActivity(a) === ticketId,
      );

      rows.push({
        kind: "ticket-group",
        id: `ticket-${ticketId}`,
        ticketId,
        threadId: childThread?.id ?? "",
        ticketIndex: ticketIndex >= 0 ? ticketIndex : 0,
        totalTickets,
        messages: childThread?.messages ?? [],
        activities: childThread?.activities ?? [],
        isActive: isLastStarted && !hasCompletedActivity && run.status === "running",
        isCompleted: hasCompletedActivity,
      });
      emittedTicketIds.add(ticketId);
    } else if (actKind === "orchestration.run.ticket.completed") {
      rows.push({
        kind: "separator",
        id: `sep-${activity.id}`,
        activityKind: actKind,
        summary: activity.summary,
        tone: activity.tone,
        createdAt: activity.createdAt,
      });
    } else {
      // Generic orchestration separator (started, paused, completed, etc.)
      rows.push({
        kind: "separator",
        id: `sep-${activity.id}`,
        activityKind: actKind,
        summary: activity.summary,
        tone: activity.tone,
        createdAt: activity.createdAt,
      });
    }
  }

  // If there are tickets in the plan that haven't been started yet and the
  // run is still active, we don't emit them — they'll appear when started.

  return rows;
}

// ---------------------------------------------------------------------------
// Row height estimation (for virtualizer)
// ---------------------------------------------------------------------------

const SEPARATOR_ROW_HEIGHT = 44;
const TICKET_GROUP_BASE_HEIGHT = 80; // header + padding
const MESSAGE_HEIGHT_ESTIMATE = 120;
const LOADING_ROW_HEIGHT = 200;
const EMPTY_ROW_HEIGHT = 120;

export function estimateOrchestrationTimelineRowHeight(row: OrchestrationTimelineRow): number {
  switch (row.kind) {
    case "separator":
      return SEPARATOR_ROW_HEIGHT;
    case "ticket-group":
      return TICKET_GROUP_BASE_HEIGHT + row.messages.length * MESSAGE_HEIGHT_ESTIMATE;
    case "loading":
      return LOADING_ROW_HEIGHT;
    case "empty":
      return EMPTY_ROW_HEIGHT;
  }
}
