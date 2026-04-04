/**
 * Zustand store for message multi-selection state within a thread.
 *
 * Supports right-click context menu for single/batch message deletion,
 * Cmd/Ctrl+Click (toggle individual), Shift+Click (range select),
 * and Escape to exit selection mode.
 *
 * Modeled on `threadSelectionStore.ts`.
 */

import type { MessageId } from "@t3tools/contracts";
import { create } from "zustand";

export interface MessageSelectionState {
  /** Whether message selection mode is active (shows checkboxes). */
  selectionMode: boolean;
  /** Currently selected message IDs. */
  selectedMessageIds: ReadonlySet<MessageId>;
  /** The message ID that anchors shift-click range selection. */
  anchorMessageId: MessageId | null;
}

interface MessageSelectionStore extends MessageSelectionState {
  /** Enter selection mode with an initial message selected. */
  enterSelectionMode: (initialMessageId: MessageId) => void;
  /** Exit selection mode and clear all selection state. */
  exitSelectionMode: () => void;
  /** Toggle a single message in the selection. */
  toggleMessage: (messageId: MessageId) => void;
  /**
   * Select a range of messages (Shift+Click).
   * Requires the ordered list of message IDs in the thread
   * so the store can compute which messages fall between anchor and target.
   */
  rangeSelectTo: (messageId: MessageId, orderedMessageIds: readonly MessageId[]) => void;
  /** Clear the selection set but stay in selection mode. */
  clearSelection: () => void;
  /** Remove specific message IDs from the selection (e.g. after deletion). */
  removeFromSelection: (messageIds: readonly MessageId[]) => void;
  /** Check if any messages are selected. */
  hasSelection: () => boolean;
}

const EMPTY_SET = new Set<MessageId>();

export const useMessageSelectionStore = create<MessageSelectionStore>((set, get) => ({
  selectionMode: false,
  selectedMessageIds: EMPTY_SET,
  anchorMessageId: null,

  enterSelectionMode: (initialMessageId) => {
    const next = new Set<MessageId>();
    next.add(initialMessageId);
    set({
      selectionMode: true,
      selectedMessageIds: next,
      anchorMessageId: initialMessageId,
    });
  },

  exitSelectionMode: () => {
    const state = get();
    if (
      !state.selectionMode &&
      state.selectedMessageIds.size === 0 &&
      state.anchorMessageId === null
    )
      return;
    set({
      selectionMode: false,
      selectedMessageIds: EMPTY_SET,
      anchorMessageId: null,
    });
  },

  toggleMessage: (messageId) => {
    set((state) => {
      const next = new Set(state.selectedMessageIds);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return {
        selectedMessageIds: next,
        anchorMessageId: next.has(messageId) ? messageId : state.anchorMessageId,
      };
    });
  },

  rangeSelectTo: (messageId, orderedMessageIds) => {
    set((state) => {
      const anchor = state.anchorMessageId;
      if (anchor === null) {
        // No anchor yet — treat as a single toggle
        const next = new Set(state.selectedMessageIds);
        next.add(messageId);
        return { selectedMessageIds: next, anchorMessageId: messageId };
      }

      const anchorIndex = orderedMessageIds.indexOf(anchor);
      const targetIndex = orderedMessageIds.indexOf(messageId);
      if (anchorIndex === -1 || targetIndex === -1) {
        // Anchor or target not in this list — fallback to toggle
        const next = new Set(state.selectedMessageIds);
        next.add(messageId);
        return { selectedMessageIds: next, anchorMessageId: messageId };
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const next = new Set(state.selectedMessageIds);
      for (let i = start; i <= end; i++) {
        const id = orderedMessageIds[i];
        if (id !== undefined) {
          next.add(id);
        }
      }
      // Keep anchor stable so subsequent shift-clicks extend from the same point
      return { selectedMessageIds: next, anchorMessageId: anchor };
    });
  },

  clearSelection: () => {
    const state = get();
    if (state.selectedMessageIds.size === 0 && state.anchorMessageId === null) return;
    set({ selectedMessageIds: EMPTY_SET, anchorMessageId: null });
  },

  removeFromSelection: (messageIds) => {
    set((state) => {
      const toRemove = new Set(messageIds);
      let changed = false;
      const next = new Set<MessageId>();
      for (const id of state.selectedMessageIds) {
        if (toRemove.has(id)) {
          changed = true;
        } else {
          next.add(id);
        }
      }
      if (!changed) return state;
      const newAnchor =
        state.anchorMessageId !== null && toRemove.has(state.anchorMessageId)
          ? null
          : state.anchorMessageId;
      return { selectedMessageIds: next, anchorMessageId: newAnchor };
    });
  },

  hasSelection: () => get().selectedMessageIds.size > 0,
}));
