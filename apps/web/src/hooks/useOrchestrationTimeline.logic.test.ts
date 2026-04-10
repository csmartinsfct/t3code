import type {
  OrchestrationRun,
  OrchestrationThreadActivity,
  ReviewOutput,
  TicketId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage, Thread } from "../types";
import { buildOrchestrationTimelineRows } from "./useOrchestrationTimeline.logic";

function makeMessage(
  id: string,
  input: Partial<ChatMessage> & Pick<ChatMessage, "role" | "text" | "createdAt">,
): ChatMessage {
  return {
    id: id as ChatMessage["id"],
    streaming: false,
    ...input,
  };
}

function makeActivity(input: {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  tone?: OrchestrationThreadActivity["tone"];
  ticketId?: string;
  ticketIdentifier?: string;
  workingThreadId?: string;
  reviewThreadId?: string;
  reviewIteration?: number;
}): OrchestrationThreadActivity {
  return {
    id: input.id as OrchestrationThreadActivity["id"],
    kind: input.kind,
    tone: input.tone ?? "info",
    summary: input.summary,
    createdAt: input.createdAt,
    payload: {
      ...(input.ticketId ? { ticketId: input.ticketId as TicketId } : {}),
      ...(input.ticketIdentifier ? { ticketIdentifier: input.ticketIdentifier } : {}),
      ...(input.workingThreadId ? { workingThreadId: input.workingThreadId as ThreadId } : {}),
      ...(input.reviewThreadId ? { reviewThreadId: input.reviewThreadId as ThreadId } : {}),
      ...(input.reviewIteration !== undefined ? { reviewIteration: input.reviewIteration } : {}),
    },
    turnId: null,
  } as OrchestrationThreadActivity;
}

