import type { AcceptanceCriterion } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildCriteriaAfterAdd,
  buildCriteriaAfterDelete,
  buildCriteriaAfterEdit,
  TicketAcceptanceCriteria,
} from "./TicketAcceptanceCriteria";

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

const SAMPLE: ReadonlyArray<AcceptanceCriterion> = [
  { text: "First criterion", status: "met" },
  { text: "Second criterion", status: "pending" },
  { text: "Third criterion", status: "not_met" },
];

describe("buildCriteriaAfterEdit", () => {
  it("replaces text at the given index", () => {
    const result = buildCriteriaAfterEdit(SAMPLE, 1, "Updated text");
    expect(result[1]!.text).toBe("Updated text");
    expect(result[1]!.status).toBe("pending");
    expect(result[0]!.text).toBe("First criterion");
    expect(result).toHaveLength(3);
  });

  it("does not mutate the original array", () => {
    const result = buildCriteriaAfterEdit(SAMPLE, 0, "Changed");
    expect(SAMPLE[0]!.text).toBe("First criterion");
    expect(result[0]!.text).toBe("Changed");
  });
});

describe("buildCriteriaAfterDelete", () => {
  it("removes the item at the given index", () => {
    const result = buildCriteriaAfterDelete(SAMPLE, 1);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("First criterion");
    expect(result[1]!.text).toBe("Third criterion");
  });
});

describe("buildCriteriaAfterAdd", () => {
  it("appends a new pending criterion", () => {
    const result = buildCriteriaAfterAdd(SAMPLE, "Fourth criterion");
    expect(result).toHaveLength(4);
    expect(result[3]!.text).toBe("Fourth criterion");
    expect(result[3]!.status).toBe("pending");
  });

  it("preserves existing criteria", () => {
    const result = buildCriteriaAfterAdd(SAMPLE, "New");
    expect(result[0]!.text).toBe("First criterion");
    expect(result[0]!.status).toBe("met");
  });
});

// ---------------------------------------------------------------------------
// Render tests (SSR-safe via renderToStaticMarkup)
// ---------------------------------------------------------------------------

// Stub out resolveInlineEditBlurAction — only used in interactive paths.
vi.mock("../management/KanbanTicketDetail", () => ({
  resolveInlineEditBlurAction: () => "ignore" as const,
}));

const DEFAULT_PROPS = {
  ticketId: "ticket-1" as unknown as import("@t3tools/contracts").TicketId,
  onUpdated: () => undefined,
  onCriteriaChange: async (_next: AcceptanceCriterion[]) => undefined,
};

describe("TicketAcceptanceCriteria rendering", () => {
  it("renders empty state when criteria is empty", () => {
    const html = renderToStaticMarkup(
      <TicketAcceptanceCriteria {...DEFAULT_PROPS} criteria={[]} />,
    );
    expect(html).toContain("No acceptance criteria defined.");
    expect(html).toContain("Add");
  });

  it("renders criteria with counter", () => {
    const html = renderToStaticMarkup(
      <TicketAcceptanceCriteria {...DEFAULT_PROPS} criteria={SAMPLE} />,
    );
    expect(html).toContain("(1/3)");
    expect(html).toContain("First criterion");
    expect(html).toContain("Second criterion");
    expect(html).toContain("Third criterion");
  });

  it("applies line-through for met criteria", () => {
    const html = renderToStaticMarkup(
      <TicketAcceptanceCriteria
        {...DEFAULT_PROPS}
        criteria={[{ text: "Done item", status: "met" }]}
      />,
    );
    expect(html).toContain("line-through");
  });

  it("applies destructive color for not_met criteria", () => {
    const html = renderToStaticMarkup(
      <TicketAcceptanceCriteria
        {...DEFAULT_PROPS}
        criteria={[{ text: "Failed item", status: "not_met" }]}
      />,
    );
    expect(html).toContain("text-destructive");
  });

  it("renders reason when present", () => {
    const html = renderToStaticMarkup(
      <TicketAcceptanceCriteria
        {...DEFAULT_PROPS}
        criteria={[{ text: "Item", status: "met", reason: "Looks good" }]}
      />,
    );
    expect(html).toContain("Looks good");
  });
});
