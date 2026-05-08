import type { BrowserExtensionInfo } from "@t3tools/contracts";
import { PlusIcon, PuzzleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { cn } from "~/lib/utils";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const EXTENSIONS_PANEL_OVERLAY_ROUTE_KEY = "browser-extensions-panel";
const WEBSTORE_URL = "https://chromewebstore.google.com";

function isBrowserExtensionInfo(value: unknown): value is BrowserExtensionInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).name === "string"
  );
}

function parseExtensionsParam(raw: unknown): BrowserExtensionInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isBrowserExtensionInfo);
}

// ---------------------------------------------------------------------------
// Shared panel content rendered in both main and overlay contexts
// ---------------------------------------------------------------------------

function ExtensionIcon({ ext, onClick }: { ext: BrowserExtensionInfo; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);

  // Pure CSS label — no JS tooltip so focus-on-open can't trigger it spuriously.
  return (
    <div className="group relative flex flex-col items-center">
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center",
          "rounded-lg border border-transparent transition-all duration-150",
          "hover:border-border hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {ext.iconUrl && !imgError ? (
          <img
            src={ext.iconUrl}
            alt={ext.name}
            className="size-6 rounded-md object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PuzzleIcon className="size-3.5" />
          </div>
        )}
      </button>
      {/* Name fades in on pointer-hover only — immune to focus events */}
      <span className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 shadow transition-opacity delay-500 group-hover:opacity-100 max-w-20 truncate">
        {ext.name}
      </span>
    </div>
  );
}

function AddExtensionButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="group relative flex flex-col items-center">
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center",
          "rounded-lg border border-dashed border-border/60 transition-all duration-150",
          "text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="size-4" />
      </button>
      <span className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 shadow transition-opacity delay-500 group-hover:opacity-100">
        Browse Web Store
      </span>
    </div>
  );
}

function ExtensionsPanelContent({
  extensions,
  loading,
  onOpenExtension,
  onOpenWebStore,
}: {
  extensions: BrowserExtensionInfo[];
  loading?: boolean;
  onOpenExtension: (id: string) => void;
  onOpenWebStore: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3 pb-6">
      <p className="px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
        Extensions
      </p>
      {loading ? (
        <div className="flex h-12 items-center justify-center">
          <div className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground/40" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {extensions.map((ext) => (
            <ExtensionIcon key={ext.id} ext={ext} onClick={() => onOpenExtension(ext.id)} />
          ))}
          <AddExtensionButton onClick={onOpenWebStore} />
        </div>
      )}
      {!loading && extensions.length === 0 && (
        <p className="px-0.5 text-[11px] text-muted-foreground/50">
          No extensions installed. Click + to browse the Web Store.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main renderer trigger — shown when the WebContentsView is NOT occludes
// ---------------------------------------------------------------------------

// Module-level cache keyed by projectId — persists across component remounts
// so the panel shows instantly on second open instead of re-fetching from disk.
const extensionCache = new Map<string, BrowserExtensionInfo[]>();

export function EmbeddedBrowserExtensionsButton({ projectId }: { projectId: string }) {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  const [extensions, setExtensions] = useState<BrowserExtensionInfo[]>(
    () => extensionCache.get(projectId) ?? [],
  );
  const [loading, setLoading] = useState(() => !extensionCache.has(projectId));

  // Fetch in the main renderer (which has desktopBridge). The overlay renderer
  // uses overlay-preload.js and has no desktopBridge, so it can't call IPC —
  // data reaches the overlay via params instead.
  const refresh = useCallback(
    (force = false) => {
      if (!bridge) return;
      if (!force && extensionCache.has(projectId)) return; // serve from cache
      setLoading(true);
      void bridge.listExtensions(projectId).then((exts) => {
        extensionCache.set(projectId, exts);
        setExtensions(exts);
        setLoading(false);
      });
    },
    [bridge, projectId],
  );

  // Load once on mount (no-op if already cached).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for the main process notifying that the extension list changed
  // (e.g. after reloadPersistedExtensions completes on startup, or after install).
  useEffect(() => {
    if (!bridge) return;
    return bridge.onExtensionsChanged((changedProjectId) => {
      if (changedProjectId !== projectId) return;
      extensionCache.delete(projectId); // invalidate so next refresh re-fetches
      refresh();
    });
  }, [bridge, projectId, refresh]);

  const route = useRoutedPopoverSurface<HTMLButtonElement, { kind: string; extensionId?: string }>({
    routeKey: EXTENSIONS_PANEL_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    side: "bottom",
    // Pass extensions + loading so the overlay can render correct state without IPC.
    params: { projectId, extensions, loading },
    onEvent: (_type, payload) => {
      if (typeof payload !== "object" || payload === null) return;
      const p = payload as { kind?: string; extensionId?: string };
      if (p.kind === "open" && p.extensionId) {
        void bridge?.openExtension(projectId, p.extensionId);
      } else if (p.kind === "webstore") {
        void bridge?.navigate(projectId, WEBSTORE_URL);
      }
      route.onOpenChange(false);
    },
  });

  // Force-refresh when the panel opens to pick up newly installed extensions.
  useEffect(() => {
    if (route.domOpen) refresh(true);
  }, [route.domOpen, refresh]);

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              className={cn(
                "relative flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                route.domOpen && "bg-accent text-foreground",
              )}
              onFocusCapture={route.updateAnchor}
              onMouseOverCapture={route.updateAnchor}
              ref={route.triggerRef}
            >
              <PuzzleIcon className="size-3.5" />
              {extensions.length > 0 && (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
              )}
            </MenuTrigger>
          }
        />
        <TooltipPopup side="bottom">Extensions</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="w-56 p-0">
        <ExtensionsPanelContent
          extensions={extensions}
          loading={loading}
          onOpenExtension={(id) => {
            void bridge?.openExtension(projectId, id);
            route.onOpenChange(false);
          }}
          onOpenWebStore={() => {
            void bridge?.navigate(projectId, WEBSTORE_URL);
            route.onOpenChange(false);
          }}
        />
      </MenuPopup>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// Overlay route — shown when the WebContentsView occludes the popup area
// ---------------------------------------------------------------------------

registerOverlayRoute<{ projectId?: unknown; extensions?: unknown; loading?: unknown }>(
  EXTENSIONS_PANEL_OVERLAY_ROUTE_KEY,
  function ExtensionsPanelOverlayRoute({ message, controller }) {
    // Data comes from the main renderer via params — the overlay preload has no
    // desktopBridge, so IPC calls are not possible here.
    const extensions = parseExtensionsParam(message.params.extensions);
    const loading = message.params.loading === true;

    return (
      <OverlayRouteMenu>
        <OverlayRouteMenuPopup align="end" side="bottom" className="w-56 p-0">
          <ExtensionsPanelContent
            extensions={extensions}
            loading={loading}
            onOpenExtension={(id) => {
              controller.bridge.emitEvent("event", { kind: "open", extensionId: id });
            }}
            onOpenWebStore={() => {
              controller.bridge.emitEvent("event", { kind: "webstore" });
            }}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
