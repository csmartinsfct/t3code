import type { BrowserTabListing, BrowserTabSummary, ProjectId } from "@t3tools/contracts";
import { isBrowserNavigationAbortError } from "@t3tools/shared/browserNavigationErrors";
import {
  ArrowDownLeftFromSquareIcon,
  ArrowRightIcon,
  ArrowUpRightFromSquareIcon,
  GlobeIcon,
  MonitorSmartphoneIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";

import { setEmbeddedBrowserMountedForModalSuspension } from "~/embeddedBrowserModalSuspension";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { EmbeddedBrowserViewportToolbar } from "./EmbeddedBrowserViewportToolbar";
import { paramsFromState, type TabEmulation } from "./devicePresets";

interface EmbeddedBrowserProps {
  projectId: ProjectId;
}

interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_URL = "https://news.ycombinator.com";
const MAX_TABS = 5;
const BLANK_URLS = new Set(["about:blank", "about:newtab"]);

// `about:blank` is an implementation detail of the embedded browser — the
// URL input should feel empty when the active tab hasn't navigated anywhere.
function displayUrl(url: string): string {
  return BLANK_URLS.has(url) ? "" : url;
}

function readElementRect(element: HTMLElement): BrowserRect {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_URL;
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function tabDisplayName(tab: BrowserTabSummary): string {
  if (tab.title.trim()) return tab.title;
  if (!tab.url || tab.url === "about:blank") return "New Tab";
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return tab.url;
  }
}

export function EmbeddedBrowser({ projectId }: EmbeddedBrowserProps) {
  const rectRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const mountPromiseRef = useRef<Promise<void> | null>(null);
  const lifecycleIdRef = useRef(0);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState(displayUrl(DEFAULT_URL));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<readonly BrowserTabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState<number>(0);

  const browserBridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  // Per-tab device-emulation state (T3CO-423). Local-only, ephemeral —
  // matches DevTools' session-only behavior. Switching tabs swaps the
  // active state; closing/reopening the project resets the map.
  const [emulationByTab, setEmulationByTab] = useState<Map<number, TabEmulation>>(new Map());
  const [viewportToolbarOpen, setViewportToolbarOpen] = useState(false);

  // Popout state (T3CO-424). True when this project's WebContentsView has
  // been detached into a free-floating BrowserWindow. Pushed from the main
  // process so every window hosting the project (main or popout) stays in
  // sync without polling. The popout window's own EmbeddedBrowser instance
  // ignores this flag — it is what's hosting the view, so it should always
  // render the full chrome.
  const [isPoppedOut, setIsPoppedOut] = useState(false);
  const isInsidePopout = useMemo(
    () => typeof window !== "undefined" && window.location.search.includes("popout="),
    [],
  );
  useEffect(() => {
    if (!browserBridge || isInsidePopout) return;
    return browserBridge.onPopoutStateChanged((payload) => {
      if (payload.projectId !== projectId) return;
      setIsPoppedOut(payload.isOpen);
    });
  }, [browserBridge, isInsidePopout, projectId]);

  const activeEmulation = emulationByTab.get(activeTabId) ?? { kind: "off" as const };
  const effectiveDimensions = useMemo<{ width: number; height: number } | null>(() => {
    const params = paramsFromState(activeEmulation);
    if (!params) return null;
    // Apply zoom to the rect's CSS dimensions so the WebContentsView's
    // bounds match the scaled rendered output that CDP `scale` produces.
    return {
      width: params.width * params.scale,
      height: params.height * params.scale,
    };
  }, [activeEmulation]);

  const handleEmulationChange = useCallback(
    (next: TabEmulation, tabId: number) => {
      setEmulationByTab((prev) => {
        const map = new Map(prev);
        if (next.kind === "off") {
          map.delete(tabId);
        } else {
          map.set(tabId, next);
        }
        return map;
      });
      if (browserBridge) {
        void browserBridge.setViewport(projectId, tabId, paramsFromState(next));
      }
    },
    [browserBridge, projectId],
  );

  const applyTabListing = useCallback((listing: BrowserTabListing) => {
    setTabs(listing.tabs);
    setActiveTabId(listing.activeTabId);
    const activeTab = listing.tabs.find((tab) => tab.id === listing.activeTabId);
    // Always sync the URL bar to the active tab — empty string for about:blank
    // so the placeholder is visible and Cmd+A / typing starts fresh.
    if (activeTab) setUrl(displayUrl(activeTab.url));
  }, []);

  const isCurrentLifecycle = useCallback((lifecycleId: number) => {
    return lifecycleIdRef.current === lifecycleId;
  }, []);

  const refreshTabs = useCallback(async () => {
    if (!browserBridge) return;
    const lifecycleId = lifecycleIdRef.current;
    try {
      const listing = await browserBridge.listTabs(projectId);
      if (!isCurrentLifecycle(lifecycleId)) return;
      applyTabListing(listing);
    } catch (cause) {
      if (!isCurrentLifecycle(lifecycleId)) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [applyTabListing, browserBridge, isCurrentLifecycle, projectId]);

  const syncBounds = useCallback(async () => {
    const element = rectRef.current;
    if (!element || !browserBridge) return;
    const lifecycleId = lifecycleIdRef.current;
    const bounds = readElementRect(element);
    if (bounds.width <= 0 || bounds.height <= 0) return;

    if (!mountedRef.current) {
      if (!mountPromiseRef.current) {
        const mountPromise = browserBridge
          .mount(projectId, bounds)
          .then(async () => {
            if (!isCurrentLifecycle(lifecycleId)) return;
            mountedRef.current = true;
            setEmbeddedBrowserMountedForModalSuspension(true);
            const currentUrl = await browserBridge.getUrl(projectId);
            if (!isCurrentLifecycle(lifecycleId)) return;
            setUrl(displayUrl(currentUrl));
            await refreshTabs();
          })
          .catch((cause: unknown) => {
            if (!isCurrentLifecycle(lifecycleId)) return;
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            if (mountPromiseRef.current === mountPromise) {
              mountPromiseRef.current = null;
            }
          });
        mountPromiseRef.current = mountPromise;
      }
      await mountPromiseRef.current;
      return;
    }

    try {
      await browserBridge.setBounds(projectId, bounds);
    } catch (cause) {
      if (!isCurrentLifecycle(lifecycleId)) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [browserBridge, isCurrentLifecycle, projectId, refreshTabs]);

  const scheduleBoundsSync = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      void syncBounds();
    });
  }, [syncBounds]);

  useEffect(() => {
    if (!browserBridge) return;
    // When the popout window is hosting this project, the main-window
    // instance must not mount: the WebContentsView lives in the popout
    // and trying to also mount it here would race with the popout's mount.
    // The placeholder branch above already returns early; this guard ensures
    // the effect's cleanup runs (unmounts the view from the main window)
    // when `isPoppedOut` flips true, and re-mounts when it flips false.
    if (isPoppedOut && !isInsidePopout) return;
    const element = rectRef.current;
    if (!element) return;

    const lifecycleId = lifecycleIdRef.current + 1;
    lifecycleIdRef.current = lifecycleId;
    mountPromiseRef.current = null;
    mountedRef.current = false;
    setTabs([]);
    setActiveTabId(0);
    setUrl(displayUrl(DEFAULT_URL));
    setLoading(false);
    setError(null);
    scheduleBoundsSync();
    const observer = new ResizeObserver(scheduleBoundsSync);
    observer.observe(element);
    // Also observe the outer pane so sidebar drags (which change pane size
    // but not rect content size) re-sync the rect's screen position.
    const pane = paneRef.current;
    if (pane) observer.observe(pane);
    window.addEventListener("resize", scheduleBoundsSync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (lifecycleIdRef.current === lifecycleId) {
        lifecycleIdRef.current += 1;
      }
      const pendingMount = mountPromiseRef.current;
      const shouldUnmount = mountedRef.current || pendingMount !== null;
      if (mountPromiseRef.current === pendingMount) {
        mountPromiseRef.current = null;
      }
      mountedRef.current = false;
      setEmbeddedBrowserMountedForModalSuspension(false);
      void (async () => {
        await pendingMount?.catch(() => {});
        if (shouldUnmount) {
          await browserBridge.unmount(projectId);
        }
      })();
    };
  }, [browserBridge, isInsidePopout, isPoppedOut, projectId, scheduleBoundsSync]);

  // Subscribe to tab updates pushed from the main process on project mount
  // (title / favicon / navigation / new-tab / close-tab from either the agent
  // or UI). The listener only installs once per project.
  useEffect(() => {
    if (!browserBridge) return;
    const unsubscribe = browserBridge.onTabsChanged((payload) => {
      if (payload.projectId !== projectId) return;
      applyTabListing({ tabs: payload.tabs, activeTabId: payload.activeTabId });
    });
    return unsubscribe;
  }, [applyTabListing, browserBridge, projectId]);

  const navigate = useCallback(
    async (targetUrl: string) => {
      if (!browserBridge) return;
      const lifecycleId = lifecycleIdRef.current;
      const nextUrl = normalizeUrlInput(targetUrl);
      setLoading(true);
      setError(null);
      try {
        await browserBridge.navigate(projectId, nextUrl);
        const currentUrl = await browserBridge.getUrl(projectId);
        if (!isCurrentLifecycle(lifecycleId)) return;
        setUrl(currentUrl || nextUrl);
      } catch (cause) {
        if (isBrowserNavigationAbortError(cause)) {
          const currentUrl = await browserBridge.getUrl(projectId).catch(() => "");
          if (!isCurrentLifecycle(lifecycleId)) return;
          setUrl(currentUrl || nextUrl);
          return;
        }
        if (!isCurrentLifecycle(lifecycleId)) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (isCurrentLifecycle(lifecycleId)) setLoading(false);
      }
    },
    [browserBridge, isCurrentLifecycle, projectId],
  );

  const openNewTab = useCallback(async () => {
    if (!browserBridge) return;
    const lifecycleId = lifecycleIdRef.current;
    try {
      await browserBridge.newTab(projectId);
      if (!isCurrentLifecycle(lifecycleId)) return;
      await refreshTabs();
      // Focus the URL input after the DOM has rendered the empty state so the
      // user can just start typing.
      requestAnimationFrame(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      });
    } catch (cause) {
      if (!isCurrentLifecycle(lifecycleId)) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [browserBridge, isCurrentLifecycle, projectId, refreshTabs]);

  const activateTab = useCallback(
    async (tabId: number) => {
      if (!browserBridge || tabId === activeTabId) return;
      const lifecycleId = lifecycleIdRef.current;
      try {
        await browserBridge.switchTab(projectId, tabId);
        if (!isCurrentLifecycle(lifecycleId)) return;
        await refreshTabs();
      } catch (cause) {
        if (!isCurrentLifecycle(lifecycleId)) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [activeTabId, browserBridge, isCurrentLifecycle, projectId, refreshTabs],
  );

  const closeTab = useCallback(
    async (tabId: number) => {
      if (!browserBridge) return;
      const lifecycleId = lifecycleIdRef.current;
      try {
        await browserBridge.closeTab(projectId, tabId);
        if (!isCurrentLifecycle(lifecycleId)) return;
        await refreshTabs();
      } catch (cause) {
        if (!isCurrentLifecycle(lifecycleId)) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [browserBridge, isCurrentLifecycle, projectId, refreshTabs],
  );

  // Tab keyboard shortcuts (Cmd/Ctrl+T, Cmd/Ctrl+W) are handled
  // in the Electron main process via `before-input-event` on each tab's
  // webContents — when focus is inside the webview, keydown events never
  // bubble out to the shell's window, so a React-side listener cannot see
  // them. See `createEmbeddedBrowserTab` in apps/desktop/src/main.ts.

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate(url);
  };

  const atTabCap = tabs.length >= MAX_TABS;

  if (isPoppedOut && !isInsidePopout) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <ArrowUpRightFromSquareIcon className="size-5 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">Browser opened in a separate window.</div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => browserBridge && void browserBridge.popoutClose(projectId)}
        >
          Bring back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {browserBridge && tabs.length > 0 && (
        <div
          className="flex h-9 w-full shrink-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden bg-muted/30 pl-1.5 pr-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Browser tabs"
        >
          {tabs.map((tab) => (
            <BrowserTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              onActivate={() => void activateTab(tab.id)}
              onClose={tabs.length > 1 ? () => void closeTab(tab.id) : undefined}
            />
          ))}
          <button
            type="button"
            onClick={() => void openNewTab()}
            disabled={atTabCap}
            className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            aria-label={atTabCap ? `Tab limit reached (${MAX_TABS})` : "New tab"}
            title={atTabCap ? `Tab limit reached (${MAX_TABS})` : "New tab (⌘T)"}
          >
            <PlusIcon className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      )}
      <form
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"
        onSubmit={handleSubmit}
      >
        <GlobeIcon className="size-4 text-muted-foreground" />
        <input
          ref={urlInputRef}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
          placeholder="Search or enter address"
          spellCheck={false}
        />
        <Button type="submit" size="icon-xs" variant="outline" disabled={!browserBridge || loading}>
          {loading ? (
            <RotateCwIcon className="size-3 animate-spin" />
          ) : (
            <ArrowRightIcon className="size-3" />
          )}
        </Button>
        <button
          type="button"
          onClick={() => setViewportToolbarOpen((open) => !open)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md border transition-colors",
            viewportToolbarOpen || activeEmulation.kind !== "off"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-transparent text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={viewportToolbarOpen}
          aria-label="Toggle device emulation toolbar"
          title="Devices"
        >
          <MonitorSmartphoneIcon className="size-3.5" />
        </button>
        {isInsidePopout ? (
          <button
            type="button"
            onClick={() => browserBridge && void browserBridge.popoutClose(projectId)}
            disabled={!browserBridge}
            className="flex size-7 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Return browser to main window"
            title="Return to main window"
          >
            <ArrowDownLeftFromSquareIcon className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => browserBridge && void browserBridge.popoutOpen(projectId)}
            disabled={!browserBridge}
            className="flex size-7 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Open browser in new window"
            title="Open in window"
          >
            <ArrowUpRightFromSquareIcon className="size-3.5" />
          </button>
        )}
      </form>
      {viewportToolbarOpen && browserBridge ? (
        <EmbeddedBrowserViewportToolbar
          emulation={activeEmulation}
          onChange={(next) => handleEmulationChange(next, activeTabId)}
        />
      ) : null}
      {error && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
      {!browserBridge && (
        <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          Embedded browser is available in the desktop app.
        </div>
      )}
      {/*
        The rect is clamped to the pane via `min(SIM, 100%)` so it can
        never overflow in either axis — the WebContentsView bounds always
        stay inside the pane, no overlap with adjacent chrome. When the
        simulated viewport fits, the rect renders at full simulated size
        and is letterboxed via flex centering. When it exceeds the pane,
        the rect caps at pane size and the user sees only the top-left
        portion of the simulated viewport (relying on Chromium's inner
        page scroll for vertical content navigation). The pane (`paneRef`)
        is observed by ResizeObserver so sidebar resizes trigger a
        bounds re-sync without depending on the rect's content size
        changing.
      */}
      <div
        ref={paneRef}
        className={
          effectiveDimensions
            ? "flex min-h-0 flex-1 items-center justify-center bg-black/80"
            : "min-h-0 flex-1 bg-background"
        }
      >
        <div
          ref={rectRef}
          data-browser-rect
          className="bg-background"
          style={
            effectiveDimensions
              ? {
                  width: `min(${effectiveDimensions.width}px, 100%)`,
                  height: `min(${effectiveDimensions.height}px, 100%)`,
                }
              : { width: "100%", height: "100%" }
          }
        />
      </div>
    </div>
  );
}

interface BrowserTabProps {
  tab: BrowserTabSummary;
  active: boolean;
  onActivate: () => void;
  onClose: (() => void) | undefined;
}

function BrowserTab({ tab, active, onActivate, onClose }: BrowserTabProps) {
  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose?.();
  };
  const handleAuxClick = (event: MouseEvent<HTMLDivElement>) => {
    // Middle-click closes the tab (match browser convention).
    if (event.button === 1 && onClose) {
      event.preventDefault();
      onClose();
    }
  };
  const handleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  };
  const displayName = tabDisplayName(tab);

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      onClick={onActivate}
      onAuxClick={handleAuxClick}
      onKeyDown={handleKey}
      title={tab.url}
      className={`group relative flex h-[30px] max-w-[180px] min-w-0 flex-1 basis-[140px] cursor-pointer items-center gap-2 rounded-t-md px-2.5 text-xs transition-colors select-none ${
        active
          ? "bg-background text-foreground shadow-[0_-1px_0_theme(colors.primary/0.7)_inset] after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      <TabFavicon tab={tab} />
      <span className="min-w-0 flex-1 truncate leading-tight">{displayName}</span>
      {onClose ? (
        <button
          type="button"
          onClick={handleClose}
          tabIndex={-1}
          aria-label={`Close ${displayName}`}
          className={`flex size-4 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground/70 transition-opacity hover:bg-accent hover:text-foreground ${
            active
              ? "opacity-70 hover:opacity-100"
              : "opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100"
          }`}
        >
          <XIcon className="size-3" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

function TabFavicon({ tab }: { tab: BrowserTabSummary }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [tab.favicon]);
  if (tab.favicon && !broken) {
    return (
      <img
        src={tab.favicon}
        alt=""
        className="size-3.5 shrink-0 rounded-sm"
        onError={() => setBroken(true)}
        draggable={false}
      />
    );
  }
  return <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/70" />;
}
