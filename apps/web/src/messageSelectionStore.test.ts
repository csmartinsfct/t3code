import { MessageId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useMessageSelectionStore } from "./messageSelectionStore";

const MSG_A = MessageId.makeUnsafe("msg-a");
const MSG_B = MessageId.makeUnsafe("msg-b");
const MSG_C = MessageId.makeUnsafe("msg-c");
const MSG_D = MessageId.makeUnsafe("msg-d");
const MSG_E = MessageId.makeUnsafe("msg-e");

const ORDERED = [MSG_A, MSG_B, MSG_C, MSG_D, MSG_E] as const;

describe("messageSelectionStore", () => {
  beforeEach(() => {
    useMessageSelectionStore.getState().exitSelectionMode();
  });

  describe("enterSelectionMode", () => {
    it("enters selection mode with an initial message selected", () => {
      useMessageSelectionStore.getState().enterSelectionMode(MSG_A);

      const state = useMessageSelectionStore.getState();
      expect(state.selectionMode).toBe(true);
      expect(state.selectedMessageIds.has(MSG_A)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(1);
      expect(state.anchorMessageId).toBe(MSG_A);
    });
  });

  describe("exitSelectionMode", () => {
    it("exits selection mode and clears all state", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B);
      store.exitSelectionMode();

      const state = useMessageSelectionStore.getState();
      expect(state.selectionMode).toBe(false);
      expect(state.selectedMessageIds.size).toBe(0);
      expect(state.anchorMessageId).toBeNull();
    });

    it("is a no-op when already inactive and empty", () => {
      const stateBefore = useMessageSelectionStore.getState();
      stateBefore.exitSelectionMode();
      const stateAfter = useMessageSelectionStore.getState();

      expect(stateAfter.selectedMessageIds).toBe(stateBefore.selectedMessageIds);
    });
  });

  describe("toggleMessage", () => {
    it("adds a message to empty selection", () => {
      useMessageSelectionStore.getState().enterSelectionMode(MSG_A);
      useMessageSelectionStore.getState().toggleMessage(MSG_B);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_A)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(2);
      expect(state.anchorMessageId).toBe(MSG_B);
    });

    it("removes a message that is already selected", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_A);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_A)).toBe(false);
      expect(state.selectedMessageIds.size).toBe(0);
    });

    it("preserves existing selections when toggling a new message", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_A)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(2);
    });

    it("sets anchor to the newly added message", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B);

      expect(useMessageSelectionStore.getState().anchorMessageId).toBe(MSG_B);
    });

    it("preserves anchor when deselecting a non-anchor message", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B);
      store.toggleMessage(MSG_A); // deselect A, anchor should stay B

      expect(useMessageSelectionStore.getState().anchorMessageId).toBe(MSG_B);
    });
  });

  describe("rangeSelectTo", () => {
    it("selects a single message when no anchor exists", () => {
      useMessageSelectionStore.getState().rangeSelectTo(MSG_C, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(1);
      expect(state.anchorMessageId).toBe(MSG_C);
    });

    it("selects range from anchor to target (forward)", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_B);
      store.rangeSelectTo(MSG_D, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_D)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(3);
    });

    it("selects range from anchor to target (backward)", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_D);
      store.rangeSelectTo(MSG_B, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_D)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(3);
    });

    it("keeps anchor stable across multiple range selects", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_B);
      store.rangeSelectTo(MSG_D, ORDERED);
      store.rangeSelectTo(MSG_E, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.anchorMessageId).toBe(MSG_B);
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_D)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_E)).toBe(true);
    });

    it("falls back to toggle when anchor is not in the ordered list", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      // Range-select with a list that does NOT contain the anchor
      store.rangeSelectTo(MSG_C, [MSG_B, MSG_C, MSG_D]);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.anchorMessageId).toBe(MSG_C);
    });

    it("falls back to toggle when target is not in the ordered list", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_B);
      const unknownMsg = MessageId.makeUnsafe("msg-unknown");
      store.rangeSelectTo(unknownMsg, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(unknownMsg)).toBe(true);
      expect(state.anchorMessageId).toBe(unknownMsg);
    });

    it("selects the single message when anchor equals target", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_C);
      store.rangeSelectTo(MSG_C, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(1);
    });

    it("preserves previously selected messages outside the range", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B); // select B, anchor = B

      // Now shift-select from B (anchor) to D — should add B, C, D but keep A
      store.rangeSelectTo(MSG_D, ORDERED);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_A)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_C)).toBe(true);
      expect(state.selectedMessageIds.has(MSG_D)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(4);
    });
  });

  describe("clearSelection", () => {
    it("clears all selected messages and anchor", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B);
      store.clearSelection();

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.size).toBe(0);
      expect(state.anchorMessageId).toBeNull();
      // Still in selection mode after clear (unlike exitSelectionMode)
      expect(state.selectionMode).toBe(true);
    });

    it("is a no-op when already empty", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.clearSelection();
      const stateBefore = useMessageSelectionStore.getState();
      store.clearSelection();
      const stateAfter = useMessageSelectionStore.getState();

      expect(stateAfter.selectedMessageIds).toBe(stateBefore.selectedMessageIds);
    });
  });

  describe("removeFromSelection", () => {
    it("removes specified messages from selection", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B);
      store.toggleMessage(MSG_C);
      store.removeFromSelection([MSG_A, MSG_C]);

      const state = useMessageSelectionStore.getState();
      expect(state.selectedMessageIds.has(MSG_B)).toBe(true);
      expect(state.selectedMessageIds.size).toBe(1);
    });

    it("clears anchor when the anchor message is removed", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B); // anchor = B
      store.removeFromSelection([MSG_B]);

      expect(useMessageSelectionStore.getState().anchorMessageId).toBeNull();
    });

    it("preserves anchor when the anchor message is not removed", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.toggleMessage(MSG_B); // anchor = B
      store.removeFromSelection([MSG_A]);

      expect(useMessageSelectionStore.getState().anchorMessageId).toBe(MSG_B);
    });

    it("is a no-op when none of the specified messages are selected", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      const stateBefore = useMessageSelectionStore.getState();
      store.removeFromSelection([MSG_B, MSG_C]);
      const stateAfter = useMessageSelectionStore.getState();

      expect(stateAfter.selectedMessageIds).toBe(stateBefore.selectedMessageIds);
    });
  });

  describe("hasSelection", () => {
    it("returns false when nothing is selected", () => {
      expect(useMessageSelectionStore.getState().hasSelection()).toBe(false);
    });

    it("returns true when messages are selected", () => {
      useMessageSelectionStore.getState().enterSelectionMode(MSG_A);
      expect(useMessageSelectionStore.getState().hasSelection()).toBe(true);
    });

    it("returns false after exiting selection mode", () => {
      const store = useMessageSelectionStore.getState();
      store.enterSelectionMode(MSG_A);
      store.exitSelectionMode();
      expect(useMessageSelectionStore.getState().hasSelection()).toBe(false);
    });
  });
});
