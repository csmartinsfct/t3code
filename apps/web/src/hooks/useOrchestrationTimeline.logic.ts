import type {
  OrchestrationRun,
  OrchestrationThreadActivity,
  OrchestrationThreadActivityTone,
  ReviewOutput,
} from "@t3tools/contracts";

import {
  compareOrchestrationActivities,
  compareOrchestrationTimelineInstants,
} from "../lib/orchestrationTimelineOrdering";
import { parseReviewOutputText } from "../lib/reviewOutput";
import type { ChatMessage, Thread } from "../types";

export interface MilestoneRow {
  kind: "milestone";
  id: string;
  activityKind: string;
  summary: string;
  tone: OrchestrationThreadActivityTone;
  createdAt: string;
  ticketIdentifier?: string | undefined;
  reviewIteration?: number | undefined;
  reviewState?: "started" | "approved" | "requested-changes" | "blocked" | undefined;
}

export interface MessageRow {
  kind: "message";
  id: string;
  createdAt: string;
  threadId: string;
  ticketId?: string | undefined;
  ticketIdentifier?: string | undefined;
  threadKind: "working" | "review" | "unknown";
  sourceLabel: string;
  reviewIteration?: number | undefined;
  isActiveSource: boolean;
  message: ChatMessage;
  reviewOutput?: ReviewOutput | undefined;
}

export interface WaitingRow {
  kind: "waiting";
  id: string;
  createdAt: string;
  threadId: string;
  threadKind: "working" | "review";
  ticketIdentifier?: string | undefined;
  sourceLabel: string;
  text: string;
}

export interface LoadingRow {
  kind: "loading";
  id: "loading";
}

export interface EmptyRow {
  kind: "empty";
  id: "empty";
}

export type OrchestrationTimelineRow =
  | MilestoneRow
  | MessageRow
  | WaitingRow
  | LoadingRow
  | EmptyRow;

type TimelineSortableRow = MilestoneRow | MessageRow | WaitingRow;

const ORCHESTRATION_ACTIVITY_PREFIX = "orchestration.run.";

interface ReviewPassWindow {
  ticketId: string;
  threadId?: string | undefined;
  reviewIteration: number;
  startedAt: string;
  endedAt?: string | undefined;
  outcome?: "approved" | "requested-changes" | "blocked" | undefined;
}

interface SourceItem<TItem extends OrchestrationTimelineRow> {
  row: TItem;
  sourceIndex: number;
  itemIndex: number;
}

function isOrchestrationActivity(activity: OrchestrationThreadActivity): boolean {
  return (
    typeof activity.kind === "string" && activity.kind.startsWith(ORCHESTRATION_ACTIVITY_PREFIX)
  );
}

function activityPayload(activity: OrchestrationThreadActivity): Record<string, unknown> | null {
  const payload = activity.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload as Record<string, unknown>;
}

function ticketIdFromActivity(activity: OrchestrationThreadActivity): string | null {
  const payload = activityPayload(activity);
  return payload && typeof payload.ticketId === "string" ? payload.ticketId : null;
}

function ticketIdentifierFromActivity(activity: OrchestrationThreadActivity): string | null {
  const payload = activityPayload(activity);
  return payload && typeof payload.ticketIdentifier === "string" ? payload.ticketIdentifier : null;
}

function reviewThreadIdFromActivity(activity: OrchestrationThreadActivity): string | null {
  const payload = activityPayload(activity);
  return payload && typeof payload.reviewThreadId === "string" ? payload.reviewThreadId : null;
}

function reviewIterationFromActivity(activity: OrchestrationThreadActivity): number | null {
  const payload = activityPayload(activity);
  return payload &&
    typeof payload.reviewIteration === "number" &&
    Number.isInteger(payload.reviewIteration)
    ? payload.reviewIteration
    : null;
}

