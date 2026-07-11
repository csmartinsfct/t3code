import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createdViews } = vi.hoisted(() => ({
  createdViews: [] as Array<{
    webContents: {
      focus: ReturnType<typeof vi.fn>;
      loadURL: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      isDestroyed: ReturnType<typeof vi.fn>;
      isLoading: ReturnType<typeof vi.fn>;
      getURL: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    setBackgroundColor: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("electron", () => {
  class BaseWindow {
    readonly contentView = {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    };
    isDestroyed = vi.fn(() => false);
    destroy = vi.fn();
  }

  class WebContentsView {
    readonly webContents = {
      focus: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isLoading: vi.fn(() => false),
      getURL: vi.fn(() => "http://localhost/overlay.html"),
      close: vi.fn(),
    };
    readonly setBackgroundColor = vi.fn();
    readonly setBounds = vi.fn();

    constructor() {
      createdViews.push(this);
    }
  }

  return {
    BaseWindow,
    BrowserWindow: class BrowserWindow {},
    WebContentsView,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    nativeTheme: { shouldUseDarkColors: true },
  };
});

import { OverlayPool } from "./overlayPool";

function createTargetWindow(): BrowserWindow {
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
  } as unknown as BrowserWindow;
}

function createPrewarmedPool(targetWindow: BrowserWindow): OverlayPool {
  const pool = new OverlayPool("http://localhost/overlay.html");
  pool.preWarm(targetWindow, 1);
  return pool;
}

describe("OverlayPool acquire focus policy", () => {
  beforeEach(() => {
    createdViews.length = 0;
  });

  it("focuses acquired overlays by default", () => {
    const targetWindow = createTargetWindow();
    const pool = createPrewarmedPool(targetWindow);
    const entry = pool.acquire(targetWindow, { isDestroyed: () => false } as never);

    expect(entry.view.webContents.focus).toHaveBeenCalledOnce();
  });

  it("can acquire an overlay without taking host keyboard focus", () => {
    const targetWindow = createTargetWindow();
    const pool = createPrewarmedPool(targetWindow);
    const entry = pool.acquire(targetWindow, { isDestroyed: () => false } as never, {
      focus: false,
    });

    expect(entry.view.webContents.focus).not.toHaveBeenCalled();
  });
});
