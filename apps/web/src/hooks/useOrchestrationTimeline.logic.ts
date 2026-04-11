import type {
  OrchestrationRun,
  OrchestrationThreadActivity,
  TicketId,
  ThreadId,
} from "@t3tools/contracts";

import {
  activityLifecycleRank,
  compareOrchestrationActivities,
  compareOrchestrationTimelineInstants,
} from "../lib/orchestrationTimelineOrdering";
import type { ChatMessage, Thread } from "../types";

export interface SeparatorRow {
  kind: "separator";
  id: string;
  activityKind: string;
  summary: string;
  tone: OrchestrationThreadActivity["tone"];
  createdAt: string;
  ticketIdentifier?: string;
  reviewIteration?: number;
  reviewState?: "started" | "approved" | "requested-changes" | "blocked";
}

export interface ThreadBlockRow {
  kind: "thread-block";
  id: string;
  threadId: string;
  sectionKind: "working" | "review";
  messages: ChatMessage[];
  isActive: boolean;
  reviewIteration?: number;
  reviewOutcome?: "approved" | "requested-changes" | "blocked";
  emptyStateText?: string;
}

export interface LoadingRow {
  kind: "loading";
  id: string;
}

export interface EmptyRow {
  kind: "empty";
  id: string;
}

export interface WorkingRow {
  kind: "working";
  id: string;
  createdAt: string | null;
}

export type OrchestrationTimelineRow =
  | SeparatorRow
  | ThreadBlockRow
  | LoadingRow
  | EmptyRow
  | WorkingRow;

interface BuildRowsInput {
  parentActivities: OrchestrationThreadActivity[];
  childThreads: Thread[];
  run: OrchestrationRun;
}

type ThreadSectionKind = "working" | "review" | "other";

interface ThreadPlanMetadata {
  ticketId?: TicketId;
  kind: ThreadSectionKind;
  order: number;
}

interface ReviewPassWindow {
  ticketId?: TicketId;
  threadId?: ThreadId;
  reviewIteration?: number;
  startedAt: string;
  endedAt: string | null;
  outcome: "approved" | "requested-changes" | "blocked" | null;
}

interface MilestoneItem {
  type: "milestone";
  row: SeparatorRow;
  createdAt: string;
  phaseRank: number;
  stableId: string;
}

interface MessageItem {
  type: "message";
  threadId: string;
  sectionKind: "working" | "review";
  message: ChatMessage;
  createdAt: string;
  phaseRank: number;
  stableId: string;
  reviewIteration?: number;
  reviewOutcome?: "approved" | "requested-changes" | "blocked";
}

interface WaitingItem {
  type: "waiting";
  threadId: string;
  sectionKind: "working" | "review";
  createdAt: string;
  phaseRank: number;
  stableId: string;
  emptyStateText: string;
  reviewIteration?: number;
  reviewOutcome?: "approved" | "requested-changes" | "blocked";
}

type TimelineItem = MilestoneItem | MessageItem | WaitingItem;

interface ReviewContext {
  reviewIteration?: number;
  reviewOutcome?: "approved" | "requested-changes" | "blocked";
}

function isOrchestrationPromptMessage(message: ChatMessage): boolean {
  return message.metadata?.origin?.kind === "orchestration-prompt";
}

function isVisibleOrchestrationTimelineMessage(message: ChatMessage): boolean {
  if (isOrchestrationPromptMessage(message)) {
    return false;
  }

  return !(message.role === "system" && !message.text);
}

export function buildOrchestrationTimelineRows({
  parentActivities,
  childThreads,
  run,
}: BuildRowsInput): OrchestrationTimelineRow[] {
  const sortedActivities = parentActivities.toSorted(compareOrchestrationActivities);
  const threadPlanByThreadId = buildThreadPlanByThreadId(run);
  const ticketIdentifierByTicketId = buildTicketIdentifierByTicketId(sortedActivities);
  const reviewWindows = buildReviewPassWindows(sortedActivities);

  const milestoneItems = buildMilestoneItems(sortedActivities, ticketIdentifierByTicketId);
  const messageSources = buildMessageSources({
    childThreads,
    threadPlanByThreadId,
    reviewWindows,
  });
  const waitingItems = buildWaitingItems({
    run,
    childThreads,
    threadPlanByThreadId,
    reviewWindows,
    sortedActivities,
  });

  const mergedItems = mergeSortedSources([
    milestoneItems,
    ...messageSources,
    ...waitingItems.map((item) => [item]),
  ]);

  const rows = partitionMergedItemsIntoRows(mergedItems);
  const activeRunStartedAt = deriveActiveOrchestrationStartedAt(run, sortedActivities);
  if (activeRunStartedAt) {
    rows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: activeRunStartedAt,
    });
  }
  return rows;
}