function reviewStateFromActivity(activityKind: string): MilestoneRow["reviewState"] | undefined {
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

function messageVisibleInTimeline(
  message: ChatMessage,
  threadKind: MessageRow["threadKind"],
): boolean {
  if (threadKind === "review" && message.role === "user") {
    return false;
  }
  return true;
}

function milestonePhaseRank(activityKind: string): number {
  const reviewState = reviewStateFromActivity(activityKind);
  if (
    reviewState === "requested-changes" ||
    reviewState === "approved" ||
    reviewState === "blocked"
  ) {
    return 3;
  }
  if (activityKind.endsWith(".started")) {
    return 0;
  }
  if (activityKind.endsWith(".completed") || activityKind.endsWith(".resolved")) {
    return 3;
  }
  if (activityKind.endsWith(".progress") || activityKind.endsWith(".updated")) {
    return 2;
  }
  return 2;
}

function compareRows(left: TimelineSortableRow, right: TimelineSortableRow): number {
  return compareOrchestrationTimelineInstants(
    {
      createdAt: left.createdAt,
      phaseRank:
        left.kind === "milestone"
          ? milestonePhaseRank(left.activityKind)
          : left.kind === "message" || left.kind === "waiting"
            ? 1
            : 2,
      stableId: left.id,
    },
    {
      createdAt: right.createdAt,
      phaseRank:
        right.kind === "milestone"
          ? milestonePhaseRank(right.activityKind)
          : right.kind === "message" || right.kind === "waiting"
            ? 1
            : 2,
      stableId: right.id,
    },
  );
}

function buildTicketIdentifierByTicketId(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const activity of activities) {
    const ticketId = ticketIdFromActivity(activity);
    const ticketIdentifier = ticketIdentifierFromActivity(activity);
    if (ticketId && ticketIdentifier && !map.has(ticketId)) {
      map.set(ticketId, ticketIdentifier);
    }
  }
  return map;
}

