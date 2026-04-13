import { describe, expect, it } from "vitest";

/**
 * TicketDescriptionEditor wraps Tiptap which requires a real browser DOM.
 * Integration tests live in the browser test suite (KanbanTicketDetail.browser.tsx).
 *
 * This file validates that the module can be imported without errors and that the
 * component export exists — enough to catch broken imports or missing dependencies.
 */
describe("TicketDescriptionEditor", () => {
  it("exports TicketDescriptionEditor component", async () => {
    const mod = await import("./TicketDescriptionEditor");
    expect(mod.TicketDescriptionEditor).toBeDefined();
    expect(typeof mod.TicketDescriptionEditor).toBe("function");
  });
});