export function estimateOrchestrationTimelineRowHeight(row: OrchestrationTimelineRow): number {
  switch (row.kind) {
    case "separator":
      return 44;
    case "thread-block": {
      if (row.messages.length === 0) {
        return 96;
      }

      let estimated = 52;
      for (const message of row.messages) {
        if (message.role === "system") {
          estimated += 28;
          continue;
        }
        if (message.role === "user") {
          estimated += 72 + Math.min(64, Math.ceil((message.text.length || 0) / 40) * 20);
          continue;
        }

        const textLength = message.text.length;
        const looksLikeReviewJson = message.text.trimStart().startsWith("{");
        estimated += looksLikeReviewJson
          ? 140 + Math.min(240, Math.ceil(textLength / 90) * 18)
          : 72 + Math.min(220, Math.ceil(textLength / 80) * 20);
      }
      return estimated;
    }
    case "loading":
      return 420;
    case "empty":
      return 220;
    case "working":
      return 40;
  }
}

function buildThreadPlanByThreadId(run: OrchestrationRun): Map<string, ThreadPlanMetadata> {
  const plan = new Map<string, ThreadPlanMetadata>();

  run.ticketOrder.forEach((ticketPlan, index) => {
    if (ticketPlan.workingThreadId) {
      plan.set(ticketPlan.workingThreadId, {
        ticketId: ticketPlan.ticketId,
        kind: "working",
        order: index * 2,
      });
    }
    if (ticketPlan.reviewThreadId) {
      plan.set(ticketPlan.reviewThreadId, {
        ticketId: ticketPlan.ticketId,
        kind: "review",
        order: index * 2 + 1,
      });
    }
  });

  return plan;
}

function buildTicketIdentifierByTicketId(
  activities: OrchestrationThreadActivity[],
): Map<string, string> {
  const identifiers = new Map<string, string>();
  for (const activity of activities) {
    const ticketId = getPayloadString(activity, "ticketId");
    const ticketIdentifier = getPayloadString(activity, "ticketIdentifier");
    if (ticketId && ticketIdentifier) {
      identifiers.set(ticketId, ticketIdentifier);
    }
  }
  return identifiers;
}

function buildReviewPassWindows(
  activities: OrchestrationThreadActivity[],
): Map<string, ReviewPassWindow[]> {
  const windowsByTicketId = new Map<string, ReviewPassWindow[]>();

  for (const activity of activities) {
    const ticketId = getPayloadString(activity, "ticketId");
    if (!ticketId) continue;

    const reviewThreadId = getPayloadString(activity, "reviewThreadId");
    const reviewIteration = getPayloadNumber(activity, "reviewIteration");
    const windows = getOrCreateArray(windowsByTicketId, ticketId);

    if (activity.kind === "orchestration.run.ticket.review.started") {
      windows.push({
        ticketId: ticketId as TicketId,
        ...(reviewThreadId ? { threadId: reviewThreadId as ThreadId } : {}),
        ...(reviewIteration !== undefined ? { reviewIteration } : {}),
        startedAt: activity.createdAt,
        endedAt: null,
        outcome: null,
      });
      continue;
    }

    const outcome = getReviewOutcomeFromActivity(activity);
    if (!outcome) continue;

    const existingWindow =
      windows
        .toReversed()
        .find(
          (window) =>
            window.endedAt === null &&
            (reviewIteration === undefined || window.reviewIteration === reviewIteration),
        ) ?? null;

    if (existingWindow) {
      existingWindow.endedAt = activity.createdAt;
      existingWindow.outcome = outcome;
      if (!existingWindow.threadId && reviewThreadId) {
        existingWindow.threadId = reviewThreadId as ThreadId;
      }
      continue;
    }

    windows.push({
      ticketId: ticketId as TicketId,
      ...(reviewThreadId ? { threadId: reviewThreadId as ThreadId } : {}),
      ...(reviewIteration !== undefined ? { reviewIteration } : {}),
      startedAt: activity.createdAt,
      endedAt: activity.createdAt,
      outcome,
    });
  }

  return windowsByTicketId;
}

