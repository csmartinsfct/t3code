import type { DesktopBridge, DesktopOverlayBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetEmbeddedBrowserModalSuspensionForTests,
  setEmbeddedBrowserMountedForModalSuspension,
} from "./embeddedBrowserModalSuspension";
import {
  acquireNativeOverlay,
  openNativeOverlay,
  shouldUseNativeOverlay,
} from "./nativeOverlayBridge";

function installOverlayBridge(overrides: Partial<DesktopOverlayBridge> = {}) {
  ensureWindowForTest("/");
  const overlay = {
    acquire: vi.fn(async () => "overlay-test"),
    release: vi.fn(async () => undefined),
    render: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => undefined),
    onDismiss: vi.fn(() => () => undefined),
    ...overrides,
  } satisfies DesktopOverlayBridge;

  (window as any).desktopBridge = { overlay };
  return overlay;
}

function navigateForTest(pathname: string) {
  ensureWindowForTest(pathname);
}

function ensureWindowForTest(pathname: string) {
  const current =
    typeof window === "undefined"
      ? {}
      : (window as Window & { desktopBridge?: Partial<DesktopBridge> });
  vi.stubGlobal("window", {
    ...current,
    location: { pathname },
  });
}

afterEach(() => {
  __resetEmbeddedBrowserModalSuspensionForTests();
  if (typeof window !== "undefined") {
    delete (window as any).desktopBridge;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native overlay gate", () => {
  it("requires overlay availability and a mounted embedded browser", () => {
    navigateForTest("/_chat/thread-1");

    expect(shouldUseNativeOverlay()).toBe(false);

    installOverlayBridge();
    expect(shouldUseNativeOverlay()).toBe(false);

    setEmbeddedBrowserMountedForModalSuspension(true);
    expect(shouldUseNativeOverlay()).toBe(true);
  });

  it("does not activate on full-page settings surfaces", () => {
    installOverlayBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);

    navigateForTest("/settings/general");

    expect(shouldUseNativeOverlay()).toBe(false);
  });

  it("suppresses direct native overlay acquisition on settings surfaces", async () => {
    const overlay = installOverlayBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);
    navigateForTest("/settings/runs");

    const session = await openNativeOverlay({
      type: "route",
      routeKey: "test-menu",
      params: {},
      presentation: {
        kind: "menu",
        anchor: { x: 0, y: 0, width: 1, height: 1 },
      },
    });

    expect(session).toBeNull();
    expect(overlay.acquire).not.toHaveBeenCalled();
  });
});

describe("native overlay acquisition", () => {
  it("requests a non-focusing native overlay when configured", async () => {
    const overlay = installOverlayBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);

    const handle = await acquireNativeOverlay(
      {
        type: "composer-command",
        anchor: { x: 0, y: 0, width: 100, height: 40 },
        items: [],
        resolvedTheme: "dark",
        isLoading: false,
        triggerKind: "path",
        activeItemId: null,
      },
      { focus: false },
    );

    expect(handle).not.toBeNull();
    expect(overlay.acquire).toHaveBeenCalledWith({ focus: false });
    handle?.release();
  });
});
