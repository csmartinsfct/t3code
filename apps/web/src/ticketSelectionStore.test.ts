import type { TicketSummary } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useTicketSelectionStore } from "./ticketSelectionStore";

// Audit traceability: b6dd6a5.

function makeTicket(
  id: string,
  ticketNumber: number,
  overrides: Partial<TicketSummary> = {},
): TicketSummary {
  return {
    id: id as TicketSummary["id"],
    projectId: "project-1" as TicketSummary["projectId"],
    parentId: null,
    ticketNumber,
    identifier: `T3CO-${ticketNumber}`,
    title: `Ticket ${ticketNumber}`,
    status: "todo",
    priority: "medium",
    sortOrder: ticketNumber,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

const TICKET_A = makeTicket("ticket-a", 1);
const TICKET_B = makeTicket("ticket-b", 2);
const TICKET_C = makeTicket("ticket-c", 3);
const TICKET_D = makeTicket("ticket-d", 4);
const TICKET_E = makeTicket("ticket-e", 5);

const ORDERED = [TICKET_A, TICKET_B, TICKET_C, TICKET_D, TICKET_E] as const;

describe("ticketSelectionStore", () => {
  beforeEach(() => {
    useTicketSelectionStore.getState().clearSelection();
  });

  describe("toggleTicket", () => {
    it("stores the selected ticket summary and updates the anchor", () => {
      useTicketSelectionStore.getState().toggleTicket(TICKET_B.id, TICKET_B);

      const state = useTicketSelectionStore.getState();
      expect(state.selectedTicketIds.has(TICKET_B.id)).toBe(true);
      expect(state.selectedTickets.get(TICKET_B.id)).toEqual(TICKET_B);
      expect(state.anchorTicketId).toBe(TICKET_B.id);
    });
  });

  describe("rangeSelectTo", () => {
    it("selects the full anchor-to-target range and keeps ticket summaries in sync", () => {
      const store = useTicketSelectionStore.getState();
      store.toggleTicket(TICKET_B.id, TICKET_B);

      store.rangeSelectTo(TICKET_D.id, ORDERED);

      const state = useTicketSelectionStore.getState();
      expect(Array.from(state.selectedTicketIds)).toEqual([TICKET_B.id, TICKET_C.id, TICKET_D.id]);
      expect(Array.from(state.selectedTickets.keys())).toEqual([
        TICKET_B.id,
        TICKET_C.id,
        TICKET_D.id,
      ]);
      expect(state.selectedTickets.get(TICKET_C.id)).toEqual(TICKET_C);
      expect(state.anchorTicketId).toBe(TICKET_B.id);
    });

    it("preserves previously selected tickets outside the new range", () => {
      const store = useTicketSelectionStore.getState();
      store.toggleTicket(TICKET_A.id, TICKET_A);
      store.toggleTicket(TICKET_B.id, TICKET_B);

      store.rangeSelectTo(TICKET_D.id, ORDERED);

      const state = useTicketSelectionStore.getState();
      expect(Array.from(state.selectedTicketIds)).toEqual([
        TICKET_A.id,
        TICKET_B.id,
        TICKET_C.id,
        TICKET_D.id,
      ]);
      expect(state.selectedTickets.get(TICKET_A.id)).toEqual(TICKET_A);
      expect(state.selectedTickets.get(TICKET_D.id)).toEqual(TICKET_D);
    });

    it("falls back to selecting the target and resetting the anchor when the current anchor is missing", () => {
      const store = useTicketSelectionStore.getState();
      store.toggleTicket(TICKET_A.id, TICKET_A);

      store.rangeSelectTo(TICKET_C.id, [TICKET_B, TICKET_C, TICKET_D]);

      const state = useTicketSelectionStore.getState();
      expect(state.selectedTicketIds.has(TICKET_A.id)).toBe(true);
      expect(state.selectedTicketIds.has(TICKET_C.id)).toBe(true);
      expect(state.selectedTickets.get(TICKET_C.id)).toEqual(TICKET_C);
      expect(state.anchorTicketId).toBe(TICKET_C.id);
    });
  });

  describe("removeFromSelection", () => {
    it("removes the ticket summary alongside the selected id", () => {
      const store = useTicketSelectionStore.getState();
      store.toggleTicket(TICKET_B.id, TICKET_B);
      store.toggleTicket(TICKET_C.id, TICKET_C);

      store.removeFromSelection([TICKET_B.id]);

      const state = useTicketSelectionStore.getState();
      expect(state.selectedTicketIds.has(TICKET_B.id)).toBe(false);
      expect(state.selectedTickets.has(TICKET_B.id)).toBe(false);
      expect(state.selectedTickets.get(TICKET_C.id)).toEqual(TICKET_C);
    });
  });

  describe("hasSelection", () => {
    it("returns false after clearing the selection state", () => {
      const store = useTicketSelectionStore.getState();
      store.toggleTicket(TICKET_E.id, TICKET_E);
      store.clearSelection();

      expect(useTicketSelectionStore.getState().hasSelection()).toBe(false);
    });
  });
});
