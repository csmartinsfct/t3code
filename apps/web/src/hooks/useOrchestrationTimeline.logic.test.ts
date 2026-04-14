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
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: input.id as OrchestrationThreadActivity["id"],
    kind: input.kind,
    tone: input.tone ?? "info",
    summary: input.summary,
    createdAt: input.createdAt,
    sequence: input.sequence,
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
    activities: [],
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
        workingThreadId: "thread-impl" as ThreadId,
        reviewThreadId: "thread-review" as ThreadId,
      },
    ],
    currentTicketIndex: 0,
    currentPhase: "working",
    reviewIteration: 0,
    maxReviewIterations: 2,
    promptOverrides: {},
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildOrchestrationTimelineRows", () => {
  it("keeps resumed and user-takeover milestones in the timeline and restarts the working timer from resume", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "run-started",
          kind: "orchestration.run.started",
          summary: "Run started",
          createdAt: "2026-04-09T10:00:00.000Z",
        }),
        makeActivity({
          id: "run-resumed",
          kind: "orchestration.run.resumed",
          summary: "Run resumed after restart",
          createdAt: "2026-04-09T10:03:00.000Z",
        }),
        makeActivity({
          id: "user-takeover",
          kind: "orchestration.run.user-takeover",
          summary: "Paused because the user took over ticket T3CO-188",
          createdAt: "2026-04-09T10:04:00.000Z",
          tone: "info",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-188",
        }),
      ],
      childThreads: [],
      run: makeRun({
        status: "running",
        updatedAt: "2026-04-09T10:05:00.000Z",
      }),
    });

    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "separator",
        activityKind: "orchestration.run.resumed",
        summary: "Run resumed after restart",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "separator",
        activityKind: "orchestration.run.user-takeover",
        summary: "Paused because the user took over ticket T3CO-188",
        ticketIdentifier: "T3CO-188",
      }),
    );
    expect(rows.at(-1)).toMatchObject({
      kind: "working",
      createdAt: "2026-04-09T10:03:00.000Z",
    });
  });

  it("interleaves implementation and review blocks chronologically", () => {
    const finalReview: ReviewOutput = {
      changesNeeded: false,
      summary: "Looks good now.",
      comments: [],
    };

    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "ticket-started",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work on ticket",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-impl",
        }),
        makeActivity({
          id: "review-started-1",
          kind: "orchestration.run.ticket.review.started",
          summary: "Reviewing ticket T3CO-24",
          createdAt: "2026-04-09T10:00:02.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-requested",
          kind: "orchestration.run.ticket.review.requested-changes",
          summary: "Changes requested",
          createdAt: "2026-04-09T10:00:03.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-started-2",
          kind: "orchestration.run.ticket.review.started",
          summary: "Reviewing ticket T3CO-24 again",
          createdAt: "2026-04-09T10:00:05.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review",
          reviewIteration: 2,
        }),
        makeActivity({
          id: "review-approved",
          kind: "orchestration.run.ticket.review.approved",
          summary: "Approved",
          createdAt: "2026-04-09T10:00:06.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          reviewThreadId: "thread-review",
          reviewIteration: 2,
        }),
        makeActivity({
          id: "ticket-completed",
          kind: "orchestration.run.ticket.completed",
          summary: "Completed ticket",
          createdAt: "2026-04-09T10:00:07.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-impl",
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
          id: "thread-review",
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
              text: JSON.stringify(finalReview),
              createdAt: "2026-04-09T10:00:05.500Z",
            }),
          ],
        }),
      ],
      run: makeRun({ currentPhase: "reviewing", reviewIteration: 2 }),
    });

    expect(
      rows.map((row) => {
        if (row.kind === "separator") return row.summary;
        if (row.kind === "thread-block") {
          return row.messages[0]?.text ?? row.emptyStateText ?? row.id;
        }
        return row.id;
      }),
    ).toEqual([
      "Starting work on ticket",
      "Initial implementation",
      "Reviewing ticket T3CO-24",
      JSON.stringify({
        changesNeeded: true,
        summary: "Please make one more pass.",
        comments: [],
      }),
      "Addressed review feedback",
      "Reviewing ticket T3CO-24 again",
      JSON.stringify(finalReview),
      "Completed ticket",
      "working-indicator-row",
    ]);
  });

  it("splits repeated review blocks by review iteration and outcome", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "review-started-1",
          kind: "orchestration.run.ticket.review.started",
          summary: "Review started",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-requested",
          kind: "orchestration.run.ticket.review.requested-changes",
          summary: "Changes requested",
          createdAt: "2026-04-09T10:00:01.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review",
          reviewIteration: 1,
        }),
        makeActivity({
          id: "review-started-2",
          kind: "orchestration.run.ticket.review.started",
          summary: "Review started again",
          createdAt: "2026-04-09T10:00:02.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review",
          reviewIteration: 2,
        }),
        makeActivity({
          id: "review-approved",
          kind: "orchestration.run.ticket.review.approved",
          summary: "Approved",
          createdAt: "2026-04-09T10:00:03.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review",
          reviewIteration: 2,
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-review",
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
      run: makeRun({ currentPhase: "reviewing", reviewIteration: 2 }),
    });

    const reviewBlocks = rows.filter((row) => row.kind === "thread-block");
    expect(reviewBlocks).toHaveLength(2);
    expect(reviewBlocks[0]).toMatchObject({
      kind: "thread-block",
      sectionKind: "review",
      reviewIteration: 1,
      reviewOutcome: "requested-changes",
    });
    expect(reviewBlocks[1]).toMatchObject({
      kind: "thread-block",
      sectionKind: "review",
      reviewIteration: 2,
      reviewOutcome: "approved",
    });
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
          row.kind === "separator" && row.activityKind === "orchestration.run.ticket.started",
      ),
    ).toHaveLength(1);
  });

  it("keeps review completion state on blocks even when the outcome milestone is hidden", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "review-started",
          kind: "orchestration.run.ticket.review.started",
          summary: "Review started",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review",
          reviewIteration: 1,
          sequence: 1,
        }),
        makeActivity({
          id: "review-approved",
          kind: "orchestration.run.ticket.review.approved",
          summary: "Approved",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          reviewThreadId: "thread-review",
          reviewIteration: 1,
          sequence: 2,
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-review",
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

    expect(rows.map((row) => row.kind)).toEqual(["separator", "thread-block", "working"]);
    expect(rows[1]).toMatchObject({
      kind: "thread-block",
      sectionKind: "review",
      reviewOutcome: "approved",
    });
  });

  it("keeps working user messages but hides review prompts", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [],
      childThreads: [
        makeChildThread({
          id: "thread-impl",
          ticketId: "ticket-1",
          messages: [
            makeMessage("working-user", {
              role: "user",
              text: "Working follow-up",
              createdAt: "2026-04-09T10:00:00.000Z",
            }),
          ],
        }),
        makeChildThread({
          id: "thread-review",
          ticketId: "ticket-1",
          messages: [
            makeMessage("review-user", {
              role: "user",
              text: "Internal review prompt",
              createdAt: "2026-04-09T10:00:01.000Z",
              metadata: {
                origin: {
                  kind: "orchestration-prompt",
                  promptId: "review",
                  phase: "reviewing",
                  dispatchMode: "review",
                },
              },
            }),
            makeMessage("review-human", {
              role: "user",
              text: "Human follow-up in review thread",
              createdAt: "2026-04-09T10:00:02.000Z",
            }),
          ],
        }),
      ],
      run: makeRun(),
    });

    const blocks = rows.filter((row) => row.kind === "thread-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: "thread-block",
      sectionKind: "working",
      messages: [expect.objectContaining({ text: "Working follow-up" })],
    });
    expect(blocks[1]).toMatchObject({
      kind: "thread-block",
      sectionKind: "review",
      messages: [expect.objectContaining({ text: "Human follow-up in review thread" })],
    });
  });

  it("preserves ticket metadata on paused ticket milestones", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "ticket-paused",
          kind: "orchestration.run.paused",
          summary: "Ticket TEST-11 is blocked",
          createdAt: "2026-04-09T10:00:00.000Z",
          tone: "error",
          ticketId: "ticket-1",
          ticketIdentifier: "TEST-11",
        }),
      ],
      childThreads: [],
      run: makeRun({ status: "paused" }),
    });

    expect(rows[0]).toMatchObject({
      kind: "separator",
      summary: "Ticket TEST-11 is blocked",
      ticketIdentifier: "TEST-11",
    });
  });

  it("renders an old-style waiting implementation block when the active phase has no messages", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "run-started",
          kind: "orchestration.run.started",
          summary: "Orchestration started",
          createdAt: "2026-04-09T09:59:55.000Z",
        }),
        makeActivity({
          id: "ticket-started",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-impl",
        }),
      ],
      childThreads: [makeChildThread({ id: "thread-impl", ticketId: "ticket-1" })],
      run: makeRun({
        currentPhase: "working",
        updatedAt: "2026-04-09T10:00:05.000Z",
      }),
    });

    const waitingBlock = rows.find((row) => row.kind === "thread-block");
    expect(waitingBlock).toMatchObject({
      kind: "thread-block",
      sectionKind: "working",
      emptyStateText: "Waiting for agent response...",
      messages: [],
      isActive: true,
    });
    expect(rows.at(-1)).toMatchObject({
      kind: "working",
      createdAt: "2026-04-09T09:59:55.000Z",
    });
  });

  it("keeps waiting when the only working-phase message is a hidden orchestration prompt", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "ticket-started",
          kind: "orchestration.run.ticket.started",
          summary: "Starting work",
          createdAt: "2026-04-09T10:00:00.000Z",
          ticketId: "ticket-1",
          ticketIdentifier: "T3CO-24",
          workingThreadId: "thread-impl",
        }),
      ],
      childThreads: [
        makeChildThread({
          id: "thread-impl",
          ticketId: "ticket-1",
          messages: [
            makeMessage("resume-prompt", {
              role: "user",
              text: "Continue.",
              createdAt: "2026-04-09T10:00:01.000Z",
              metadata: {
                origin: {
                  kind: "orchestration-prompt",
                  promptId: "resume",
                  phase: "working",
                  dispatchMode: "resume",
                },
              },
            }),
          ],
        }),
      ],
      run: makeRun({
        currentPhase: "working",
        updatedAt: "2026-04-09T10:00:05.000Z",
      }),
    });

    const waitingBlock = rows.find((row) => row.kind === "thread-block");
    expect(waitingBlock).toMatchObject({
      kind: "thread-block",
      sectionKind: "working",
      emptyStateText: "Waiting for agent response...",
      messages: [],
      isActive: true,
    });
  });

  it("falls back to review thread labeling when review association is malformed", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [],
      childThreads: [
        makeChildThread({
          id: "thread-review",
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

    const reviewBlock = rows.find((row) => row.kind === "thread-block");
    expect(reviewBlock).toMatchObject({
      kind: "thread-block",
      sectionKind: "review",
      reviewIteration: 1,
    });
  });

  it("uses the latest resume event for the orchestration working timer", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "run-started",
          kind: "orchestration.run.started",
          summary: "Orchestration started",
          createdAt: "2026-04-09T10:00:00.000Z",
        }),
        makeActivity({
          id: "run-paused",
          kind: "orchestration.run.paused",
          summary: "Orchestration paused",
          createdAt: "2026-04-09T10:02:00.000Z",
        }),
        makeActivity({
          id: "run-resumed",
          kind: "orchestration.run.resumed",
          summary: "Orchestration resumed",
          createdAt: "2026-04-09T10:03:00.000Z",
        }),
      ],
      childThreads: [],
      run: makeRun({
        updatedAt: "2026-04-09T10:03:30.000Z",
      }),
    });

    expect(rows.at(-1)).toMatchObject({
      kind: "working",
      createdAt: "2026-04-09T10:03:00.000Z",
    });
  });

  it("omits the orchestration working timer when the run is paused", () => {
    const rows = buildOrchestrationTimelineRows({
      parentActivities: [
        makeActivity({
          id: "run-started",
          kind: "orchestration.run.started",
          summary: "Orchestration started",
          createdAt: "2026-04-09T10:00:00.000Z",
        }),
      ],
      childThreads: [],
      run: makeRun({
        status: "paused",
      }),
    });

    expect(rows.some((row) => row.kind === "working")).toBe(false);
  });
});
