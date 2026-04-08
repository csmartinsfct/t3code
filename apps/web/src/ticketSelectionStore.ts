/**
 * Zustand store for Kanban ticket multi-selection state.
 *
 * Supports Shift+Click (toggle individual) and bulk drag-to-chat.
 * Shared between board cards and ticket-detail sub-tickets — they are
 * never visible simultaneously, so one store suffices.
 */

import type { TicketId, TicketSummary } from "@t3tools/contracts";
import { create } from "zustand";

export interface TicketSelectionState {
  /** Currently selected ticket IDs. */
  selectedTicketIds: ReadonlySet<TicketId>;
  /** Resolved ticket summaries keyed by ID (stays in sync with selectedTicketIds). */
  selectedTickets: ReadonlyMap<TicketId, TicketSummary>;
  /** The ticket ID that anchors shift-click range selection. */
  anchorTicketId: TicketId | null;
}

interface TicketSelectionStore extends TicketSelectionState {
  /** Toggle a single ticket in the selection (Shift+Click). */
  toggleTicket: (ticketId: TicketId, ticket: TicketSummary) => void;
  /**
   * Select a range of tickets (Shift+Click with anchor).
   * Requires the ordered list of tickets so the store can compute
   * which tickets fall between anchor and target.
   */
  rangeSelectTo: (ticketId: TicketId, orderedTickets: readonly TicketSummary[]) => void;
  /** Clear all selection state. */
  clearSelection: () => void;
  /** Remove specific ticket IDs from the selection (e.g. after deletion). */
  removeFromSelection: (ticketIds: readonly TicketId[]) => void;
  /** Set the anchor ticket without adding it to the selection. */
  setAnchor: (ticketId: TicketId) => void;
  /** Check if any tickets are selected. */
  hasSelection: () => boolean;
}

const EMPTY_ID_SET = new Set<TicketId>();
const EMPTY_TICKET_MAP = new Map<TicketId, TicketSummary>();

export const useTicketSelectionStore = create<TicketSelectionStore>((set, get) => ({
  selectedTicketIds: EMPTY_ID_SET,
  selectedTickets: EMPTY_TICKET_MAP,
  anchorTicketId: null,

  toggleTicket: (ticketId, ticket) => {
    set((state) => {
      const nextIds = new Set(state.selectedTicketIds);
      const nextMap = new Map(state.selectedTickets);
      if (nextIds.has(ticketId)) {
        nextIds.delete(ticketId);
        nextMap.delete(ticketId);
      } else {
        nextIds.add(ticketId);
        nextMap.set(ticketId, ticket);
      }
      return {
        selectedTicketIds: nextIds,
        selectedTickets: nextMap,
        anchorTicketId: nextIds.has(ticketId) ? ticketId : state.anchorTicketId,
      };
    });
  },

  rangeSelectTo: (ticketId, orderedTickets) => {
    set((state) => {
      const anchor = state.anchorTicketId;
      if (anchor === null) {
        const target = orderedTickets.find((t) => t.id === ticketId);
        if (!target) return state;
        const nextIds = new Set(state.selectedTicketIds);
        const nextMap = new Map(state.selectedTickets);
        nextIds.add(ticketId);
        nextMap.set(ticketId, target);
        return { selectedTicketIds: nextIds, selectedTickets: nextMap, anchorTicketId: ticketId };
      }

      const anchorIndex = orderedTickets.findIndex((t) => t.id === anchor);
      const targetIndex = orderedTickets.findIndex((t) => t.id === ticketId);
      if (anchorIndex === -1 || targetIndex === -1) {
        const target = orderedTickets.find((t) => t.id === ticketId);
        if (!target) return state;
        const nextIds = new Set(state.selectedTicketIds);
        const nextMap = new Map(state.selectedTickets);
        nextIds.add(ticketId);
        nextMap.set(ticketId, target);
        return { selectedTicketIds: nextIds, selectedTickets: nextMap, anchorTicketId: ticketId };
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const nextIds = new Set(state.selectedTicketIds);
      const nextMap = new Map(state.selectedTickets);
      for (let i = start; i <= end; i++) {
        const t = orderedTickets[i];
        if (t !== undefined) {
          nextIds.add(t.id);
          nextMap.set(t.id, t);
        }
      }
      return { selectedTicketIds: nextIds, selectedTickets: nextMap, anchorTicketId: anchor };
    });
  },

  clearSelection: () => {
    const state = get();
    if (state.selectedTicketIds.size === 0 && state.anchorTicketId === null) return;
    set({
      selectedTicketIds: EMPTY_ID_SET,
      selectedTickets: EMPTY_TICKET_MAP,
      anchorTicketId: null,
    });
  },

  setAnchor: (ticketId) => {
    if (get().anchorTicketId === ticketId) return;
    set({ anchorTicketId: ticketId });
  },

  removeFromSelection: (ticketIds) => {
    set((state) => {
      const toRemove = new Set(ticketIds);
      let changed = false;
      const nextIds = new Set<TicketId>();
      const nextMap = new Map<TicketId, TicketSummary>();
      for (const id of state.selectedTicketIds) {
        if (toRemove.has(id)) {
          changed = true;
        } else {
          nextIds.add(id);
          const ticket = state.selectedTickets.get(id);
          if (ticket) nextMap.set(id, ticket);
        }
      }
      if (!changed) return state;
      const newAnchor =
        state.anchorTicketId !== null && toRemove.has(state.anchorTicketId)
          ? null
          : state.anchorTicketId;
      return { selectedTicketIds: nextIds, selectedTickets: nextMap, anchorTicketId: newAnchor };
    });
  },

  hasSelection: () => get().selectedTicketIds.size > 0,
}));
