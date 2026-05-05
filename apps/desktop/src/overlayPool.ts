import * as Crypto from "node:crypto";
import * as Path from "node:path";

import { BaseWindow, BrowserWindow, ipcMain, nativeTheme, WebContentsView } from "electron";

import type { OverlayRenderMessage } from "@t3tools/contracts";
import { formatTimelineLog, isTimelineLogMessage } from "@t3tools/shared/timeline";

function shortOverlayId(id: string): string {
  return id.slice(0, 8);
}

function describeOverlayMessage(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== "object") {
    return { messageType: typeof message };
  }
  const typed = message as Partial<OverlayRenderMessage>;
  return {
    type: typed.type,
    ...(typed.type === "route"
      ? {
          routeKey: typed.routeKey,
          presentation:
            typed.presentation && typeof typed.presentation === "object"
              ? (typed.presentation as { kind?: unknown }).kind
              : undefined,
        }
      : {}),
  };
}

function logOverlayTimeline(event: string, details?: Record<string, unknown>): void {
  console.log(formatTimelineLog("desktop", `overlay.${event}`, details));
}

// ---------------------------------------------------------------------------
// Overlay pool — manages a fixed set of pre-warmed WebContentsView instances
// used to render menus, selects, and other floating UI above the embedded
// Chromium browser. Each view is full-window, transparent, and idle (parked
// in an offscreen BaseWindow) until acquired for use.
//
// Pool design: a pool is created per BrowserWindow (main + each popout).
// Default size is 2: 1 active + 1 pre-warmed so opening a second overlay
// within the same session has zero cold-start cost.
// ---------------------------------------------------------------------------

export interface OverlayPoolEntry {
  readonly id: string;
  readonly view: WebContentsView;
  loadPromise: Promise<void>;
  status: "idle" | "active";
  hostWebContents: Electron.WebContents | null;
  ownerWindow: BrowserWindow | null;
}

export class OverlayPool {
  private readonly entries: OverlayPoolEntry[] = [];
  private readonly parkWindow: BaseWindow;
  private readonly overlayUrl: string;

  constructor(overlayUrl: string) {
    this.overlayUrl = overlayUrl;
    this.parkWindow = new BaseWindow({ show: false });
  }

  preWarm(targetWindow: BrowserWindow, count: number): void {
    for (let i = 0; i < count; i++) {
      const entry = this.createEntry();
      this.parkWindow.contentView.addChildView(entry.view);
    }
    void targetWindow; // retained for future per-window expansion
  }

  acquire(targetWindow: BrowserWindow, hostWebContents: Electron.WebContents): OverlayPoolEntry {
    const entry = this.entries.find((e) => e.status === "idle");
    if (!entry) {
      logOverlayTimeline("pool.acquire.create-extra");
      // Pool exhausted — create an extra entry on demand (should be rare).
      const extra = this.createEntry();
      return this.acquireEntry(extra, targetWindow, hostWebContents);
    }
    return this.acquireEntry(entry, targetWindow, hostWebContents);
  }

  release(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.status !== "active") return;

    const owner = entry.ownerWindow;
    const hostWebContents = entry.hostWebContents;
    logOverlayTimeline("pool.release", { overlayId: shortOverlayId(id) });

    if (owner && !owner.isDestroyed()) {
      try {
        owner.contentView.removeChildView(entry.view);
      } catch {
        // ignore — already removed
      }
    }

    if (owner && !owner.isDestroyed()) {
      owner.focus();
    }
    if (hostWebContents && !hostWebContents.isDestroyed()) {
      hostWebContents.focus();
      logOverlayTimeline("pool.release.focus-host", { overlayId: shortOverlayId(id) });
    }

    // Tell the overlay view to clear its content.
    entry.view.webContents.send(OVERLAY_CLEAR_CHANNEL);

    // Return to the park window.
    this.parkWindow.contentView.addChildView(entry.view);

