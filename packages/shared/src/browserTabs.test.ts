import { describe, expect, it } from "vitest";

import {
  chooseNextBrowserTabIdAfterClose,
  pruneBrowserTabActivationHistory,
  recordActiveBrowserTabId,
} from "./browserTabs";

describe("browser tab activation helpers", () => {
  it("records active tabs as most-recent-first and prunes closed tabs", () => {
    const tabs = [0, 1, 2];
    const first = recordActiveBrowserTabId([], 0, tabs);
    const second = recordActiveBrowserTabId(first, 2, tabs);
    const third = recordActiveBrowserTabId(second, 1, tabs);

    expect(third).toEqual([1, 2, 0]);
    expect(pruneBrowserTabActivationHistory(third, [0, 2])).toEqual([2, 0]);
  });

  it("keeps the current active tab when closing a background tab", () => {
    expect(
      chooseNextBrowserTabIdAfterClose({
        activeTabId: 2,
        closingTabId: 1,
        tabIds: [0, 1, 2],
        activationHistory: [2, 0, 1],
      }),
    ).toBe(2);
  });

  it("returns the last active remaining tab when closing the active tab", () => {
    expect(
      chooseNextBrowserTabIdAfterClose({
        activeTabId: 2,
        closingTabId: 2,
        tabIds: [0, 1, 2],
        activationHistory: [2, 1, 0],
      }),
    ).toBe(1);
  });

  it("falls back to the left neighbor when history is unavailable", () => {
    expect(
      chooseNextBrowserTabIdAfterClose({
        activeTabId: 2,
        closingTabId: 2,
        tabIds: [0, 1, 2],
        activationHistory: [],
      }),
    ).toBe(1);
  });

  it("falls back to the first remaining tab when closing the leftmost tab", () => {
    expect(
      chooseNextBrowserTabIdAfterClose({
        activeTabId: 0,
        closingTabId: 0,
        tabIds: [0, 1, 2],
        activationHistory: [],
      }),
    ).toBe(1);
  });
});
