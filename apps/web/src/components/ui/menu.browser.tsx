import type { DesktopBridge, DesktopOverlayBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEmbeddedBrowserModalSuspensionForTests,
  setEmbeddedBrowserMountedForModalSuspension,
} from "~/embeddedBrowserModalSuspension";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";

function installFailingOverlayBridge() {
  const overlay = {
    acquire: vi.fn(async () => {
      throw new Error("native overlay unavailable");
    }),
    release: vi.fn(async () => undefined),
    render: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => undefined),
    onDismiss: vi.fn(() => () => undefined),
  } satisfies DesktopOverlayBridge;

  const testWindow = window as unknown as { desktopBridge?: Partial<DesktopBridge> };
  testWindow.desktopBridge = {
    ...testWindow.desktopBridge,
    overlay,
  };

  return overlay;
}

describe("Menu native overlay fallback", () => {
  afterEach(() => {
    __resetEmbeddedBrowserModalSuspensionForTests();
    delete (window as unknown as { desktopBridge?: Partial<DesktopBridge> }).desktopBridge;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens an uncontrolled DOM menu when native acquisition fails", async () => {
    const overlay = installFailingOverlayBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);

    const screen = await render(
      <Menu
        overlayItems={[{ id: "fallback-action", label: "Fallback action" }]}
        overlayOnSelect={vi.fn()}
      >
        <MenuTrigger render={<button type="button">Open actions</button>} />
        <MenuPopup>
          <MenuItem>Fallback action</MenuItem>
        </MenuPopup>
      </Menu>,
    );

    try {
      await page.getByRole("button", { name: "Open actions" }).click();

      expect(overlay.acquire).toHaveBeenCalledTimes(1);
      await expect
        .element(page.getByRole("menuitem", { name: "Fallback action" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });
});