function buildReviewPassWindows(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Map<string, ReviewPassWindow[]> {
  const windowsByTicketId = new Map<string, ReviewPassWindow[]>();

  for (const activity of activities) {
    const ticketId = ticketIdFromActivity(activity);
    if (!ticketId) {
      continue;
    }
    const reviewState = reviewStateFromActivity(activity.kind);
    if (reviewState === undefined) {
      continue;
    }

    const ticketWindows = windowsByTicketId.get(ticketId) ?? [];
    const reviewIteration = reviewIterationFromActivity(activity) ?? ticketWindows.length + 1;
    const threadId = reviewThreadIdFromActivity(activity) ?? undefined;

    if (reviewState === "started") {
      ticketWindows.push({
        ticketId,
        threadId,
        reviewIteration,
        startedAt: activity.createdAt,
      });
      windowsByTicketId.set(ticketId, ticketWindows);
      continue;
    }

    const existingWindow = [...ticketWindows]
      .reverse()
      .find(
        (window) =>
          window.reviewIteration === reviewIteration &&
          window.endedAt === undefined &&
          (threadId === undefined || window.threadId === undefined || window.threadId === threadId),
      );

    if (existingWindow) {
      existingWindow.endedAt = activity.createdAt;
      existingWindow.outcome = reviewState;
      if (existingWindow.threadId === undefined) {
        existingWindow.threadId = threadId;
      }
    } else {
      ticketWindows.push({
        ticketId,
        threadId,
        reviewIteration,
        startedAt: activity.createdAt,
        endedAt: activity.createdAt,
        outcome: reviewState,
      });
      windowsByTicketId.set(ticketId, ticketWindows);
    }
  }

  for (const [ticketId, windows] of windowsByTicketId) {
    windows.sort((left, right) => {
      const startedAtComparison = left.startedAt.localeCompare(right.startedAt);
      if (startedAtComparison !== 0) {
        return startedAtComparison;
      }
      return left.reviewIteration - right.reviewIteration;
    });
    windowsByTicketId.set(ticketId, windows);
  }

  return windowsByTicketId;
}

function reviewIterationForMessage(input: {
  ticketId?: string | undefined;
  threadId: string;
  createdAt: string;
  windowsByTicketId: ReadonlyMap<string, ReviewPassWindow[]>;
  fallbackOrdinalByThreadId: ReadonlyMap<string, number>;
}): number | undefined {
  if (!input.ticketId) {
    return input.fallbackOrdinalByThreadId.get(input.threadId);
  }
  const windows = input.windowsByTicketId.get(input.ticketId) ?? [];
  const containing = windows.filter((window) => {
    if (window.threadId !== undefined && window.threadId !== input.threadId) {
      return false;
    }
    if (window.startedAt > input.createdAt) {
      return false;
    }
    return window.endedAt === undefined || input.createdAt <= window.endedAt;
  });
  if (containing.length > 0) {
    return containing.toSorted((left, right) => {
      const startedAtComparison = right.startedAt.localeCompare(left.startedAt);
      if (startedAtComparison !== 0) {
        return startedAtComparison;
      }
      return right.reviewIteration - left.reviewIteration;
    })[0]?.reviewIteration;
  }

  const previous = windows
    .filter(
      (window) =>
        (window.threadId === undefined || window.threadId === input.threadId) &&
        window.startedAt <= input.createdAt,
    )
    .toSorted((left, right) => {
      const startedAtComparison = right.startedAt.localeCompare(left.startedAt);
      if (startedAtComparison !== 0) {
        return startedAtComparison;
      }
      return right.reviewIteration - left.reviewIteration;
    })[0];
  if (previous) {
    return previous.reviewIteration;
  }

  return input.fallbackOrdinalByThreadId.get(input.threadId);
}

function threadVisibleMessagesSince(
  thread: Thread | undefined,
  threadKind: MessageRow["threadKind"],
  startAt: string,
): boolean {
  if (!thread) {
    return false;
  }
  return thread.messages.some(
    (message) =>
      messageVisibleInTimeline(message, threadKind) &&
      message.createdAt.localeCompare(startAt) >= 0,
  );
}

function buildWaitingRow(input: {
  run: OrchestrationRun;
  orderedActivities: ReadonlyArray<OrchestrationThreadActivity>;
  childThreadsById: ReadonlyMap<string, Thread>;
  ticketIdentifierByTicketId: ReadonlyMap<string, string>;
}): WaitingRow | null {
  if (input.run.status !== "running") {
    return null;
  }
  const ticketEntry = input.run.ticketOrder[input.run.currentTicketIndex];
  if (!ticketEntry) {
    return null;
  }
  const ticketId = ticketEntry.ticketId;
  const ticketIdentifier = input.ticketIdentifierByTicketId.get(ticketId);

  if (input.run.currentPhase === "working") {
    const phaseStartActivity = [...input.orderedActivities].reverse().find((activity) => {
      if (ticketIdFromActivity(activity) !== ticketId) {
        return false;
      }
      return (
        activity.kind === "orchestration.run.ticket.started" ||
        activity.kind === "orchestration.run.ticket.review.requested-changes"
      );
    });
    const phaseStart = phaseStartActivity?.createdAt ?? input.run.updatedAt;
    if (
      threadVisibleMessagesSince(
        input.childThreadsById.get(ticketEntry.workingThreadId),
        "working",
        phaseStart,
      )
    ) {
      return null;
    }
    return {
      kind: "waiting",
      id: `waiting:${ticketEntry.workingThreadId}:${phaseStart}`,
      createdAt: input.run.updatedAt >= phaseStart ? input.run.updatedAt : phaseStart,
      threadId: ticketEntry.workingThreadId,
      threadKind: "working",
      ticketIdentifier,
      sourceLabel: "Implementation",
      text: "Waiting for agent response...",
    };
  }

  const reviewThreadId = ticketEntry.reviewThreadId;
  if (!reviewThreadId) {
    return null;
  }
  const phaseStartActivity = [...input.orderedActivities]
    .reverse()
    .find(
      (activity) =>
        activity.kind === "orchestration.run.ticket.review.started" &&
        ticketIdFromActivity(activity) === ticketId,
    );
  const phaseStart = phaseStartActivity?.createdAt ?? input.run.updatedAt;
  if (
    threadVisibleMessagesSince(input.childThreadsById.get(reviewThreadId), "review", phaseStart)
  ) {
    return null;
  }
  const reviewIteration = phaseStartActivity
    ? reviewIterationFromActivity(phaseStartActivity)
    : null;
  return {
    kind: "waiting",
    id: `waiting:${reviewThreadId}:${phaseStart}`,
    createdAt: input.run.updatedAt >= phaseStart ? input.run.updatedAt : phaseStart,
    threadId: reviewThreadId,
    threadKind: "review",
    ticketIdentifier,
    sourceLabel: reviewIteration ? `Review ${reviewIteration}` : "Review",
    text: "Waiting for review output...",
  };
}

function pushHeap<T extends TimelineSortableRow>(
  heap: Array<SourceItem<T>>,
  item: SourceItem<T>,
): void {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareRows(heap[parentIndex]!.row, heap[index]!.row) <= 0) {
      break;
    }
    [heap[parentIndex], heap[index]] = [heap[index]!, heap[parentIndex]!];
    index = parentIndex;
  }
}