function buildMilestoneItems(
  activities: OrchestrationThreadActivity[],
  ticketIdentifierByTicketId: Map<string, string>,
): MilestoneItem[] {
  const seenTicketStartByTicketId = new Set<string>();
  const items: MilestoneItem[] = [];

  for (const activity of activities) {
    if (!shouldRenderActivityAsSeparator(activity)) continue;

    const ticketId = getPayloadString(activity, "ticketId");
    if (
      activity.kind === "orchestration.run.ticket.started" &&
      ticketId &&
      seenTicketStartByTicketId.has(ticketId)
    ) {
      continue;
    }

    if (activity.kind === "orchestration.run.ticket.started" && ticketId) {
      seenTicketStartByTicketId.add(ticketId);
    }

    const ticketIdentifier =
      (ticketId ? ticketIdentifierByTicketId.get(ticketId) : undefined) ??
      getPayloadString(activity, "ticketIdentifier");
    const reviewIteration = getPayloadNumber(activity, "reviewIteration");
    const reviewState = getReviewState(activity.kind);

    items.push({
      type: "milestone",
      createdAt: activity.createdAt,
      phaseRank: activityLifecycleRank(activity.kind),
      stableId: `activity:${activity.id}`,
      row: {
        kind: "separator",
        id: `separator:${activity.id}`,
        activityKind: activity.kind,
        summary: activity.summary,
        tone: activity.tone,
        createdAt: activity.createdAt,
        ...(ticketIdentifier ? { ticketIdentifier } : {}),
        ...(reviewIteration !== undefined ? { reviewIteration } : {}),
        ...(reviewState ? { reviewState } : {}),
      },
    });
  }

  return items;
}

function buildMessageSources(input: {
  childThreads: Thread[];
  threadPlanByThreadId: Map<string, ThreadPlanMetadata>;
  reviewWindows: Map<string, ReviewPassWindow[]>;
}): MessageItem[][] {
  const reviewFallbackOrdinals = new Map<string, number>();

  return input.childThreads
    .map((thread) => {
      const threadPlan = input.threadPlanByThreadId.get(thread.id);
      const sectionKind = inferThreadSectionKind(thread, threadPlan);
      if (sectionKind === "other") return [];

      const ticketId = thread.ticketId ?? threadPlan?.ticketId;
      const sortedMessages = thread.messages.toSorted((left, right) => {
        const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
        if (createdAtComparison !== 0) return createdAtComparison;
        return left.id.localeCompare(right.id);
      });

      const messageItems: MessageItem[] = [];
      for (const message of sortedMessages) {
        if (isOrchestrationPromptMessage(message)) {
          continue;
        }

        const reviewContext =
          sectionKind === "review"
            ? resolveReviewContext({
                messageCreatedAt: message.createdAt,
                reviewWindows: ticketId ? (input.reviewWindows.get(ticketId) ?? []) : [],
                threadId: thread.id,
                fallbackOrdinals: reviewFallbackOrdinals,
              })
            : {};

        messageItems.push({
          type: "message",
          threadId: thread.id,
          sectionKind,
          message,
          createdAt: message.createdAt,
          phaseRank: 1,
          stableId: `message:${message.id}`,
          ...(reviewContext.reviewIteration !== undefined
            ? { reviewIteration: reviewContext.reviewIteration }
            : {}),
          ...(reviewContext.reviewOutcome ? { reviewOutcome: reviewContext.reviewOutcome } : {}),
        });
      }

      return messageItems;
    })
    .filter((source) => source.length > 0);
}

