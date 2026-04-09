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
  ticketIdentifier?: string | undefined;
  reviewIteration?: number | undefined;
  reviewState?: "started" | "approved" | "requested-changes" | "blocked" | undefined;
}

export interface TicketThreadSection {
  id: string;
  kind: "working" | "review";
  threadId: string;
  title: string;
  messages: ChatMessage[];
  isActive: boolean;
  isStarted: boolean;
}

export interface TicketGroupRow {
  kind: "ticket-group";
  id: string;
  ticketId: string;
  ticketIndex: number;
  totalTickets: number;
  sections: TicketThreadSection[];
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

function ticketIdentifierFromActivity(activity: OrchestrationThreadActivity): string | null {
  const payload = activity.payload as Record<string, unknown> | null | undefined;
  if (payload && typeof payload === "object" && typeof payload.ticketIdentifier === "string") {
    return payload.ticketIdentifier;
  }
  return null;
}

function reviewIterationFromActivity(activity: OrchestrationThreadActivity): number | null {
  const payload = activity.payload as Record<string, unknown> | null | undefined;
  if (
    payload &&
    typeof payload === "object" &&
    typeof payload.reviewIteration === "number" &&
    Number.isInteger(payload.reviewIteration)
  ) {
    return payload.reviewIteration;
  }
  return null;
}

function reviewStateFromActivity(activityKind: string): SeparatorRow["reviewState"] | undefined {
  switch (activityKind) {
    case "orchestration.run.ticket.review.started":
      return "started";
    case "orchestration.run.ticket.review.approved":
      return "approved";
    case "orchestration.run.ticket.review.requested-changes":
      return "requested-changes";
    case "orchestration.run.ticket.review.exhausted":
      return "blocked";
    default:
      return undefined;
  }
}

function reviewSummaryFromActivity(activity: OrchestrationThreadActivity): string {
  switch (activity.kind) {
    case "orchestration.run.ticket.review.started":
      return "Review started";
    case "orchestration.run.ticket.review.approved":
      return "Review passed";
    case "orchestration.run.ticket.review.requested-changes":
      return "Changes requested";
    case "orchestration.run.ticket.review.exhausted":
      return "Review blocked";
    default:
      return activity.summary;
  }
}

function threadHasContent(thread: Thread | undefined): boolean {
  if (!thread) return false;
  return (
    thread.messages.length > 0 ||
    thread.activities.length > 0 ||
    thread.latestTurn !== null ||
    thread.session !== null
  );
}

export function buildOrchestrationTimelineRows(input: {
  parentActivities: ReadonlyArray<OrchestrationThreadActivity>;
  childThreadsById: ReadonlyMap<string, Thread>;
  run: OrchestrationRun | null;
}): OrchestrationTimelineRow[] {
  const { parentActivities, childThreadsById, run } = input;

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
        ...(ticketIdentifierFromActivity(activity)
          ? { ticketIdentifier: ticketIdentifierFromActivity(activity)! }
          : {}),
      });

      // Emit the ticket group
      const ticketIndex = run.ticketOrder.findIndex((e) => e.ticketId === ticketId);
      const ticketEntry = ticketIndex >= 0 ? run.ticketOrder[ticketIndex] : undefined;
      const workingThread = ticketEntry
        ? childThreadsById.get(ticketEntry.workingThreadId)
        : undefined;
      const reviewThread =
        ticketEntry?.reviewThreadId !== undefined
          ? childThreadsById.get(ticketEntry.reviewThreadId)
          : undefined;
      const hasReviewLifecycle = orchestrationActivities.some(
        (candidate) =>
          candidate.kind.startsWith("orchestration.run.ticket.review.") &&
          ticketIdFromActivity(candidate) === ticketId,
      );
      const isLastStarted =
        orchestrationActivities.findLast((a) => a.kind === "orchestration.run.ticket.started")
          ?.id === activity.id;
      const hasCompletedActivity = orchestrationActivities.some(
        (a) =>
          a.kind === "orchestration.run.ticket.completed" && ticketIdFromActivity(a) === ticketId,
      );
      const resolvedTicketIndex = ticketIndex >= 0 ? ticketIndex : 0;
      const sections: TicketThreadSection[] = [];

      if (ticketEntry) {
        sections.push({
          id: `section:${ticketEntry.workingThreadId}`,
          kind: "working",
          threadId: ticketEntry.workingThreadId,
          title: workingThread?.title ?? "Implementation",
          messages: workingThread?.messages ?? [],
          isActive:
            run.status === "running" &&
            run.currentTicketIndex === resolvedTicketIndex &&
            run.currentPhase === "working",
          isStarted:
            threadHasContent(workingThread) ||
            (run.status !== "pending" && run.currentTicketIndex >= resolvedTicketIndex),
        });

        if (ticketEntry.reviewThreadId) {
          const reviewIsActive =
            run.status === "running" &&
            run.currentTicketIndex === resolvedTicketIndex &&
            run.currentPhase === "reviewing";
          const reviewIsStarted =
            threadHasContent(reviewThread) || hasReviewLifecycle || reviewIsActive;
          if (reviewIsStarted) {
            sections.push({
              id: `section:${ticketEntry.reviewThreadId}`,
              kind: "review",
              threadId: ticketEntry.reviewThreadId,
              title: reviewThread?.title ?? "Review",
              messages: reviewThread?.messages ?? [],
              isActive: reviewIsActive,
              isStarted: reviewIsStarted,
            });
          }
        }
      }

      rows.push({
        kind: "ticket-group",
        id: `ticket-${ticketId}`,
        ticketId,
        ticketIndex: resolvedTicketIndex,
        totalTickets,
        sections,
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
        ...(ticketIdentifierFromActivity(activity)
          ? { ticketIdentifier: ticketIdentifierFromActivity(activity)! }
          : {}),
      });
    } else {
      // Generic orchestration separator (started, paused, completed, etc.)
      const reviewState = reviewStateFromActivity(actKind);
      const reviewIteration = reviewIterationFromActivity(activity);
      rows.push({
        kind: "separator",
        id: `sep-${activity.id}`,
        activityKind: actKind,
        summary: reviewState ? reviewSummaryFromActivity(activity) : activity.summary,
        tone: activity.tone,
        createdAt: activity.createdAt,
        ...(ticketIdentifierFromActivity(activity)
          ? { ticketIdentifier: ticketIdentifierFromActivity(activity)! }
          : {}),
        ...(reviewIteration !== null ? { reviewIteration } : {}),
        ...(reviewState ? { reviewState } : {}),
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
      return (
        TICKET_GROUP_BASE_HEIGHT +
        row.sections.reduce((total, section) => total + section.messages.length, 0) *
          MESSAGE_HEIGHT_ESTIMATE
      );
    case "loading":
      return LOADING_ROW_HEIGHT;
    case "empty":
      return EMPTY_ROW_HEIGHT;
  }
}
