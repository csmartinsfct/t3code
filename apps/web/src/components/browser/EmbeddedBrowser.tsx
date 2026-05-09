import type {
  BrowserExtensionInfo,
  BrowserTabListing,
  BrowserTabSummary,
  ProjectId,
} from "@t3tools/contracts";
import { isBrowserNavigationAbortError } from "@t3tools/shared/browserNavigationErrors";
import {
  ArrowDownLeftFromSquareIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightFromSquareIcon,
  GlobeIcon,
  MonitorSmartphoneIcon,
  PinOffIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";

import type { ViewportEmulationParams } from "@t3tools/contracts";

import { setEmbeddedBrowserMountedForModalSuspension } from "~/embeddedBrowserModalSuspension";
import { useContextMenuStore } from "~/contextMenuStore";
import { useBrowserMetadataStore } from "~/lib/browserMetadataStore";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { EmbeddedBrowserExtensionsButton } from "./EmbeddedBrowserExtensionsPanel";
import { EmbeddedBrowserViewportActions } from "./EmbeddedBrowserViewportActions";
import { EmbeddedBrowserViewportToolbar } from "./EmbeddedBrowserViewportToolbar";
import { ViewportResizeHandles } from "./ViewportResizeHandles";
import {
  DEFAULT_PRESET_ID,
  DEFAULT_ZOOM,
  paramsFromState,
  type TabEmulation,
} from "./devicePresets";

interface EmbeddedBrowserProps {
  projectId: ProjectId;
}

interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_TABS = 5;
const BLANK_URLS = new Set(["about:blank", "about:newtab"]);
const EMULATION_STORAGE_PREFIX = "embeddedBrowser.emulation.";
const OFF_EMULATION: TabEmulation = { kind: "off" };
const EMULATED_PANE_PADDING_X = 24;
const EMULATED_PANE_PADDING_TOP = 64;
const EMULATED_PANE_PADDING_BOTTOM = 24;
const OPTIMISTIC_NEW_TAB_ID = -1;

// Per-project localStorage persistence for the device-emulator state. Tab
// IDs are stable across renderer mount/unmount cycles (the main process
// preserves the project's tab map even after `unmount`), so the persisted
// keys remain valid when the user navigates away and comes back.
function loadEmulationByTab(projectId: ProjectId): Map<number, TabEmulation> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(EMULATION_STORAGE_PREFIX + projectId);
    if (!raw) return new Map();
    const entries = JSON.parse(raw) as unknown;
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries as Array<[number, TabEmulation]>);
  } catch {
    return new Map();
  }
}

function saveEmulationByTab(projectId: ProjectId, map: Map<number, TabEmulation>): void {
  if (typeof window === "undefined") return;
  try {
    const key = EMULATION_STORAGE_PREFIX + projectId;
    if (map.size === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify([...map.entries()]));
    }
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded). Skip.
  }
}

// In-memory per-project state cache. Survives EmbeddedBrowser remounts so
// switching threads/projects and coming back doesn't blank the URL bar,
// tab strip, and emulator before the WebContentsView reattaches and the
// main process pushes truth back. The cache holds whatever the renderer
// last saw; it's overwritten by `refreshTabs` / `getUrl` once mount completes.
interface ProjectCacheEntry {
  url: string;
  tabs: readonly BrowserTabSummary[];
  activeTabId: number;
  emulationByTab: Map<number, TabEmulation>;
}

const projectStateCache = new Map<ProjectId, ProjectCacheEntry>();

function readProjectCache(projectId: ProjectId): ProjectCacheEntry {
  let entry = projectStateCache.get(projectId);
  if (entry) return entry;
  entry = {
    url: "",
    tabs: [],
    activeTabId: 0,
    emulationByTab: loadEmulationByTab(projectId),
  };
  projectStateCache.set(projectId, entry);
  return entry;
}

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

