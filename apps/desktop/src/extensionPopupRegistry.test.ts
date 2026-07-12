import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";

import { ExtensionPopupRegistry } from "./extensionPopupRegistry";

function popupWindow(): BrowserWindow {
  return {
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    setParentWindow: vi.fn(),
    webContents: {
      getTitle: vi.fn(() => "Popup"),
      getURL: vi.fn(() => "chrome-extension://extension/popup.html"),
    },
  } as unknown as BrowserWindow;
}

describe("ExtensionPopupRegistry project visibility", () => {
  it("reparents a project popup before restoring it", () => {
    const registry = new ExtensionPopupRegistry();
    const popup = popupWindow();
    const parent = { isDestroyed: vi.fn(() => false) } as unknown as BrowserWindow;
    registry.register("project-1", "extension-1", popup, "action");

    registry.showProject("project-1", parent);

    expect(popup.setParentWindow).toHaveBeenCalledWith(parent);
    expect(popup.show).toHaveBeenCalledOnce();
    expect(vi.mocked(popup.setParentWindow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(popup.show).mock.invocationCallOrder[0]!,
    );
  });

  it("hides and detaches a project popup so its former parent can close safely", () => {
    const registry = new ExtensionPopupRegistry();
    const popup = popupWindow();
    registry.register("project-1", "extension-1", popup, "extension-window");

    registry.hideProject("project-1");

    expect(popup.hide).toHaveBeenCalledOnce();
    expect(popup.setParentWindow).toHaveBeenCalledWith(null);
  });

  it("does not reparent popups owned by another project", () => {
    const registry = new ExtensionPopupRegistry();
    const popup = popupWindow();
    const parent = { isDestroyed: vi.fn(() => false) } as unknown as BrowserWindow;
    registry.register("project-2", "extension-1", popup, "action");

    registry.showProject("project-1", parent);

    expect(popup.setParentWindow).not.toHaveBeenCalled();
    expect(popup.show).not.toHaveBeenCalled();
  });
});