function popHeap<T extends TimelineSortableRow>(heap: Array<SourceItem<T>>): SourceItem<T> | null {
  if (heap.length === 0) {
    return null;
  }
  const first = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) {
    return first;
  }
  heap[0] = last;
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = index * 2 + 2;
    let nextIndex = index;

    if (leftIndex < heap.length && compareRows(heap[leftIndex]!.row, heap[nextIndex]!.row) < 0) {
      nextIndex = leftIndex;
    }
    if (rightIndex < heap.length && compareRows(heap[rightIndex]!.row, heap[nextIndex]!.row) < 0) {
      nextIndex = rightIndex;
    }
    if (nextIndex === index) {
      break;
    }
    [heap[index], heap[nextIndex]] = [heap[nextIndex]!, heap[index]!];
    index = nextIndex;
  }
  return first;
}

function mergeSources(
  sources: ReadonlyArray<ReadonlyArray<TimelineSortableRow>>,
): TimelineSortableRow[] {
  const heap: Array<SourceItem<TimelineSortableRow>> = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const firstRow = sources[sourceIndex]?.[0];
    if (firstRow) {
      pushHeap(heap, { row: firstRow, sourceIndex, itemIndex: 0 });
    }
  }

  const rows: TimelineSortableRow[] = [];
  while (heap.length > 0) {
    const next = popHeap(heap);
    if (!next) {
      break;
    }
    rows.push(next.row);
    const nextItemIndex = next.itemIndex + 1;
    const nextRow = sources[next.sourceIndex]?.[nextItemIndex];
    if (nextRow) {
      pushHeap(heap, {
        row: nextRow,
        sourceIndex: next.sourceIndex,
        itemIndex: nextItemIndex,
      });
    }
  }
  return rows;
}

export function buildOrchestrationTimelineRows(input: {
  parentActivities: ReadonlyArray<OrchestrationThreadActivity>;
  childThreads: ReadonlyArray<Thread>;
  run: OrchestrationRun | null;
}): OrchestrationTimelineRow[] {
  const { parentActivities, childThreads, run } = input;
  if (!run) {
    return [];
  }

  const orderedActivities = parentActivities
    .filter(isOrchestrationActivity)
    .toSorted(compareOrchestrationActivities);

  const ticketIdentifierByTicketId = buildTicketIdentifierByTicketId(orderedActivities);
  const reviewPassWindowsByTicketId = buildReviewPassWindows(orderedActivities);
  const childThreadsById = new Map(childThreads.map((thread) => [thread.id, thread] as const));
  const ticketPlanByThreadId = new Map<string, (typeof run.ticketOrder)[number]>();
  const threadKindByThreadId = new Map<string, MessageRow["threadKind"]>();
  const reviewOrdinalByThreadId = new Map<string, number>();

  for (const entry of run.ticketOrder) {
    ticketPlanByThreadId.set(entry.workingThreadId, entry);
    threadKindByThreadId.set(entry.workingThreadId, "working");
    if (entry.reviewThreadId) {
      ticketPlanByThreadId.set(entry.reviewThreadId, entry);
      threadKindByThreadId.set(entry.reviewThreadId, "review");
      const windows = reviewPassWindowsByTicketId.get(entry.ticketId) ?? [];
      const fallbackReviewIteration = windows
        .filter(
          (window) => window.threadId === undefined || window.threadId === entry.reviewThreadId,
        )
        .toSorted(
          (left, right) => left.reviewIteration - right.reviewIteration,
        )[0]?.reviewIteration;
      if (fallbackReviewIteration !== undefined) {
        reviewOrdinalByThreadId.set(entry.reviewThreadId, fallbackReviewIteration);
      }
    }
  }

  const emittedTicketStarts = new Set<string>();
  const milestoneRows: MilestoneRow[] = [];
  for (const activity of orderedActivities) {
    if (activity.kind === "orchestration.run.started") {
      continue;
    }
    const ticketId = ticketIdFromActivity(activity);
    if (activity.kind === "orchestration.run.ticket.started" && ticketId) {
      if (emittedTicketStarts.has(ticketId)) {
        continue;
      }
      emittedTicketStarts.add(ticketId);
    }
    milestoneRows.push({
      kind: "milestone",
      id: `milestone:${activity.id}`,
      activityKind: activity.kind,
      summary: activity.summary,
      tone: activity.tone,
      createdAt: activity.createdAt,
      ...(ticketIdentifierFromActivity(activity)
        ? { ticketIdentifier: ticketIdentifierFromActivity(activity)! }
        : {}),
      ...(reviewIterationFromActivity(activity) !== null
        ? { reviewIteration: reviewIterationFromActivity(activity)! }
        : {}),
      ...(reviewStateFromActivity(activity.kind)
        ? { reviewState: reviewStateFromActivity(activity.kind)! }
        : {}),
    });
  }

  const messageSources: TimelineSortableRow[][] = [];
  for (const thread of childThreads) {
    const entry = ticketPlanByThreadId.get(thread.id);
    const threadKind = threadKindByThreadId.get(thread.id) ?? "unknown";
    const ticketId = entry?.ticketId;
    const ticketIdentifier =
      (ticketId ? ticketIdentifierByTicketId.get(ticketId) : undefined) ?? undefined;
    const messageRows = thread.messages
      .toSorted((left, right) => {
        const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
        if (createdAtComparison !== 0) {
          return createdAtComparison;
        }
        return left.id.localeCompare(right.id);
      })
      .filter((message) => messageVisibleInTimeline(message, threadKind))
      .map((message): MessageRow => {
        const reviewIteration =
          threadKind === "review"
            ? reviewIterationForMessage({
                ticketId,
                threadId: thread.id,
                createdAt: message.createdAt,
                windowsByTicketId: reviewPassWindowsByTicketId,
                fallbackOrdinalByThreadId: reviewOrdinalByThreadId,
              })
            : undefined;
        const sourceLabel =
          threadKind === "working"
            ? "Implementation"
            : threadKind === "review"
              ? reviewIteration
                ? `Review ${reviewIteration}`
                : "Review"
              : "Thread";
        const reviewOutput =
          threadKind === "review" && message.role === "assistant"
            ? (parseReviewOutputText(message.text) ?? undefined)
            : undefined;
        return {
          kind: "message",
          id: `message:${message.id}`,
          createdAt: message.createdAt,
          threadId: thread.id,
          ...(ticketId ? { ticketId } : {}),
          ...(ticketIdentifier ? { ticketIdentifier } : {}),
          threadKind,
          sourceLabel,
          ...(reviewIteration !== undefined ? { reviewIteration } : {}),
          isActiveSource:
            run.status === "running" &&
            ((run.currentPhase === "working" && thread.id === entry?.workingThreadId) ||
              (run.currentPhase === "reviewing" && thread.id === entry?.reviewThreadId)),
          message,
          ...(reviewOutput ? { reviewOutput } : {}),
        };
      });
    if (messageRows.length > 0) {
      messageSources.push(messageRows);
    }
  }

  const waitingRow = buildWaitingRow({
    run,
    orderedActivities,
    childThreadsById,
    ticketIdentifierByTicketId,
  });

  const sources: TimelineSortableRow[][] = [milestoneRows, ...messageSources];
  if (waitingRow) {
    sources.push([waitingRow]);
  }

  return mergeSources(sources).filter((row, index, rows) => {
    if (row.kind !== "waiting") {
      return true;
    }
    return !rows.some(
      (candidate) =>
        candidate.kind === "message" &&
        candidate.threadId === row.threadId &&
        candidate.createdAt.localeCompare(row.createdAt) >= 0,
    );
  });
}

