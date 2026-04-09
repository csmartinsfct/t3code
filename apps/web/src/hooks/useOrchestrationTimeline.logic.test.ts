import type {
  OrchestrationRun,
  OrchestrationThreadActivity,
  TicketId,
  ThreadId,
  ReviewOutput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage, Thread } from "../types";
import { buildOrchestrationTimelineRows } from "./useOrchestrationTimeline.logic";

function makeMessage(id: string, text: string): ChatMessage {
  return {
    id: id as ChatMessage["id"],
    role: "assistant",
    text,
    createdAt: "2026-04-09T10:00:00.000Z",
    streaming: false,
  };
}

function makeActivity(input: {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  ticketId?: string;
  workingThreadId?: string;
}): OrchestrationThreadActivity {
  return {
    id: input.id as OrchestrationThreadActivity["id"],
    kind: input.kind,
    tone: "info",
    summary: input.summary,
    createdAt: input.createdAt,
    payload: {
      ...(input.ticketId ? { ticketId: input.ticketId as TicketId } : {}),
      ...(input.workingThreadId ? { workingThreadId: input.workingThreadId as ThreadId } : {}),
    },
    turnId: null,
  } as OrchestrationThreadActivity;
}

function makeChildThread(input: {
  id: string;
  ticketId: string;
  messages?: ChatMessage[];
  activities?: OrchestrationThreadActivity[];
}): Thread {
  return {
    id: input.id as ThreadId,
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: input.ticketId,
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: input.messages ?? [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-09T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-04-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: input.activities ?? [],
    isOrchestrationThread: false,
    parentThreadId: "parent-thread" as ThreadId,
    ticketId: input.ticketId as TicketId,
  } as Thread;
}

function makeRun(overrides: Partial<OrchestrationRun> = {}): OrchestrationRun {
  return {
    id: "run-1" as OrchestrationRun["id"],
    orchestrationThreadId: "parent-thread" as ThreadId,
    projectId: "project-1" as OrchestrationRun["projectId"],
    status: "running",
    ticketOrder: [
      {
        ticketId: "ticket-1" as TicketId,
        workingThreadId: "thread-1" as ThreadId,
        reviewThreadId: "thread-review-1" as ThreadId,
      },
    ],
    currentTicketIndex: 0,
    currentPhase: "working",
    reviewIteration: 0,
    maxReviewIterations: 1,
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildOrchestrationTimelineRows", () => {
  it("emits a ticket group only once when the same ticket is started multiple times", () => {
    const childThread = makeChildThread({
      id: "thread-1",
      ticketId: "ticket-1",
      messages: [makeMessage("message-1", "Continue working")],
    });

    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "started-1",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket T3CO-1",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          workingThreadId: "thread-1",
        }),
        makeActivity({
          id: "started-2",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket T3CO-1 again",
          createdAt: "2026-04-09T10:00:01.000Z",
          ticketId: "ticket-1",
          workingThreadId: "thread-1",
        }),
      ],
      childThreadsById: new Map([[childThread.id, childThread]]),
      run: makeRun(),
    });

    expect(rows.filter((row) => row.kind === "ticket-group")).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "separator")).toHaveLength(1);
    const ticketGroup = rows.find((row) => row.kind === "ticket-group");
    expect(ticketGroup && ticketGroup.kind === "ticket-group" ? ticketGroup.sections : []).toEqual([
      {
        id: "section:thread-1",
        kind: "working",
        threadId: "thread-1",
        title: "ticket-1",
        messages: childThread.messages,
        isActive: true,
        isStarted: true,
      },
    ]);
  });

  it("marks the ticket group completed when a completion activity exists", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "started-1",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket T3CO-1",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          workingThreadId: "thread-1",
        }),
        makeActivity({
          id: "completed-1",
          kind: "orchestration.run.ticket.completed",
          summary: "Completed ticket T3CO-1",
          createdAt: "2026-04-09T10:00:02.000Z",
          ticketId: "ticket-1",
          workingThreadId: "thread-1",
        }),
      ],
      childThreadsById: new Map([
        [
          "thread-1",
          makeChildThread({
            id: "thread-1",
            ticketId: "ticket-1",
          }),
        ],
      ]),
      run: makeRun({ status: "completed" }),
    });

    const ticketGroup = rows.find((row) => row.kind === "ticket-group");
    expect(
      ticketGroup && ticketGroup.kind === "ticket-group" ? ticketGroup.isCompleted : false,
    ).toBe(true);
  });

  it("keeps working and review sections distinct for the same ticket", () => {
    const reviewOutput: ReviewOutput = {
      changesNeeded: true,
      summary: "Tests still need coverage",
      comments: [{ file: "src/review.ts", line: 18, severity: "suggestion", body: "Add coverage" }],
      suggestions: ["Cover invalid review output handling"],
    };

    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "started-1",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket T3CO-24",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          workingThreadId: "thread-1",
        }),
        {
          ...makeActivity({
            id: "review-1",
            kind: "orchestration.run.ticket.review.requested-changes",
            summary: "Review requested changes for ticket T3CO-24",
            createdAt: "2026-04-09T10:00:02.000Z",
            ticketId: "ticket-1",
            workingThreadId: "thread-1",
          }),
          payload: {
            ticketId: "ticket-1" as TicketId,
            ticketIdentifier: "T3CO-24",
            workingThreadId: "thread-1" as ThreadId,
            reviewThreadId: "thread-review-1" as ThreadId,
            reviewIteration: 1,
          },
        } as OrchestrationThreadActivity,
      ],
      childThreadsById: new Map([
        [
          "thread-1",
          makeChildThread({
            id: "thread-1",
            ticketId: "ticket-1",
            messages: [makeMessage("message-1", "Implemented the review UI")],
          }),
        ],
        [
          "thread-review-1",
          makeChildThread({
            id: "thread-review-1",
            ticketId: "ticket-1",
            messages: [makeMessage("message-2", JSON.stringify(reviewOutput))],
          }),
        ],
      ]),
      run: makeRun({
        currentPhase: "reviewing",
      }),
    });

    const ticketGroup = rows.find((row) => row.kind === "ticket-group");
    expect(ticketGroup && ticketGroup.kind === "ticket-group" ? ticketGroup.sections : []).toEqual([
      {
        id: "section:thread-1",
        kind: "working",
        threadId: "thread-1",
        title: "ticket-1",
        messages: [makeMessage("message-1", "Implemented the review UI")],
        isActive: false,
        isStarted: true,
      },
      {
        id: "section:thread-review-1",
        kind: "review",
        threadId: "thread-review-1",
        title: "ticket-1",
        messages: [makeMessage("message-2", JSON.stringify(reviewOutput))],
        isActive: true,
        isStarted: true,
      },
    ]);

    const reviewSeparator = rows.find(
      (row) =>
        row.kind === "separator" &&
        row.activityKind === "orchestration.run.ticket.review.requested-changes",
    );
    expect(reviewSeparator).toMatchObject({
      kind: "separator",
      summary: "Changes requested",
      ticketIdentifier: "T3CO-24",
      reviewIteration: 1,
      reviewState: "requested-changes",
    });
  });
});
