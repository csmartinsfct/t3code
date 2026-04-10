import "../../index.css";

import type { Ticket, TicketId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SubTicketPreviewContent } from "./SubTicketPreviewContent";

// Audit traceability: 5f27fa2, 5dba42d.
// This file covers the browser-only hover preview flow that KanbanTicketDetail wires around
// SubTicketPreviewContent, without mounting the full ticket detail surface.

vi.mock("./TicketMarkdown", () => ({
  TicketMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

function makePreviewTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "child-ticket" as Ticket["id"],
    projectId: "project-1" as Ticket["projectId"],
    parentId: "parent-ticket" as Ticket["id"],
    ticketNumber: 202,
    identifier: "T3CO-202",
    title: "Preview child ticket",
    description: "Fetched preview description",
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    implementerModelOverride: null,
    reviewerModelOverride: null,
    acceptanceCriteria: [
      { text: "First preview criterion", status: "met" },
      { text: "Second preview criterion", status: "pending" },
    ],
    labels: [],
    dependencies: [],
    subTickets: [],
    comments: [],
    artifacts: [],
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

function DeferredPreviewHarness({
  fetchPreview,
  getCached,
}: {
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        render={
          <button type="button" className="rounded-md px-2 py-1.5 text-left text-xs">
            T3CO-202 Preview child ticket
          </button>
        }
      />
      <PopoverPopup
        side="bottom"
        align="end"
        alignOffset={-190}
        sideOffset={4}
        className="w-[380px]"
      >
        <SubTicketPreviewContent
          ticketId={"child-ticket" as Ticket["id"]}
          fetchPreview={fetchPreview}
          getCached={getCached}
        />
      </PopoverPopup>
    </Popover>
  );
}

async function mountPreviewHarness(input: {
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached?: (id: TicketId) => Ticket | undefined;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <DeferredPreviewHarness
      fetchPreview={input.fetchPreview}
      getCached={input.getCached ?? (() => undefined)}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("KanbanTicketDetail sub-ticket preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("opens the hover preview after the delay, fetches sub-ticket detail, and renders description plus acceptance criteria", async () => {
    let resolvePreview: ((ticket: Ticket | null) => void) | null = null;
    const fetchPreview = vi.fn(
      () =>
        new Promise<Ticket | null>((resolve) => {
          resolvePreview = resolve;
        }),
    );

    await using _ = await mountPreviewHarness({ fetchPreview });

    vi.useFakeTimers();

    const subTicketTrigger = page.getByRole("button", { name: /T3CO-202 Preview child ticket/i });
    await subTicketTrigger.hover();

    await vi.advanceTimersByTimeAsync(299);
    expect(fetchPreview).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toContain("Fetched preview description");

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(fetchPreview).toHaveBeenCalledTimes(1);
    });
    expect(fetchPreview).toHaveBeenCalledWith("child-ticket");

    expect(resolvePreview).not.toBeNull();
    resolvePreview!(makePreviewTicket());

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Fetched preview description");
      expect(text).toContain("Acceptance Criteria (1/2)");
      expect(text).toContain("First preview criterion");
      expect(text).toContain("Second preview criterion");
    });
  });
});