const MILESTONE_ROW_HEIGHT = 44;
const WAITING_ROW_HEIGHT = 72;
const MESSAGE_ROW_BASE_HEIGHT = 96;
const REVIEW_COMMENT_ESTIMATE = 84;
const LOADING_ROW_HEIGHT = 200;
const EMPTY_ROW_HEIGHT = 120;

function estimateMessageRowHeight(row: MessageRow): number {
  if (row.reviewOutput) {
    const summaryLines = Math.max(1, Math.ceil(row.reviewOutput.summary.length / 90));
    const commentsHeight =
      row.reviewOutput.comments.length === 0
        ? 52
        : row.reviewOutput.comments.length * REVIEW_COMMENT_ESTIMATE;
    return 108 + summaryLines * 24 + commentsHeight;
  }

  const contentLength = row.message.text.length;
  const estimatedLines = Math.max(1, Math.ceil(contentLength / 85));
  const attachmentBonus = row.message.attachments?.length ? 60 : 0;
  return MESSAGE_ROW_BASE_HEIGHT + estimatedLines * 22 + attachmentBonus;
}

export function estimateOrchestrationTimelineRowHeight(row: OrchestrationTimelineRow): number {
  switch (row.kind) {
    case "milestone":
      return MILESTONE_ROW_HEIGHT;
    case "message":
      return estimateMessageRowHeight(row);
    case "waiting":
      return WAITING_ROW_HEIGHT;
    case "loading":
      return LOADING_ROW_HEIGHT;
    case "empty":
      return EMPTY_ROW_HEIGHT;
  }
}
