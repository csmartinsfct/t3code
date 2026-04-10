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
        centerLabel="Fix sidebar"
        onPause={() => {}}
        onResume={() => {}}
        onResumeWithFreshAgent={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Running");
    expect(markup).toContain("0/1");
    expect(markup).toContain("Fix sidebar");
  });

  it("shows completed count when finished", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun({ status: "completed", currentTicketIndex: 0 })}
        centerLabel="Timeline"
        onPause={() => {}}
        onResume={() => {}}
        onResumeWithFreshAgent={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Completed");
    expect(markup).toContain("1/1");
    expect(markup).toContain("Timeline");
  });

  it("omits the ticket label when none is provided", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun({
          currentPhase: "working",
          reviewIteration: 0,
          maxReviewIterations: 0,
          ticketOrder: [
            {
              ticketId: "ticket-1" as TicketId,
              workingThreadId: "thread-1" as ThreadId,
            },
          ],
        })}
        centerLabel={null}
        onPause={() => {}}
        onResume={() => {}}
        onResumeWithFreshAgent={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).not.toContain("ORCH-1");
    expect(markup).not.toContain("Automated review disabled");
  });

  it("renders resume split controls when paused", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun({ status: "paused", currentPhase: "working" })}
        centerLabel="Fix sidebar"
        onPause={() => {}}
        onResume={() => {}}
        onResumeWithFreshAgent={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("Resume");
    expect(markup).toContain("Resume options");
  });

  it("renders the centered label as a button when clickable", () => {
    const markup = renderToStaticMarkup(
      <OrchestrationProgressHeader
        run={makeRun()}
        centerLabel="Fix sidebar"
        onCenterLabelClick={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onResumeWithFreshAgent={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('title="Fix sidebar"');
  });
});