    entry.status = "idle";
    entry.hostWebContents = null;
    entry.ownerWindow = null;
  }

  updateBoundsForWindow(window: BrowserWindow): void {
    const bounds = window.getContentBounds();
    for (const entry of this.entries) {
      if (entry.status === "active" && entry.ownerWindow === window) {
        entry.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      }
    }
  }

  findByWebContents(wc: Electron.WebContents): OverlayPoolEntry | undefined {
    return this.entries.find((e) => e.view.webContents === wc);
  }

  findById(id: string): OverlayPoolEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  sendToAllLoaded(channel: string, ...args: unknown[]): void {
    for (const entry of this.entries) {
      if (!entry.view.webContents.isLoading() && !entry.view.webContents.isDestroyed()) {
        entry.view.webContents.send(channel, ...args);
      }
    }
  }

  destroy(): void {
    for (const entry of this.entries) {
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.close();
      }
    }
    this.entries.length = 0;
    if (!this.parkWindow.isDestroyed()) {
      this.parkWindow.destroy();
    }
  }

  private createEntry(): OverlayPoolEntry {
    const id = Crypto.randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: Path.join(__dirname, "overlay-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor("#00000000");
    view.webContents.on("did-finish-load", () => {
      logOverlayTimeline("view.did-finish-load", {
        overlayId: shortOverlayId(id),
        url: view.webContents.getURL(),
      });
    });
    view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      logOverlayTimeline("view.did-fail-load", {
        overlayId: shortOverlayId(id),
        errorCode,
        errorDescription,
        validatedUrl,
      });
    });
    view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level < 2 && !isTimelineLogMessage(message)) return;
      logOverlayTimeline("view.console", {
        overlayId: shortOverlayId(id),
        level,
        message,
        line,
        sourceId,
      });
    });
    // Note: no setIgnoreMouseEvents needed — idle views live in the offscreen
    // parkWindow so they never intercept events in the main BrowserWindow.
    const entry: OverlayPoolEntry = {
      id,
      view,
      loadPromise: Promise.resolve(),
      status: "idle",
      hostWebContents: null,
      ownerWindow: null,
    };
    entry.loadPromise = view.webContents
      .loadURL(this.overlayUrl)
      .then(() => {
        this.pushTheme(entry);
      })
      .catch((error: unknown) => {
        logOverlayTimeline("view.load-failed", {
          overlayId: shortOverlayId(id),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    this.entries.push(entry);
    return entry;
  }

  private acquireEntry(
    entry: OverlayPoolEntry,
    targetWindow: BrowserWindow,
    hostWebContents: Electron.WebContents,
  ): OverlayPoolEntry {
    // Remove from park window before adding to target (a view can only have one parent).
    try {
      this.parkWindow.contentView.removeChildView(entry.view);
    } catch {
      // Was already removed (e.g. on-demand entry created above).
    }

    const bounds = targetWindow.getContentBounds();
    entry.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    // addChildView puts it last → topmost in the contentView stack.
    // addChildView puts it last → topmost; it captures all pointer events
    // for the window since it fills the full bounds.
    targetWindow.contentView.addChildView(entry.view);
    entry.view.webContents.focus();

    entry.status = "active";
    entry.hostWebContents = hostWebContents;
    (entry as { ownerWindow: BrowserWindow | null }).ownerWindow = targetWindow;
    logOverlayTimeline("pool.acquire.success", {
      overlayId: shortOverlayId(entry.id),
      bounds,
      url: entry.view.webContents.getURL(),
      isLoading: entry.view.webContents.isLoading(),
    });

    return entry;
  }

  private pushTheme(entry: OverlayPoolEntry): void {
    if (entry.view.webContents.isDestroyed()) return;
    const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    entry.view.webContents.send(OVERLAY_THEME_CHANGE_CHANNEL, theme);
  }
}

// ---------------------------------------------------------------------------
// Global pool registry — one pool per BrowserWindow. Created on first use.
// ---------------------------------------------------------------------------

const poolsByWindow = new Map<BrowserWindow, OverlayPool>();

let _overlayUrl: string | null = null;

export function configureOverlayUrl(url: string): void {
  _overlayUrl = url;
}

export function getOrCreateOverlayPool(window: BrowserWindow): OverlayPool {
  let pool = poolsByWindow.get(window);
  if (!pool) {
    if (!_overlayUrl) {
      throw new Error(
        "overlay URL not configured — call configureOverlayUrl before creating pools",
      );
    }
    pool = new OverlayPool(_overlayUrl);
    pool.preWarm(window, 2);
    poolsByWindow.set(window, pool);
    window.on("resize", () => pool!.updateBoundsForWindow(window));
    window.once("closed", () => {
      pool!.destroy();
      poolsByWindow.delete(window);
    });
  }
  return pool;
}

export function getOverlayPoolForWindow(window: BrowserWindow): OverlayPool | undefined {
  return poolsByWindow.get(window);
}

// Push updated theme to ALL overlay views across all pools (called when the
// user changes the app theme via SET_THEME_CHANNEL).
export function broadcastThemeToAllOverlays(theme: "light" | "dark"): void {
  for (const pool of poolsByWindow.values()) {
    pool.sendToAllLoaded(OVERLAY_THEME_CHANGE_CHANNEL, theme);
  }
}

// ---------------------------------------------------------------------------
// Channel name constants shared with overlay-preload.ts and main.ts.
// Defined here to avoid circular imports.
// ---------------------------------------------------------------------------

export const OVERLAY_ACQUIRE_CHANNEL = "overlay:acquire";
export const OVERLAY_RELEASE_CHANNEL = "overlay:release";
export const OVERLAY_RENDER_CHANNEL = "overlay:render";
export const OVERLAY_CLEAR_CHANNEL = "overlay:clear";
export const OVERLAY_EVENT_CHANNEL = "overlay:event";
export const OVERLAY_DISMISS_CHANNEL = "overlay:dismiss";
export const OVERLAY_GET_CONFIG_CHANNEL = "overlay:get-config";
export const OVERLAY_THEME_CHANGE_CHANNEL = "overlay:theme-change";

// ---------------------------------------------------------------------------
// IPC handler registration — called from main.ts registerIpcHandlers().
// ---------------------------------------------------------------------------

export function registerOverlayIpcHandlers(
  getWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow | null,
  getServerUrl: () => string | null,
): void {
  ipcMain.removeHandler(OVERLAY_ACQUIRE_CHANNEL);
  ipcMain.handle(OVERLAY_ACQUIRE_CHANNEL, (event: Electron.IpcMainInvokeEvent) => {
    const window = getWindow(event);
    if (!window) throw new Error("no browser window for overlay:acquire");
    const pool = getOrCreateOverlayPool(window);
    const entry = pool.acquire(window, event.sender);
    logOverlayTimeline("ipc.acquire", { overlayId: shortOverlayId(entry.id) });
    return entry.id;
  });

  ipcMain.removeHandler(OVERLAY_RELEASE_CHANNEL);
  ipcMain.handle(OVERLAY_RELEASE_CHANNEL, (event: Electron.IpcMainInvokeEvent, rawId: unknown) => {
    const id = typeof rawId === "string" ? rawId : null;
    if (!id) return;
    const window = getWindow(event);
    if (!window) return;
    const pool = getOverlayPoolForWindow(window);
    logOverlayTimeline("ipc.release", { overlayId: shortOverlayId(id) });
    pool?.release(id);
  });

  ipcMain.removeHandler(OVERLAY_RENDER_CHANNEL);
  ipcMain.handle(
    OVERLAY_RENDER_CHANNEL,
    async (event: Electron.IpcMainInvokeEvent, rawId: unknown, rawMessage: unknown) => {
      const id = typeof rawId === "string" ? rawId : null;
      if (!id) return;
      const window = getWindow(event);
      if (!window) return;
      const pool = getOverlayPoolForWindow(window);
      const entry = pool?.findById(id);
      if (!entry || entry.status !== "active") {
        logOverlayTimeline("ipc.render.missing-entry", {
          overlayId: shortOverlayId(id),
          ...describeOverlayMessage(rawMessage),
        });
        return;
      }
      logOverlayTimeline("ipc.render", {
        overlayId: shortOverlayId(id),
        isLoading: entry.view.webContents.isLoading(),
        ...describeOverlayMessage(rawMessage),
      });
      try {
        await entry.loadPromise;
      } catch (error) {
        logOverlayTimeline("ipc.render.load-unavailable", {
          overlayId: shortOverlayId(id),
          error: error instanceof Error ? error.message : String(error),
          ...describeOverlayMessage(rawMessage),
        });
        throw error;
      }
      if (entry.status !== "active") {
        logOverlayTimeline("ipc.render.stale-after-load", {
          overlayId: shortOverlayId(id),
          ...describeOverlayMessage(rawMessage),
        });
        return;
      }
      logOverlayTimeline("ipc.render.send", {
        overlayId: shortOverlayId(id),
        ...describeOverlayMessage(rawMessage),
      });
      entry.view.webContents.send(OVERLAY_RENDER_CHANNEL, rawMessage as OverlayRenderMessage);
      entry.view.webContents.focus();
    },
  );

  // Events originating FROM the overlay view (sent via overlay-preload).
  // These are ipcMain.on (not handle) since overlay-preload uses ipcRenderer.send.
  ipcMain.removeAllListeners(OVERLAY_EVENT_CHANNEL);
  ipcMain.on(
    OVERLAY_EVENT_CHANNEL,
    (event: Electron.IpcMainEvent, _rawId: unknown, type: unknown, payload: unknown) => {
      for (const pool of poolsByWindow.values()) {
        const entry = pool.findByWebContents(event.sender);
        if (entry?.hostWebContents && !entry.hostWebContents.isDestroyed()) {
          logOverlayTimeline("ipc.event", {
            overlayId: shortOverlayId(entry.id),
            eventType: type,
            payload,
          });
          // Use entry.id (not the rawId sent by the overlay view, which is null)
          // so the host renderer's onEvent(id, handler) filter matches correctly.
          entry.hostWebContents.send(OVERLAY_EVENT_CHANNEL, entry.id, type, payload);
          return;
        }
      }
    },
  );

  ipcMain.removeAllListeners(OVERLAY_DISMISS_CHANNEL);
  ipcMain.on(OVERLAY_DISMISS_CHANNEL, (event: Electron.IpcMainEvent) => {
    for (const pool of poolsByWindow.values()) {
      const entry = pool.findByWebContents(event.sender);
      if (!entry) continue;
      const hostWc = entry.hostWebContents;
      const entryId = entry.id;
      logOverlayTimeline("ipc.dismiss", { overlayId: shortOverlayId(entryId) });
      pool.release(entryId);
      if (hostWc && !hostWc.isDestroyed()) {
        hostWc.send(OVERLAY_DISMISS_CHANNEL, entryId);
      }
      return;
    }
  });

  // Sync config request from overlay view.
  ipcMain.removeAllListeners(OVERLAY_GET_CONFIG_CHANNEL);
  ipcMain.on(OVERLAY_GET_CONFIG_CHANNEL, (event: Electron.IpcMainEvent) => {
    const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    event.returnValue = { theme, serverUrl: getServerUrl() };
  });
}
