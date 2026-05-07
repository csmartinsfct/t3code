import { describe, expect, it } from "vitest";

import { shouldDismissOverlayRouteMenu } from "./routedOverlayAdapters";

describe("routed overlay menu dismissal", () => {
  it("only dismisses routed menus for explicit menu dismissals", () => {
    expect(shouldDismissOverlayRouteMenu("outside-press")).toBe(true);
    expect(shouldDismissOverlayRouteMenu("escape-key")).toBe(true);
    expect(shouldDismissOverlayRouteMenu("close-press")).toBe(true);

    expect(shouldDismissOverlayRouteMenu("focus-out")).toBe(false);
    expect(shouldDismissOverlayRouteMenu("item-press")).toBe(false);
    expect(shouldDismissOverlayRouteMenu("trigger-hover")).toBe(false);
    expect(shouldDismissOverlayRouteMenu(null)).toBe(false);
  });
});
