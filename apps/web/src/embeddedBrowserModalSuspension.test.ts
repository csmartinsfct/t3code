import type { DesktopBrowserBridge, DesktopBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetEmbeddedBrowserModalSuspensionForTests,
  getTrackedEmbeddedBrowserOverlayCountForTests,
  registerEmbeddedBrowserOverlay,
  setEmbeddedBrowserMountedForModalSuspension,
} from "./embeddedBrowserModalSuspension";

function installBrowserBridge() {
  const browserBridge = {
    mount: vi.fn(async () => "embedded-browser-test"),
    setBounds: vi.fn(async () => undefined),
    unmount: vi.fn(async () => undefined),
    suspendForModal: vi.fn(async () => undefined),
    resumeFromModal: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    getUrl: vi.fn(async () => "about:blank"),
    listTabs: vi.fn(async () => ({ tabs: [], activeTabId: 0 })),
    newTab: vi.fn(async () => 0),
    switchTab: vi.fn(async () => undefined),
    closeTab: vi.fn(async () => 0),
    setViewport: vi.fn(async () => undefined),
    popoutOpen: vi.fn(async () => undefined),
    popoutClose: vi.fn(async () => undefined),
    onTabsChanged: vi.fn(() => () => undefined),
    onPopoutStateChanged: vi.fn(() => () => undefined),
  } satisfies DesktopBrowserBridge;

  vi.stubGlobal("window", {
    desktopBridge: {
      browser: browserBridge,
    } as Partial<DesktopBridge>,
  });

  return browserBridge;
}

async function flushSuspensionQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  __resetEmbeddedBrowserModalSuspensionForTests();
  vi.unstubAllGlobals();
});

describe("embedded browser modal suspension", () => {
  it("suspends when an overlay is already open before the browser mounts", async () => {
    const browserBridge = installBrowserBridge();
    const releaseOverlay = registerEmbeddedBrowserOverlay();

    await flushSuspensionQueue();
    expect(browserBridge.suspendForModal).not.toHaveBeenCalled();

    setEmbeddedBrowserMountedForModalSuspension(true);
    await flushSuspensionQueue();

    expect(browserBridge.suspendForModal).toHaveBeenCalledTimes(1);
    expect(browserBridge.resumeFromModal).not.toHaveBeenCalled();

    releaseOverlay();
    await flushSuspensionQueue();

    expect(browserBridge.resumeFromModal).toHaveBeenCalledTimes(1);
    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(0);
  });

  it("keeps the browser suspended until the final nested overlay closes", async () => {
    const browserBridge = installBrowserBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);

    const releaseFirstOverlay = registerEmbeddedBrowserOverlay();
    const releaseSecondOverlay = registerEmbeddedBrowserOverlay();
    await flushSuspensionQueue();

    expect(browserBridge.suspendForModal).toHaveBeenCalledTimes(1);

    releaseFirstOverlay();
    await flushSuspensionQueue();

    expect(browserBridge.resumeFromModal).not.toHaveBeenCalled();
    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(1);

    releaseSecondOverlay();
    await flushSuspensionQueue();

    expect(browserBridge.resumeFromModal).toHaveBeenCalledTimes(1);
    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(0);
  });
});
