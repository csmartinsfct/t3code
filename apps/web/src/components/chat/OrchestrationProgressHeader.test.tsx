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
  it("renders status badge and progress counter", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun()}
        currentTicketLabel="ORCH-1 — Fix sidebar"
        onPause={() => {}}
        onResume={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Running");
    expect(markup).toContain("0/1");
    expect(markup).toContain("ORCH-1");
  });

  it("shows completed count when finished", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun({ status: "completed", currentTicketIndex: 0 })}
        currentTicketLabel={null}
        onPause={() => {}}
        onResume={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Completed");
    expect(markup).toContain("1/1");
  });
});