function buildWaitingItems(input: {
  run: OrchestrationRun;
  childThreads: Thread[];
  threadPlanByThreadId: Map<string, ThreadPlanMetadata>;
  reviewWindows: Map<string, ReviewPassWindow[]>;
  sortedActivities: OrchestrationThreadActivity[];
}): WaitingItem[] {
  if (input.run.status !== "running") return [];

  const currentTicketPlan = input.run.ticketOrder[input.run.currentTicketIndex];
  if (!currentTicketPlan) return [];

  if (input.run.currentPhase === "working") {
    const threadId = currentTicketPlan.workingThreadId;
    if (!threadId) return [];
    if (!hasPhaseStarted("working", currentTicketPlan.ticketId, input.sortedActivities)) return [];

    const phaseStart = getWorkingPhaseStart(currentTicketPlan.ticketId, input.sortedActivities);
    const thread = input.childThreads.find((candidate) => candidate.id === threadId);
    const hasVisibleMessage = Boolean(
      thread?.messages.some(
        (message) =>
          message.createdAt >= phaseStart && isVisibleOrchestrationTimelineMessage(message),
      ),
    );
    if (hasVisibleMessage) return [];

    return [
      {
        type: "waiting",
        threadId,
        sectionKind: "working",
        createdAt: input.run.updatedAt,
        phaseRank: 1,
        stableId: `waiting:${threadId}:working`,
        emptyStateText: "Waiting for agent response...",
      },
    ];
  }

  if (input.run.currentPhase === "reviewing") {
    const threadId = currentTicketPlan.reviewThreadId;
    if (!threadId) return [];
    const phaseStart = getReviewPhaseStart(
      currentTicketPlan.ticketId,
      input.run.reviewIteration || undefined,
      input.sortedActivities,
    );
    if (!phaseStart) return [];

    const thread = input.childThreads.find((candidate) => candidate.id === threadId);
    const hasVisibleMessage = Boolean(
      thread?.messages.some(
        (message) =>
          message.createdAt >= phaseStart && isVisibleOrchestrationTimelineMessage(message),
      ),
    );
    if (hasVisibleMessage) return [];

    const activeWindow =
      input.reviewWindows
        .get(currentTicketPlan.ticketId)
        ?.find(
          (window) =>
            window.threadId === threadId && window.reviewIteration === input.run.reviewIteration,
        ) ?? null;

    return [
      {
        type: "waiting",
        threadId,
        sectionKind: "review",
        createdAt: input.run.updatedAt,
        phaseRank: 1,
        stableId: `waiting:${threadId}:review`,
        emptyStateText: "Waiting for review output...",
        ...(input.run.reviewIteration ? { reviewIteration: input.run.reviewIteration } : {}),
        ...(activeWindow?.outcome ? { reviewOutcome: activeWindow.outcome } : {}),
      },
    ];
  }

  return [];
}

function partitionMergedItemsIntoRows(items: TimelineItem[]): OrchestrationTimelineRow[] {
  const rows: OrchestrationTimelineRow[] = [];
  let currentBlock: ThreadBlockRow | null = null;

  const flushCurrentBlock = () => {
    if (!currentBlock) return;
    rows.push(currentBlock);
    currentBlock = null;
  };

  for (const item of items) {
    if (item.type === "milestone") {
      flushCurrentBlock();
      rows.push(item.row);
      continue;
    }

    if (!currentBlock || !canAppendToCurrentBlock(currentBlock, item)) {
      flushCurrentBlock();
      currentBlock = {
        kind: "thread-block",
        id: `${item.type}:${item.threadId}:${item.stableId}`,
        threadId: item.threadId,
        sectionKind: item.sectionKind,
        messages: [],
        isActive: item.type === "waiting",
        ...(item.reviewIteration !== undefined ? { reviewIteration: item.reviewIteration } : {}),
        ...(item.reviewOutcome ? { reviewOutcome: item.reviewOutcome } : {}),
        ...(item.type === "waiting" ? { emptyStateText: item.emptyStateText } : {}),
      };
    }

    if (item.type === "message") {
      currentBlock.messages.push(item.message);
      delete currentBlock.emptyStateText;
      currentBlock.isActive = false;
    }
  }

  flushCurrentBlock();
  return rows;
}

function canAppendToCurrentBlock(block: ThreadBlockRow, item: MessageItem | WaitingItem): boolean {
  return (
    block.threadId === item.threadId &&
    block.sectionKind === item.sectionKind &&
    block.reviewIteration === item.reviewIteration
  );
}

