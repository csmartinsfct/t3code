import { type MessageId } from "@t3tools/contracts";
import {
  extractDynamicChatUiArtifactsFromMarkdown,
  stripDynamicChatUiFencesFromMarkdown,
} from "@t3tools/shared/dynamicChatUi";
import {
  type LiveBackgroundTaskSnapshot,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { buildTurnDiffTree, type TurnDiffTreeNode } from "../../lib/turnDiffTree";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { estimateTimelineMessageHeight } from "../timelineHeight";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
      liveBackgroundTasks: LiveBackgroundTaskSnapshot | null;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  liveBackgroundTasks?: LiveBackgroundTaskSnapshot | null;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
        liveBackgroundTasks: null,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
    });
  }

  const liveBackgroundTasks = input.liveBackgroundTasks;
  if (liveBackgroundTasks && liveBackgroundTasks.tasks.length > 0) {
    const latestWorkRowIndex = nextRows.findLastIndex((row) => row.kind === "work");
    const latestWorkRow = nextRows[latestWorkRowIndex];
    if (latestWorkRow?.kind === "work") {
      nextRows[latestWorkRowIndex] = { ...latestWorkRow, liveBackgroundTasks };
    } else {
      nextRows.push({
        kind: "work",
        id: "live-background-tasks-row",
        createdAt: liveBackgroundTasks.createdAt,
        groupedEntries: [],
        liveBackgroundTasks,
      });
    }
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

type DynamicChatUiRowArtifact = ReturnType<
  typeof extractDynamicChatUiArtifactsFromMarkdown
>[number];

export function getDynamicChatUiArtifactsForRow(
  row: MessagesTimelineRow,
): ReadonlyArray<DynamicChatUiRowArtifact> {
  if (row.kind !== "message") return [];
  const metadataArtifacts = row.message.metadata?.dynamicChatUiArtifacts;
  if (metadataArtifacts?.some((artifact) => artifact.html.trim().length > 0)) {
    return metadataArtifacts.filter((artifact) => artifact.html.trim().length > 0);
  }
  return extractDynamicChatUiArtifactsFromMarkdown(row.message.text);
}

export function rowContainsDynamicChatUiArtifact(row: MessagesTimelineRow): boolean {
  return getDynamicChatUiArtifactsForRow(row).length > 0;
}

export function estimateMessagesTimelineRowHeight(
  row: MessagesTimelineRow,
  input: {
    timelineWidthPx: number | null;
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
    turnDiffSummaryByAssistantMessageId?: ReadonlyMap<MessageId, TurnDiffSummary>;
  },
): number {
  switch (row.kind) {
    case "work":
      return estimateWorkRowHeight(row, input);
    case "proposed-plan":
      return estimateTimelineProposedPlanHeight(row.proposedPlan);
    case "working":
      return 40;
    case "message": {
      const dynamicChatUiArtifacts = getDynamicChatUiArtifactsForRow(row);
      const estimateText =
        dynamicChatUiArtifacts.length > 0
          ? stripDynamicChatUiFencesFromMarkdown(row.message.text)
          : row.message.text;
      let estimate = estimateTimelineMessageHeight(
        { ...row.message, text: estimateText },
        {
          timelineWidthPx: input.timelineWidthPx,
        },
      );
      for (const artifact of dynamicChatUiArtifacts) {
        estimate += artifact.initialHeight + 76;
      }
      const turnDiffSummary = input.turnDiffSummaryByAssistantMessageId?.get(row.message.id);
      if (turnDiffSummary && turnDiffSummary.files.length > 0) {
        estimate += estimateChangedFilesCardHeight(turnDiffSummary);
      }
      return estimate;
    }
  }
}

function estimateWorkRowHeight(
  row: Extract<MessagesTimelineRow, { kind: "work" }>,
  input: {
    expandedWorkGroups?: Readonly<Record<string, boolean>>;
  },
): number {
  const isExpanded = input.expandedWorkGroups?.[row.id] ?? false;
  const hasOverflow = row.groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded ? MAX_VISIBLE_WORK_LOG_ENTRIES : row.groupedEntries.length;
  const onlyToolEntries = row.groupedEntries.every((entry) => entry.tone === "tool");
  const showHeader = hasOverflow || !onlyToolEntries;

  // Card chrome, optional header, and one compact work-entry row per visible entry.
  return 28 + (showHeader ? 26 : 0) + visibleEntries * 32 + (row.liveBackgroundTasks ? 32 : 0);
}

function estimateTimelineProposedPlanHeight(proposedPlan: ProposedPlan): number {
  const estimatedLines = Math.max(1, Math.ceil(proposedPlan.planMarkdown.length / 72));
  return 120 + Math.min(estimatedLines * 22, 880);
}

function estimateChangedFilesCardHeight(turnDiffSummary: TurnDiffSummary): number {
  const treeNodes = buildTurnDiffTree(turnDiffSummary.files);
  const visibleNodeCount = countTurnDiffTreeNodes(treeNodes);

  // Card chrome: top/bottom padding, header row, and tree spacing.
  return 60 + visibleNodeCount * 25;
}

function countTurnDiffTreeNodes(nodes: ReadonlyArray<TurnDiffTreeNode>): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.kind === "directory") {
      count += countTurnDiffTreeNodes(node.children);
    }
  }
  return count;
}
