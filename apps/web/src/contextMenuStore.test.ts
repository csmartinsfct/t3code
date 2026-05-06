import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge, DesktopOverlayBridge } from "@t3tools/contracts";

import { useContextMenuStore } from "./contextMenuStore";
import {
  __resetEmbeddedBrowserModalSuspensionForTests,
  getTrackedEmbeddedBrowserOverlayCountForTests,
  setEmbeddedBrowserMountedForModalSuspension,
} from "./embeddedBrowserModalSuspension";

function navigateForTest(pathname: string) {
  const current =
    typeof window === "undefined"
      ? {}
      : (window as Window & { desktopBridge?: Partial<DesktopBridge> });
  vi.stubGlobal("window", {
    ...current,
    location: { pathname },
  });
}

function installDesktopBridge() {
  if (typeof window === "undefined") {
    navigateForTest("/");
  }
  let eventHandler: ((type: string, payload: unknown) => void) | null = null;
  const overlay = {
    acquire: vi.fn(async () => "overlay-test"),
    release: vi.fn(async () => undefined),
    render: vi.fn(async () => undefined),
    onEvent: vi.fn((_id: string, handler: (type: string, payload: unknown) => void) => {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    }),
    onDismiss: vi.fn(() => () => undefined),
  } satisfies DesktopOverlayBridge;
  const browser = {
    suspendForModal: vi.fn(async () => undefined),
    resumeFromModal: vi.fn(async () => undefined),
  };

  (window as any).desktopBridge = {
    overlay,
    browser,
  };

  return {
    overlay,
    browser,
    emitOverlayEvent: (type: string, payload: unknown) => eventHandler?.(type, payload),
  };
}

afterEach(() => {
  const { releaseBrowserOverlay, resolve } = useContextMenuStore.getState();
  releaseBrowserOverlay?.();
  if (resolve) {
    resolve(null);
  }
  useContextMenuStore.setState({
    open: false,
    items: [],
    position: { x: 0, y: 0 },
    resolve: null,
    releaseBrowserOverlay: null,
  });
  __resetEmbeddedBrowserModalSuspensionForTests();
  if (typeof window !== "undefined") {
    delete (window as any).desktopBridge;
  }
  vi.unstubAllGlobals();
});

describe("show", () => {
  it("sets state and returns a promise", () => {
    const items = [{ id: "delete", label: "Delete" }] as const;
    const promise = useContextMenuStore.getState().show(items, { x: 10, y: 20 });

    expect(promise).toBeInstanceOf(Promise);
    const state = useContextMenuStore.getState();
    expect(state.open).toBe(true);
    expect(state.items).toEqual(items);
    expect(state.position).toEqual({ x: 10, y: 20 });
    expect(state.resolve).toBeTypeOf("function");
  });

  it("defaults position to {0, 0} when omitted", () => {
    useContextMenuStore.getState().show([{ id: "a", label: "A" }]);

    expect(useContextMenuStore.getState().position).toEqual({ x: 0, y: 0 });
  });

  it("resolves the previous promise with null when called while open", async () => {
    const first = useContextMenuStore.getState().show([{ id: "a", label: "A" }]);
    useContextMenuStore.getState().show([{ id: "b", label: "B" }]);

    await expect(first).resolves.toBeNull();
  });

  it("suspends the embedded browser synchronously while open", async () => {
    const suspendForModal = vi.fn(async () => {});
    const resumeFromModal = vi.fn(async () => {});
    vi.stubGlobal("window", {
      desktopBridge: {
        browser: {
          suspendForModal,
          resumeFromModal,
        },
      },
    });
    setEmbeddedBrowserMountedForModalSuspension(true);

    const promise = useContextMenuStore.getState().show([{ id: "a", label: "A" }]);

    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(1);
    await vi.waitFor(() => expect(suspendForModal).toHaveBeenCalledTimes(1));

    useContextMenuStore.getState().dismiss();
    await expect(promise).resolves.toBeNull();
    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(0);
    await vi.waitFor(() => expect(resumeFromModal).toHaveBeenCalledTimes(1));
  });

  it("uses the native overlay path without modal suspension when the browser is relevant", async () => {
    navigateForTest("/_chat/thread-1");
    const { browser, emitOverlayEvent, overlay } = installDesktopBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);

    const promise = useContextMenuStore.getState().show([{ id: "a", label: "A" }], {
      x: 10,
      y: 20,
    });

    await vi.waitFor(() => expect(overlay.render).toHaveBeenCalledTimes(1));
    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(0);
    expect(browser.suspendForModal).not.toHaveBeenCalled();

    emitOverlayEvent("select", { id: "a" });

    await expect(promise).resolves.toBe("a");
    expect(overlay.acquire).toHaveBeenCalledTimes(1);
    expect(overlay.release).toHaveBeenCalledTimes(1);
  });

  it("keeps settings context menus on the DOM path without native acquire or suspension", async () => {
    navigateForTest("/settings/general");
    const { browser, overlay } = installDesktopBridge();
    setEmbeddedBrowserMountedForModalSuspension(true);

    const promise = useContextMenuStore.getState().show([{ id: "a", label: "A" }], {
      x: 10,
      y: 20,
    });

    expect(overlay.acquire).not.toHaveBeenCalled();
    expect(useContextMenuStore.getState().open).toBe(true);
    expect(getTrackedEmbeddedBrowserOverlayCountForTests()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.suspendForModal).not.toHaveBeenCalled();

    useContextMenuStore.getState().dismiss();
    await expect(promise).resolves.toBeNull();
  });
});

describe("select", () => {
  it("resolves the promise with the item id", async () => {
    const promise = useContextMenuStore.getState().show([{ id: "rename", label: "Rename" }]);
    useContextMenuStore.getState().select("rename");

    await expect(promise).resolves.toBe("rename");
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("is a no-op when no menu is open", () => {
    expect(() => useContextMenuStore.getState().select("anything")).not.toThrow();
  });
});

describe("dismiss", () => {
  it("resolves the promise with null", async () => {
    const promise = useContextMenuStore.getState().show([{ id: "a", label: "A" }]);
    useContextMenuStore.getState().dismiss();

    await expect(promise).resolves.toBeNull();
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("is a no-op when no menu is open", () => {
    expect(() => useContextMenuStore.getState().dismiss()).not.toThrow();
  });
});