function mergeSortedSources(sources: TimelineItem[][]): TimelineItem[] {
  const heap: Array<{ item: TimelineItem; sourceIndex: number; itemIndex: number }> = [];

  sources.forEach((source, sourceIndex) => {
    const item = source[0];
    if (!item) return;
    heapPush(heap, { item, sourceIndex, itemIndex: 0 });
  });

  const merged: TimelineItem[] = [];
  while (heap.length > 0) {
    const next = heapPop(heap);
    if (!next) break;
    merged.push(next.item);

    const source = sources[next.sourceIndex];
    if (!source) continue;
    const followingItem = source[next.itemIndex + 1];
    if (followingItem) {
      heapPush(heap, {
        item: followingItem,
        sourceIndex: next.sourceIndex,
        itemIndex: next.itemIndex + 1,
      });
    }
  }

  return merged;
}

function heapPush(
  heap: Array<{ item: TimelineItem; sourceIndex: number; itemIndex: number }>,
  entry: { item: TimelineItem; sourceIndex: number; itemIndex: number },
) {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareTimelineItems(heap[index]!.item, heap[parentIndex]!.item) >= 0) break;
    [heap[index], heap[parentIndex]] = [heap[parentIndex]!, heap[index]!];
    index = parentIndex;
  }
}

function heapPop(
  heap: Array<{ item: TimelineItem; sourceIndex: number; itemIndex: number }>,
): { item: TimelineItem; sourceIndex: number; itemIndex: number } | null {
  if (heap.length === 0) return null;
  const first = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) return first;
  heap[0] = last;

  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;

    if (left < heap.length && compareTimelineItems(heap[left]!.item, heap[smallest]!.item) < 0) {
      smallest = left;
    }
    if (right < heap.length && compareTimelineItems(heap[right]!.item, heap[smallest]!.item) < 0) {
      smallest = right;
    }
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
    index = smallest;
  }

  return first;
}

function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  return compareOrchestrationTimelineInstants(
    {
      createdAt: left.createdAt,
      phaseRank: left.phaseRank,
      stableId: left.stableId,
    },
    {
      createdAt: right.createdAt,
      phaseRank: right.phaseRank,
      stableId: right.stableId,
    },
  );
}

function resolveReviewContext(input: {
  messageCreatedAt: string;
  reviewWindows: ReviewPassWindow[];
  threadId: string;
  fallbackOrdinals: Map<string, number>;
}): ReviewContext {
  const matchingWindow =
    input.reviewWindows
      .filter((window) => window.threadId === input.threadId || !window.threadId)
      .filter(
        (window) =>
          window.startedAt <= input.messageCreatedAt &&
          (window.endedAt === null || input.messageCreatedAt <= window.endedAt),
      )
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null;

  if (matchingWindow) {
    return {
      ...(matchingWindow.reviewIteration !== undefined
        ? { reviewIteration: matchingWindow.reviewIteration }
        : {}),
      ...(matchingWindow.outcome ? { reviewOutcome: matchingWindow.outcome } : {}),
    };
  }

  const nearestPastWindow =
    input.reviewWindows
      .filter(
        (window) =>
          (window.threadId === input.threadId || !window.threadId) &&
          window.startedAt <= input.messageCreatedAt,
      )
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null;

  if (nearestPastWindow) {
    return {
      ...(nearestPastWindow.reviewIteration !== undefined
        ? { reviewIteration: nearestPastWindow.reviewIteration }
        : {}),
      ...(nearestPastWindow.outcome ? { reviewOutcome: nearestPastWindow.outcome } : {}),
    };
  }

  const nextOrdinal = (input.fallbackOrdinals.get(input.threadId) ?? 0) + 1;
  input.fallbackOrdinals.set(input.threadId, nextOrdinal);
  return { reviewIteration: nextOrdinal };
}

function inferThreadSectionKind(
  thread: Thread,
  threadPlan: ThreadPlanMetadata | undefined,
): ThreadSectionKind {
  if (threadPlan?.kind) return threadPlan.kind;
  if (thread.id.includes("review")) return "review";
  if (thread.parentThreadId) return "working";
  return "other";
}

