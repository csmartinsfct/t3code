import type { BrowserTabListing, BrowserTabSummary, ProjectId } from "@t3tools/contracts";
import { ArrowRightIcon, GlobeIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";

import { setEmbeddedBrowserMountedForModalSuspension } from "~/embeddedBrowserModalSuspension";

import { Button } from "../ui/button";

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
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const mountPromiseRef = useRef<Promise<void> | null>(null);
  const disposedRef = useRef(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState(displayUrl(DEFAULT_URL));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<readonly BrowserTabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState<number>(0);

  const browserBridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  const applyTabListing = useCallback((listing: BrowserTabListing) => {
    setTabs(listing.tabs);
    setActiveTabId(listing.activeTabId);
    const activeTab = listing.tabs.find((tab) => tab.id === listing.activeTabId);
    // Always sync the URL bar to the active tab — empty string for about:blank
    // so the placeholder is visible and Cmd+A / typing starts fresh.
    if (activeTab) setUrl(displayUrl(activeTab.url));
  }, []);

  const refreshTabs = useCallback(async () => {
    if (!browserBridge) return;
    try {
      applyTabListing(await browserBridge.listTabs());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [applyTabListing, browserBridge]);

  const syncBounds = useCallback(async () => {
    const element = rectRef.current;
    if (!element || !browserBridge) return;
    const bounds = readElementRect(element);
    if (bounds.width <= 0 || bounds.height <= 0) return;

    if (!mountedRef.current) {
      if (!mountPromiseRef.current) {
        mountPromiseRef.current = browserBridge
          .mount(projectId, bounds)
          .then(async () => {
            if (disposedRef.current) return;
            mountedRef.current = true;
            setEmbeddedBrowserMountedForModalSuspension(true);
            const currentUrl = await browserBridge.getUrl();
            setUrl(displayUrl(currentUrl));
            await refreshTabs();
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            mountPromiseRef.current = null;
          });
      }
      await mountPromiseRef.current;
      return;
    }

    try {
      await browserBridge.setBounds(bounds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [browserBridge, projectId, refreshTabs]);

  const scheduleBoundsSync = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      void syncBounds();
    });
  }, [syncBounds]);

  useEffect(() => {
    if (!browserBridge) return;
    const element = rectRef.current;
    if (!element) return;

    disposedRef.current = false;
    scheduleBoundsSync();
    const observer = new ResizeObserver(scheduleBoundsSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleBoundsSync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      disposedRef.current = true;
      const pendingMount = mountPromiseRef.current;
      const shouldUnmount = mountedRef.current || pendingMount !== null;
      mountedRef.current = false;
      setEmbeddedBrowserMountedForModalSuspension(false);
      void (async () => {
        await pendingMount?.catch(() => {});
        if (shouldUnmount) {
          await browserBridge.unmount();
        }
      })();
    };
  }, [browserBridge, scheduleBoundsSync]);

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
      setLoading(true);
      setError(null);
      try {
        await browserBridge.navigate(nextUrl);
        const currentUrl = await browserBridge.getUrl();
        setUrl(currentUrl || nextUrl);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [browserBridge],
  );

  const openNewTab = useCallback(async () => {
    if (!browserBridge) return;
    try {
      await browserBridge.newTab();
      await refreshTabs();
      // Focus the URL input after the DOM has rendered the empty state so the
      // user can just start typing.
      requestAnimationFrame(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [browserBridge, refreshTabs]);

  const activateTab = useCallback(
    async (tabId: number) => {
      if (!browserBridge || tabId === activeTabId) return;
      try {
        await browserBridge.switchTab(tabId);
        await refreshTabs();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [activeTabId, browserBridge, refreshTabs],
  );

  const closeTab = useCallback(
    async (tabId: number) => {
      if (!browserBridge) return;
      try {
        await browserBridge.closeTab(tabId);
        await refreshTabs();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [browserBridge, refreshTabs],
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
      </form>
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
      <div ref={rectRef} data-browser-rect className="min-h-0 flex-1 bg-background" />
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
