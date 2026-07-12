import { describe, expect, it } from "vitest";

import {
  shouldDismissOverlayRouteDialog,
  shouldDismissOverlayRouteCombobox,
  shouldDismissOverlayRouteMenu,
  shouldDismissOverlayRouteSelect,
} from "./routedOverlayAdapters";

describe("shouldDismissOverlayRouteDialog", () => {
  it("dismisses only for explicit dialog dismissal reasons", () => {
    expect(shouldDismissOverlayRouteDialog("outside-press")).toBe(true);
    expect(shouldDismissOverlayRouteDialog("escape-key")).toBe(true);
    expect(shouldDismissOverlayRouteDialog("close-press")).toBe(true);
    expect(shouldDismissOverlayRouteDialog("focus-out")).toBe(false);
    expect(shouldDismissOverlayRouteDialog("item-press")).toBe(false);
    expect(shouldDismissOverlayRouteDialog(null)).toBe(false);
  });
});

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

  it("keeps routed select item selection distinct from route dismissal", () => {
    expect(shouldDismissOverlayRouteSelect("outside-press")).toBe(true);
    expect(shouldDismissOverlayRouteSelect("escape-key")).toBe(true);
    expect(shouldDismissOverlayRouteSelect("window-resize")).toBe(true);

    expect(shouldDismissOverlayRouteSelect("item-press")).toBe(false);
    expect(shouldDismissOverlayRouteSelect("focus-out")).toBe(false);
    expect(shouldDismissOverlayRouteSelect("trigger-press")).toBe(false);
    expect(shouldDismissOverlayRouteSelect(null)).toBe(false);
  });

  it("uses select-like route dismissal for routed comboboxes", () => {
    expect(shouldDismissOverlayRouteCombobox("outside-press")).toBe(true);
    expect(shouldDismissOverlayRouteCombobox("escape-key")).toBe(true);
    expect(shouldDismissOverlayRouteCombobox("window-resize")).toBe(true);

    expect(shouldDismissOverlayRouteCombobox("item-press")).toBe(false);
    expect(shouldDismissOverlayRouteCombobox("focus-out")).toBe(false);
    expect(shouldDismissOverlayRouteCombobox("trigger-press")).toBe(false);
    expect(shouldDismissOverlayRouteCombobox(null)).toBe(false);
  });
});