function shouldRenderActivityAsSeparator(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind === "orchestration.run.started") return false;
  if (isHiddenReviewOutcomeActivityKind(activity.kind)) return false;
  if (activity.kind.startsWith("orchestration.run.ticket.")) return true;
  return (
    activity.kind.includes("paused") ||
    activity.kind.includes("resumed") ||
    activity.kind.includes("failed") ||
    activity.kind.includes("canceled") ||
    activity.kind.includes("takeover") ||
    activity.kind.includes("prompt-render-failed")
  );
}

function isHiddenReviewOutcomeActivityKind(activityKind: string): boolean {
  return (
    activityKind.endsWith(".review.approved") ||
    activityKind.endsWith(".review.requested-changes") ||
    activityKind.endsWith(".review.exhausted")
  );
}

function getReviewState(activityKind: string): SeparatorRow["reviewState"] | undefined {
  if (activityKind.endsWith(".review.started")) return "started";
  if (activityKind.endsWith(".review.approved")) return "approved";
  if (activityKind.endsWith(".review.requested-changes")) return "requested-changes";
  if (activityKind.endsWith(".review.exhausted")) return "blocked";
  return undefined;
}

function getReviewOutcomeFromActivity(
  activity: OrchestrationThreadActivity,
): ReviewContext["reviewOutcome"] | null {
  if (activity.kind.endsWith(".review.approved")) return "approved";
  if (activity.kind.endsWith(".review.requested-changes")) return "requested-changes";
  if (activity.kind.endsWith(".review.exhausted")) return "blocked";
  return null;
}

function getPayloadString(activity: OrchestrationThreadActivity, key: string): string | undefined {
  const value = (activity.payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

function getPayloadNumber(activity: OrchestrationThreadActivity, key: string): number | undefined {
  const value = (activity.payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : undefined;
}

function getOrCreateArray<K, V>(map: Map<K, V[]>, key: K): V[] {
  let value = map.get(key);
  if (!value) {
    value = [];
    map.set(key, value);
  }
  return value;
}

function hasPhaseStarted(
  phase: "working" | "reviewing",
  ticketId: TicketId,
  activities: OrchestrationThreadActivity[],
): boolean {
  if (phase === "working") {
    return activities.some(
      (activity) =>
        getPayloadString(activity, "ticketId") === ticketId &&
        (activity.kind === "orchestration.run.ticket.started" ||
          activity.kind === "orchestration.run.ticket.review.requested-changes"),
    );
  }

  return activities.some(
    (activity) =>
      getPayloadString(activity, "ticketId") === ticketId &&
      activity.kind === "orchestration.run.ticket.review.started",
  );
}

function getWorkingPhaseStart(
  ticketId: TicketId,
  activities: OrchestrationThreadActivity[],
): string {
  const relevant = activities
    .toReversed()
    .find(
      (activity) =>
        getPayloadString(activity, "ticketId") === ticketId &&
        (activity.kind === "orchestration.run.ticket.review.requested-changes" ||
          activity.kind === "orchestration.run.ticket.started"),
    );

  return relevant?.createdAt ?? activities[0]?.createdAt ?? new Date(0).toISOString();
}

function getReviewPhaseStart(
  ticketId: TicketId,
  reviewIteration: number | undefined,
  activities: OrchestrationThreadActivity[],
): string | null {
  const relevant = activities
    .toReversed()
    .find(
      (activity) =>
        getPayloadString(activity, "ticketId") === ticketId &&
        activity.kind === "orchestration.run.ticket.review.started" &&
        (reviewIteration === undefined ||
          getPayloadNumber(activity, "reviewIteration") === reviewIteration),
    );

  return relevant?.createdAt ?? null;
}

function deriveActiveOrchestrationStartedAt(
  run: OrchestrationRun,
  activities: OrchestrationThreadActivity[],
): string | null {
  if (run.status !== "running") {
    return null;
  }

  const latestRunStartActivity = activities.toReversed().find((activity) => {
    return (
      activity.kind === "orchestration.run.started" || activity.kind === "orchestration.run.resumed"
    );
  });

  return latestRunStartActivity?.createdAt ?? run.createdAt;
}
