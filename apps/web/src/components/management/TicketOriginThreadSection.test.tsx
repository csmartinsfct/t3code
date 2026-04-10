import type { TicketLinkedThread } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TicketOriginThreadSection } from "./TicketOriginThreadSection";

function makeThread(overrides: Partial<TicketLinkedThread> = {}): TicketLinkedThread {
  return {
    threadId: "thread-1" as TicketLinkedThread["threadId"],
    title: "Orchestration JSON Parsing Regression",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    archivedAt: "2026-04-10T09:00:00.000Z",
    isOrchestrationThread: true,
    parentThreadId: null,
    linkedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("TicketOriginThreadSection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders only the origin thread metadata inline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T22:00:00.000Z"));

    const markup = renderToStaticMarkup(
      <TicketOriginThreadSection thread={makeThread()} onOpenThread={() => {}} />,
    );

    expect(markup).toContain("Origin Thread");
    expect(markup).toContain("Orchestration JSON Parsing Regression");
    expect(markup).toContain("Archived");
    expect(markup).toContain("Review");
    expect(markup).toContain("12h ago");
    expect(markup).toContain("lucide-clock-3");
    expect(markup).not.toContain(">Origin</");
    expect(markup).not.toContain("Mentioned");
    expect(markup).not.toContain("Ticket thread");
    expect(markup).not.toContain("Related Threads");
  });
});
