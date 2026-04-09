import type { OrchestrationRun, TicketId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrchestrationProgressHeader } from "./OrchestrationProgressHeader";

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
    currentPhase: "reviewing",
    reviewIteration: 1,
    maxReviewIterations: 3,
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("OrchestrationProgressHeader", () => {
  it("shows review iteration context while review is active", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun()}
        onPause={() => {}}
        onResume={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Reviewing ticket 1 of 1");
    expect(markup).toContain("Review 2");
  });
});