function readBrowserRectForEmulation(
  pane: HTMLElement,
  emulation: TabEmulation,
): BrowserRect | null {
  const params = paramsFromState(emulation);
  if (!params) return readElementRect(pane);

  const rect = pane.getBoundingClientRect();
  // Predict the final emulated layout, not the pane's current classes. During
  // tab close/switch the current tab may be non-emulated, but the incoming tab
  // will render with `px-6 pt-16 pb-6`; using current computed padding would
  // mount the WebContentsView one frame too high/left.
  const paddingLeft = EMULATED_PANE_PADDING_X;
  const paddingRight = EMULATED_PANE_PADDING_X;
  const paddingTop = EMULATED_PANE_PADDING_TOP;
  const paddingBottom = EMULATED_PANE_PADDING_BOTTOM;
  const contentWidth = Math.max(0, rect.width - paddingLeft - paddingRight);
  const contentHeight = Math.max(0, rect.height - paddingTop - paddingBottom);
  const width = Math.min(params.width * params.scale, contentWidth);
  const height = Math.min(params.height * params.scale, contentHeight);
  if (width <= 0 || height <= 0) return null;

  return {
    x: rect.x + paddingLeft + Math.max(0, (contentWidth - width) / 2),
    y: rect.y + paddingTop,
    width,
    height,
  };
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function tabDisplayName(tab: BrowserTabSummary): string {
  if (BLANK_URLS.has(tab.url)) return "New Tab";
  if (tab.title.trim()) return tab.title;
  if (!tab.url) return "New Tab";
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return tab.url;
  }
}

function PinnedExtensionIcon({
  ext,
  onOpen,
  onTogglePin,
  onRemove,
}: {
  ext: BrowserExtensionInfo;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showContextMenu = useContextMenuStore((s) => s.show);

  const handleContextMenu = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const result = await showContextMenu(
      [
        { id: "pin", label: "Unpin from toolbar" },
        { id: "remove", label: "Remove extension", destructive: true },
      ],
      { x: e.clientX, y: e.clientY },
    );
    if (result === "pin") onTogglePin(ext.id);
    else if (result === "remove") onRemove(ext.id);
  };

  return (
    <button
      type="button"
      title={ext.name}
      onClick={() => onOpen(ext.id)}
      onContextMenu={handleContextMenu}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {ext.iconUrl && !imgError ? (
        <img
          src={ext.iconUrl}
          alt={ext.name}
          className="size-4 rounded-sm object-contain"
          onError={() => setImgError(true)}
        />
      ) : (
        <PinOffIcon className="size-3.5" />
      )}
    </button>
  );
}