function makeChildThread(input: {
  id: string;
  ticketId?: string;
  messages?: ChatMessage[];
  activities?: OrchestrationThreadActivity[];
}): Thread {
  return {
    id: input.id as ThreadId,
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: input.ticketId ?? input.id,
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
    ticketId: (input.ticketId ?? null) as Thread["ticketId"],
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
    maxReviewIterations: 2,
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildOrchestrationTimelineRows", () => {
  it("interleaves implementation and review rows chronologically", () => {
    const reviewOutput: ReviewOutput = {
      changesNeeded: false,
      summary: "Looks good now.",
      comments: [],
    };

    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "ticket-started",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket T3CO-24",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
        }),
        makeActivity({
          id: "review-started-1",
          kind: "orchestration.run.ticket.review.started",
          summary: "Reviewing ticket T3CO-24",
          createdAt: "2026-04-09T10:00:02.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
          reviewThreadId: "thread-review-1",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-requested",
          kind: "orchestration.run.ticket.review.requested-changes",
          summary: "Changes requested",
          createdAt: "2026-04-09T10:00:03.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
          reviewThreadId: "thread-review-1",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-started-2",
          kind: "orchestration.run.ticket.review.started",
          summary: "Reviewing ticket T3CO-24 again",
          createdAt: "2026-04-09T10:00:05.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
          reviewThreadId: "thread-review-1",
          reviewIteration: 2,
        }),
        makeActivity({
          id: "review-approved",
          kind: "orchestration.run.ticket.review.approved",
          summary: "Approved",
          createdAt: "2026-04-09T10:00:06.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
          reviewThreadId: "thread-review-1",
          reviewIteration: 2,
        }),
        makeActivity({
          id: "ticket-completed",
          kind: "orchestration.run.ticket.completed",
          summary: "Completed ticket T3CO-24",
          createdAt: "2026-04-09T10:00:07.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
          reviewThreadId: "thread-review-1",
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("impl-1", {
              role: "assistant",
              text: "Initial implementation",
              createdAt: "2026-04-09T10:00:01.000Z",
            }),
            makeMessage("impl-2", {
              role: "assistant",
              text: "Addressed review feedback",
              createdAt: "2026-04-09T10:00:04.000Z",
            }),
          ],
        }),
        makeChildThread({
          id: "thread-review-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("review-1", {
              role: "assistant",
              text: JSON.stringify({
                changesNeeded: true,
                summary: "Please make one more pass.",
                comments: [],
              } satisfies ReviewOutput),
              createdAt: "2026-04-09T10:00:02.500Z",
            }),
            makeMessage("review-2", {
              role: "assistant",
              text: JSON.stringify(reviewOutput),
              createdAt: "2026-04-09T10:00:05.500Z",
            }),
          ],
        }),
      ],
      run: makeRun({ currentPhase: "reviewing", reviewIteration: 1 }),
    });

    expect(
      rows.map((row) => {
        switch (row.kind) {
          case "milestone":
            return row.summary;
          case "message":
            return row.message.text;
          case "waiting":
            return row.text;
          case "loading":
            return row.id;
          case "empty":
            return row.id;
        }
      }),
    ).toEqual([
      "Starting work on ticket T3CO-24",
      "Initial implementation",
      "Reviewing ticket T3CO-24",
      JSON.stringify({
        changesNeeded: true,
        summary: "Please make one more pass.",
        comments: [],
      }),
      "Changes requested",
      "Addressed review feedback",
      "Reviewing ticket T3CO-24 again",
      JSON.stringify(reviewOutput),
      "Approved",
      "Completed ticket T3CO-24",
    ]);
  });

  it("keeps review milestones visible and labels review passes", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "review-started",
          kind: "orchestration.run.ticket.review.started",
          summary: "Review started",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review-1",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-requested",
          kind: "orchestration.run.ticket.review.requested-changes",
          summary: "Changes requested",
          createdAt: "2026-04-09T10:00:01.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review-1",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-started-2",
          kind: "orchestration.run.ticket.review.started",
          summary: "Review started again",
          createdAt: "2026-04-09T10:00:02.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review-1",
          reviewIteration: 2,
        }),
        makeActivity({
          id: "review-approved",
          kind: "orchestration.run.ticket.review.approved",
          summary: "Approved",
          createdAt: "2026-04-09T10:00:03.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review-1",
          reviewIteration: 2,
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-review-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("review-1", {
              role: "assistant",
              text: "{}",
              createdAt: "2026-04-09T10:00:00.500Z",
            }),
            makeMessage("review-2", {
              role: "assistant",
              text: "{}",
              createdAt: "2026-04-09T10:00:02.500Z",
            }),
          ],
        }),
      ],
      run: makeRun({ currentPhase: "reviewing", reviewIteration: 1 }),
    });

    expect(rows.filter((row) => row.kind === "milestone")).toHaveLength(4);
    expect(
      rows
        .filter((row) => row.kind === "message")
        .map((row) => (row.kind === "message" ? row.sourceLabel : "")),
    ).toEqual(["Review 1", "Review 2"]);
  });

  it("dedupes duplicate ticket started milestones", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "ticket-started-1",
          kind: "orchestration.run.ticket.started",
          summary: "Starting ticket",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
        }),
        makeActivity({
          id: "ticket-started-2",
          kind: "orchestration.run.ticket.started",
          summary: "Starting ticket again",
          createdAt: "2026-04-09T10:00:01.000Z",
          ticketId: "ticket-1",
        }),
      ],
      childThreads: [],
      run: makeRun(),
    });

    expect(
      rows.filter(
        (row) =>
          row.kind === "milestone" && row.activityKind === "orchestration.run.ticket.started",
      ),
    ).toHaveLength(1);
  });

  it("orders same-timestamp milestones before messages and messages before terminal milestones", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "review-started",
          kind: "orchestration.run.ticket.review.started",
          summary: "Review started",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review-1",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-approved",
          kind: "orchestration.run.ticket.review.approved",
          summary: "Approved",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review-1",
          reviewIteration: 1,
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-review-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("review-message", {
              role: "assistant",
              text: "Review body",
              createdAt: "2026-04-09T10:00:00.000Z",
            }),
          ],
        }),
      ],
      run: makeRun({ currentPhase: "reviewing" }),
    });

    expect(rows.map((row) => row.kind)).toEqual(["milestone", "message", "milestone"]);
  });

  it("hides review user messages but keeps working user messages", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [],
      childThreads: [
        makeChildThread({
          id: "thread-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("user-working", {
              role: "user",
              text: "Working follow-up",
              createdAt: "2026-04-09T10:00:00.000Z",
            }),
          ],
        }),
        makeChildThread({
          id: "thread-review-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("user-review", {
              role: "user",
              text: "Internal review prompt",
              createdAt: "2026-04-09T10:00:01.000Z",
            }),
          ],
        }),
      ],
      run: makeRun(),
    });

    expect(rows.filter((row) => row.kind === "message")).toHaveLength(1);
    const messageRow = rows.find((row) => row.kind === "message");
    expect(messageRow && messageRow.kind === "message" ? messageRow.message.text : null).toBe(
      "Working follow-up",
    );
  });

  it("renders a waiting row for an active phase with no visible messages", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "ticket-started",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-1",
        }),
      ],
      childThreads: [makeChildThread({ id: "thread-1", ticketId: "ticket-1" })],
      run: makeRun({
        currentPhase: "working",
        updatedAt: "2026-04-09T10:00:05.000Z",
      }),
    });

    const waitingRow = rows.find((row) => row.kind === "waiting");
    expect(waitingRow).toMatchObject({
      kind: "waiting",
      sourceLabel: "Implementation",
      text: "Waiting for agent response...",
    });
  });

  it("uses fallback review labeling when review association is malformed", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [],
      childThreads: [
        makeChildThread({
          id: "thread-review-1",
          ticketId: "ticket-1",
          messages: [
            makeMessage("review-message", {
              role: "assistant",
              text: "Review fallback",
              createdAt: "2026-04-09T10:00:00.000Z",
            }),
          ],
        }),
      ],
      run: makeRun(),
    });

    const messageRow = rows.find((row) => row.kind === "message");
    expect(messageRow).toMatchObject({
      kind: "message",
      sourceLabel: "Review",
    });
  });
});
