import type { OrchestrationRun, TicketId, ThreadId, TicketSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import { buildOrchestrationSwitcherItems } from "./useOrchestrationSwitcher.logic";

function makeThread(input: {
  id: string;
  ticketId: string;
  title: string;
  messages?: Thread["messages"];
}): Thread {
  return {
    id: input.id as ThreadId,
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: input.title,
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
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    isOrchestrationThread: false,
    parentThreadId: "parent-thread" as ThreadId,
    ticketId: input.ticketId as TicketId,
  } as Thread;
}

function makeRun(): OrchestrationRun {
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
    currentPhase: "reviewing",
    reviewIteration: 1,
    maxReviewIterations: 3,
    promptOverrides: {},
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
  };
}

describe("buildOrchestrationSwitcherItems", () => {
  it("groups working and review threads adjacently using explicit reviewThreadId", () => {
    const ticket = {
      id: "ticket-1" as TicketId,
      identifier: "T3CO-24",
      title: "Review UI",
    } as TicketSummary;

    const items = buildOrchestrationSwitcherItems({
      run: makeRun(),
      parentThreadId: "parent-thread",
      parentTitle: "Orchestration",
      isParent: false,
      childThreads: [
        makeThread({
          id: "thread-1",
          ticketId: "ticket-1",
          title: "Review UI",
          messages: [],
        }),
        makeThread({
          id: "thread-review-1",
          ticketId: "ticket-1",
          title: "Review UI Review",
          messages: [],
        }),
      ],
      ticketById: new Map([[ticket.id, ticket]]),
      activeThreadId: "thread-review-1",
    });

    expect(
      items.map((item) => ({ kind: item.kind, label: item.label, isStarted: item.isStarted })),
    ).toEqual([
      { kind: "timeline", label: "Timeline", isStarted: true },
      { kind: "working-thread", label: "T3CO-24", isStarted: true },
      { kind: "review-thread", label: "T3CO-24 Review", isStarted: true },
    ]);
    expect(items[2]).toMatchObject({
      kind: "review-thread",
      isActive: true,
      threadId: "thread-review-1",
    });
  });

  it("omits the review item when the run has no reviewThreadId", () => {
    const ticket = {
      id: "ticket-1" as TicketId,
      identifier: "T3CO-24",
      title: "Review UI",
    } as TicketSummary;

    const items = buildOrchestrationSwitcherItems({
      run: {
        ...makeRun(),
        currentPhase: "working",
        reviewIteration: 0,
        maxReviewIterations: 0,
        ticketOrder: [
          {
            ticketId: "ticket-1" as TicketId,
            workingThreadId: "thread-1" as ThreadId,
          },
        ],
      },
      parentThreadId: "parent-thread",
      parentTitle: "Orchestration",
      isParent: false,
      childThreads: [
        makeThread({
          id: "thread-1",
          ticketId: "ticket-1",
          title: "Review UI",
          messages: [],
        }),
      ],
      ticketById: new Map([[ticket.id, ticket]]),
      activeThreadId: "thread-1",
    });

    expect(items.map((item) => ({ kind: item.kind, label: item.label }))).toEqual([
      { kind: "timeline", label: "Timeline" },
      { kind: "working-thread", label: "T3CO-24" },
    ]);
  });
});