export function EmbeddedBrowser({ projectId }: EmbeddedBrowserProps) {
  const rectRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const mountPromiseRef = useRef<Promise<void> | null>(null);
  const lifecycleIdRef = useRef(0);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  // All renderer-visible state is seeded from the per-project cache so
  // remounting the component (project switch, idle suspension, etc.)
  // doesn't briefly blank the URL bar, tabs, or emulator. The cache is
  // overwritten by the main process via `refreshTabs` / `getUrl` once
  // mount completes. Emulation state additionally persists to localStorage
  // so it survives a full process restart.
  const [url, setUrl] = useState<string>(() => readProjectCache(projectId).url);
  const [tabs, setTabs] = useState<readonly BrowserTabSummary[]>(
    () => readProjectCache(projectId).tabs,
  );
  const [activeTabId, setActiveTabId] = useState<number>(
    () => readProjectCache(projectId).activeTabId,
  );
  const [emulationByTab, setEmulationByTab] = useState<Map<number, TabEmulation>>(
    () => readProjectCache(projectId).emulationByTab,
  );
  const [isOpeningNewTab, setIsOpeningNewTab] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browserBridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  // Mirrors `emulationByTab` for async closures (the mount callback) that
  // need the current value without re-creating the closure on every change.
  const emulationByTabRef = useRef(emulationByTab);
  // Tracks which projectId the in-memory state corresponds to so the cache
  // save effect doesn't persist project A's state under project B's key
  // during a mid-life projectId change.
  const loadedProjectRef = useRef(projectId);
  // Remembers the *last non-off* emulation per tab so toggling the device
  // button restores the user's previous device choice instead of resetting
  // to the system default. Lives in a ref because it's only read on click.
  const lastEmulationByTabRef = useRef<Map<number, TabEmulation>>(new Map());
  // rAF-coalesced IPC during drag. Pointermove can fire >60Hz on macOS
  // trackpads; if every move sent a `setViewport` IPC the main process
  // would be flooded. Local React state still updates on every move so the
  // visual feedback is immediate; only the IPC side coalesces.
  const viewportIpcRafRef = useRef<number | null>(null);
  const pendingViewportIpcRef = useRef<{
    tabId: number;
    params: ViewportEmulationParams | null;
  } | null>(null);

  // Popout state (T3CO-424). True when this project's WebContentsView has
  // been detached into a free-floating BrowserWindow. Pushed from the main
  // process so every window hosting the project (main or popout) stays in
  // sync without polling. The popout window's own EmbeddedBrowser instance
  // ignores this flag — it is what's hosting the view, so it should always
  // render the full chrome.
  const [isPoppedOut, setIsPoppedOut] = useState(false);

  // Pinned extensions in toolbar
  const toolbarRef = useRef<HTMLFormElement>(null);
  // Pinned extensions — derived from the shared store populated by useBrowserMetadata
  // (called in KanbanBoard). No IPC calls needed here; the store is always warm.
  // Select the extensions array by reference (stable when unchanged) then derive
  // the pinned subset via useMemo to avoid creating new arrays on every render.
  const allExtensions = useBrowserMetadataStore((s) => s.entries[projectId]?.extensions);
  const pinnedExtensions = useMemo(
    () => (allExtensions ?? []).filter((e) => e.pinned) as BrowserExtensionInfo[],
    [allExtensions],
  );
  const [visiblePinnedCount, setVisiblePinnedCount] = useState(99);

  useEffect(() => {
    if (!toolbarRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      // Reserve: 180px URL bar min + 7 fixed toolbar buttons × 32px each
      const reserved = 180 + 7 * 32;
      setVisiblePinnedCount(Math.max(0, Math.floor((w - reserved) / 32)));
    });
    obs.observe(toolbarRef.current);
    return () => obs.disconnect();
  }, []);
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

  // Single effect that handles BOTH reload-on-projectId-change and save.
  // Saving on every state change keeps the in-memory cache in sync so the
  // next remount can render previous-known-good state instantly. The
  // `loadedProjectRef` guard prevents writing the wrong project's state
  // during a switch — when projectId changes, we reload from cache for
  // the new project and skip the write this tick; the freshly-set state
  // triggers another effect run that saves correctly.
  useEffect(() => {
    if (loadedProjectRef.current !== projectId) {
      loadedProjectRef.current = projectId;
      const cached = readProjectCache(projectId);
      emulationByTabRef.current = cached.emulationByTab;
      setUrl(cached.url);
      setTabs(cached.tabs);
      setActiveTabId(cached.activeTabId);
      setEmulationByTab(cached.emulationByTab);
      return;
    }
    emulationByTabRef.current = emulationByTab;
    projectStateCache.set(projectId, { url, tabs, activeTabId, emulationByTab });
    saveEmulationByTab(projectId, emulationByTab);
  }, [projectId, url, tabs, activeTabId, emulationByTab]);

  const activeEmulation = emulationByTab.get(activeTabId) ?? OFF_EMULATION;
  const isDeviceEmulatorActive = activeEmulation.kind !== "off";
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

  const flushViewportIpc = useCallback(() => {
    const pending = pendingViewportIpcRef.current;
    pendingViewportIpcRef.current = null;
    if (viewportIpcRafRef.current !== null) {
      cancelAnimationFrame(viewportIpcRafRef.current);
      viewportIpcRafRef.current = null;
    }
    if (pending && browserBridge) {
      void browserBridge.setViewport(projectId, pending.tabId, pending.params);
    }
  }, [browserBridge, projectId]);

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
      if (next.kind !== "off") {
        lastEmulationByTabRef.current.set(tabId, next);
      }
      flushViewportIpc();
      if (browserBridge) {
        void browserBridge.setViewport(projectId, tabId, paramsFromState(next));
      }
    },
    [browserBridge, flushViewportIpc, projectId],
  );

  // Drag-friendly variant: state is updated synchronously so React mirrors
  // the cursor instantly, but the IPC side is coalesced to one call per
  // animation frame. The latest pending params replace any earlier one.
  const handleEmulationDrag = useCallback(
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
      if (next.kind !== "off") {
        lastEmulationByTabRef.current.set(tabId, next);
      }
      pendingViewportIpcRef.current = { tabId, params: paramsFromState(next) };
      if (viewportIpcRafRef.current === null && browserBridge) {
        viewportIpcRafRef.current = requestAnimationFrame(() => {
          viewportIpcRafRef.current = null;
          const pending = pendingViewportIpcRef.current;
          pendingViewportIpcRef.current = null;
          if (pending) {
            void browserBridge.setViewport(projectId, pending.tabId, pending.params);
          }
        });
      }
    },
    [browserBridge, projectId],
  );

  // Address-bar device toggle: enables emulation with the tab's last-used
  // device (or the system default), and disables it on a second click.
  const toggleEmulation = useCallback(() => {
    const tabId = activeTabId;
    const current = emulationByTab.get(tabId) ?? OFF_EMULATION;
    if (current.kind !== "off") {
      handleEmulationChange({ kind: "off" }, tabId);
      return;
    }
    const last = lastEmulationByTabRef.current.get(tabId);
    const next: TabEmulation = last ?? {
      kind: "preset",
      presetId: DEFAULT_PRESET_ID,
      rotated: false,
      zoom: DEFAULT_ZOOM,
    };
    handleEmulationChange(next, tabId);
  }, [activeTabId, emulationByTab, handleEmulationChange]);

  // Cleanup any pending rAF on unmount so we don't fire IPC after teardown.
  useEffect(() => {
    return () => {
      if (viewportIpcRafRef.current !== null) {
        cancelAnimationFrame(viewportIpcRafRef.current);
        viewportIpcRafRef.current = null;
      }
      pendingViewportIpcRef.current = null;
    };
  }, []);

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
            // Re-apply persisted emulation to each tab. CDP
            // `setDeviceMetricsOverride` may have been cleared on the
            // main-process side during unmount; even if not, this is
            // idempotent and ensures the WebContents reflects whatever
            // state the renderer just restored from localStorage.
            for (const [tabId, emulation] of emulationByTabRef.current.entries()) {
              void browserBridge.setViewport(projectId, tabId, paramsFromState(emulation));
            }
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

  const readBoundsForEmulation = useCallback((emulation: TabEmulation): BrowserRect | null => {
    const pane = paneRef.current;
    if (pane) return readBrowserRectForEmulation(pane, emulation);
    const element = rectRef.current;
    return element ? readElementRect(element) : null;
  }, []);

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
    // Don't clear url/tabs/activeTabId/emulationByTab — they're seeded
    // from the per-project cache (see `readProjectCache`) and reflect
    // the state the user last saw. The mount handler updates them with
    // main-process truth (`getUrl` / `refreshTabs`) once attached.
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
      const nextUrl = normalizeUrlInput(targetUrl);
      if (!nextUrl) return;
      const lifecycleId = lifecycleIdRef.current;
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
    if (!browserBridge || isOpeningNewTab) return;
    const lifecycleId = lifecycleIdRef.current;
    const previousTabs = tabs;
    const previousActiveTabId = activeTabId;
    const previousUrl = url;
    const optimisticTabs: BrowserTabSummary[] = [
      ...tabs.map((tab) => ({ ...tab, active: false })),
      {
        id: OPTIMISTIC_NEW_TAB_ID,
        url: "about:blank",
        title: "",
        favicon: null,
        active: true,
      },
    ];
    flushSync(() => {
      setIsOpeningNewTab(true);
      setTabs(optimisticTabs);
      setActiveTabId(OPTIMISTIC_NEW_TAB_ID);
      setUrl("");
      setError(null);
    });
    const bounds = readBoundsForEmulation(OFF_EMULATION);
    try {
      await browserBridge.newTab(projectId, undefined, bounds ?? undefined);
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
      setTabs(previousTabs);
      setActiveTabId(previousActiveTabId);
      setUrl(previousUrl);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrentLifecycle(lifecycleId)) setIsOpeningNewTab(false);
    }
  }, [
    activeTabId,
    browserBridge,
    isCurrentLifecycle,
    isOpeningNewTab,
    projectId,
    readBoundsForEmulation,
    refreshTabs,
    tabs,
    url,
  ]);

  const activateTab = useCallback(
    async (tabId: number) => {
      if (!browserBridge || tabId === activeTabId) return;
      const lifecycleId = lifecycleIdRef.current;
      const targetTab = tabs.find((tab) => tab.id === tabId);
      const bounds = readBoundsForEmulation(emulationByTab.get(tabId) ?? OFF_EMULATION);
      flushSync(() => {
        setActiveTabId(tabId);
        if (targetTab) setUrl(displayUrl(targetTab.url));
      });
      try {
        await browserBridge.switchTab(projectId, tabId, bounds ?? undefined);
        if (!isCurrentLifecycle(lifecycleId)) return;
        await refreshTabs();
      } catch (cause) {
        if (!isCurrentLifecycle(lifecycleId)) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        await refreshTabs();
      }
    },
    [
      activeTabId,
      browserBridge,
      emulationByTab,
      isCurrentLifecycle,
      projectId,
      readBoundsForEmulation,
      refreshTabs,
      tabs,
    ],
  );

  const closeTab = useCallback(
    async (tabId: number) => {
      if (!browserBridge) return;
      const lifecycleId = lifecycleIdRef.current;
      const wasActive = tabId === activeTabId;
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
      const nextActiveTab = wasActive ? remainingTabs[0] : null;
      const bounds = nextActiveTab
        ? readBoundsForEmulation(emulationByTab.get(nextActiveTab.id) ?? OFF_EMULATION)
        : null;
      flushSync(() => {
        setTabs(remainingTabs);
        if (nextActiveTab) {
          setActiveTabId(nextActiveTab.id);
          setUrl(displayUrl(nextActiveTab.url));
        }
      });
      try {
        await browserBridge.closeTab(projectId, tabId, bounds ?? undefined);
        if (!isCurrentLifecycle(lifecycleId)) return;
        await refreshTabs();
        // Drop persisted emulation for the closed tab — its tab id is
        // gone for good and won't be reused.
        setEmulationByTab((prev) => {
          if (!prev.has(tabId)) return prev;
          const map = new Map(prev);
          map.delete(tabId);
          return map;
        });
        lastEmulationByTabRef.current.delete(tabId);
      } catch (cause) {
        if (!isCurrentLifecycle(lifecycleId)) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        await refreshTabs();
      }
    },
    [
      activeTabId,
      browserBridge,
      emulationByTab,
      isCurrentLifecycle,
      projectId,
      readBoundsForEmulation,
      refreshTabs,
      tabs,
    ],
  );

  // Browser-focused keyboard shortcuts are handled
  // in the Electron main process via `before-input-event` on each tab's
  // webContents — when focus is inside the webview, keydown events never
  // bubble out to the shell's window, so a React-side listener cannot see
  // them. See `createEmbeddedBrowserTab` in apps/desktop/src/main.ts.

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate(url);
  };

  const handleGoBack = useCallback(() => {
    if (!browserBridge) return;
    void browserBridge.goBack(projectId);
  }, [browserBridge, projectId]);

  const handleGoForward = useCallback(() => {
    if (!browserBridge) return;
    void browserBridge.goForward(projectId);
  }, [browserBridge, projectId]);

  const handleReload = useCallback(() => {
    if (!browserBridge) return;
    void browserBridge.reload(projectId);
  }, [browserBridge, projectId]);

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
    <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <form
        ref={toolbarRef}
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2"
        onSubmit={handleSubmit}
      >
        <button
          type="button"
          onClick={handleGoBack}
          disabled={!browserBridge}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="Go back"
          title="Back"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleGoForward}
          disabled={!browserBridge}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="Go forward"
          title="Forward"
        >
          <ArrowRightIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          disabled={!browserBridge}
          className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label={loading ? "Loading" : "Reload"}
          title="Reload"
        >
          <RotateCwIcon className={cn("size-3.5", loading && "animate-spin")} />
        </button>
        <input
          ref={urlInputRef}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
          placeholder="Search or enter address"
          spellCheck={false}
        />
        {pinnedExtensions.slice(0, visiblePinnedCount).map((ext) => (
          <PinnedExtensionIcon
            key={ext.id}
            ext={ext}
            onOpen={(id) => void browserBridge?.openExtension(projectId, id)}
            onTogglePin={(id) => {
              if (!browserBridge) return;
              const currentlyPinned = pinnedExtensions.map((e) => e.id);
              void browserBridge.setPinnedExtensions(
                projectId,
                currentlyPinned.filter((pid) => pid !== id),
              );
            }}
            onRemove={(id) => {
              if (!browserBridge) return;
              void browserBridge.uninstallExtension(projectId, id);
            }}
          />
        ))}
        <EmbeddedBrowserExtensionsButton projectId={projectId} />
        <button
          type="button"
          onClick={toggleEmulation}
          className={cn(
            "ml-1 flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
            activeEmulation.kind !== "off"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          aria-pressed={activeEmulation.kind !== "off"}
          aria-label="Toggle device emulation"
          title="Devices"
        >
          <MonitorSmartphoneIcon className="size-3.5" />
        </button>
        {isInsidePopout ? (
          <button
            type="button"
            onClick={() => browserBridge && void browserBridge.popoutClose(projectId)}
            disabled={!browserBridge}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
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
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Open browser in new window"
            title="Open in window"
          >
            <ArrowUpRightFromSquareIcon className="size-3.5" />
          </button>
        )}
      </form>
      {browserBridge && tabs.length > 0 && (
        <div
          className="flex h-9 w-full shrink-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border bg-muted/30 pl-1.5 pr-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            disabled={atTabCap || isOpeningNewTab}
            className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            aria-label={atTabCap ? `Tab limit reached (${MAX_TABS})` : "New tab"}
            title={atTabCap ? `Tab limit reached (${MAX_TABS})` : "New tab (⌘T)"}
          >
            <PlusIcon className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      )}
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
        className={cn(
          "relative min-h-0 flex-1 bg-background",
          effectiveDimensions && "flex items-start justify-center px-6 pt-16 pb-6",
        )}
      >
        {effectiveDimensions && browserBridge ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center gap-2">
            <div className="pointer-events-auto">
              <EmbeddedBrowserViewportToolbar
                emulation={activeEmulation}
                onChange={(next) => handleEmulationChange(next, activeTabId)}
              />
            </div>
            <div className="pointer-events-auto">
              <EmbeddedBrowserViewportActions
                emulation={activeEmulation}
                onChange={(next) => handleEmulationChange(next, activeTabId)}
              />
            </div>
          </div>
        ) : null}
        <div
          className="relative"
          style={
            effectiveDimensions
              ? {
                  width: `min(${effectiveDimensions.width}px, 100%)`,
                  height: `min(${effectiveDimensions.height}px, 100%)`,
                }
              : { width: "100%", height: "100%" }
          }
        >
          <div className="absolute inset-0 overflow-hidden">
            {isDeviceEmulatorActive ? (
              <div className="pointer-events-none absolute inset-0 bg-muted" />
            ) : null}
            <div ref={rectRef} data-browser-rect className="absolute inset-0" />
          </div>
          {effectiveDimensions && browserBridge ? (
            <ViewportResizeHandles
              emulation={activeEmulation}
              onChange={(next) => handleEmulationDrag(next, activeTabId)}
            />
          ) : null}
        </div>
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
          ? "bg-background text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
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
