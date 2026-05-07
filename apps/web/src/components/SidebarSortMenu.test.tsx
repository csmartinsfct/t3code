import { describe, expect, it } from "vitest";

import { shouldDismissSidebarSortMenuRoute } from "./SidebarSortMenu";

describe("SidebarSortMenu route dismissal", () => {
  it("only dismisses the routed menu for explicit outside dismissals", () => {
    expect(shouldDismissSidebarSortMenuRoute("outside-press")).toBe(true);
    expect(shouldDismissSidebarSortMenuRoute("escape-key")).toBe(true);

    expect(shouldDismissSidebarSortMenuRoute("focus-out")).toBe(false);
    expect(shouldDismissSidebarSortMenuRoute("item-press")).toBe(false);
    expect(shouldDismissSidebarSortMenuRoute("trigger-hover")).toBe(false);
    expect(shouldDismissSidebarSortMenuRoute(null)).toBe(false);
  });
});
