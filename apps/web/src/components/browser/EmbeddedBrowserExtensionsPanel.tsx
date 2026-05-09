import type { BrowserExtensionInfo } from "@t3tools/contracts";
import { PinIcon, PlusIcon, PuzzleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { useBrowserMetadataStore, optimisticTogglePin } from "~/lib/browserMetadataStore";
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
// Portal context menu — renders at document.body to avoid Radix Menu conflicts
// ---------------------------------------------------------------------------

type PanelContextMenuState = {
  ext: BrowserExtensionInfo;
  x: number;
  y: number;
};

function PanelContextMenu({
  state,
  onClose,
  onTogglePin,
  onRemove,
  onReload,
}: {
  state: PanelContextMenuState;
  onClose: () => void;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
  onReload?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const x = Math.min(state.x, window.innerWidth - 176);
  const y = Math.min(state.y, window.innerHeight - 80);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[168px] overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        className="flex w-full items-center px-3 py-1.5 text-[13px] text-popover-foreground transition-colors hover:bg-accent"
        onClick={() => {
          onTogglePin(state.ext.id);
          onClose();
        }}
      >
        {state.ext.pinned ? "Unpin from toolbar" : "Pin to toolbar"}
      </button>
      <div className="my-1 h-px bg-border" />
      {state.ext.isUnpacked && (
        <>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="flex w-full items-center px-3 py-1.5 text-[13px] text-popover-foreground transition-colors hover:bg-accent"
            onClick={() => {
              onReload?.(state.ext.id);
              onClose();
            }}
          >
            Reload extension
          </button>
        </>
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className="flex w-full items-center px-3 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/10"
        onClick={() => {
          onRemove(state.ext.id);
          onClose();
        }}
      >
        Remove extension
      </button>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Extension tile
// ---------------------------------------------------------------------------

function ExtensionIcon({
  ext,
  onClick,
  onTogglePin,
  onRemove,
  onContextMenu,
}: {
  ext: BrowserExtensionInfo;
  onClick: () => void;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
  onContextMenu: (ext: BrowserExtensionInfo, x: number, y: number) => void;
}) {
  const [imgError, setImgError] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(ext, e.clientX, e.clientY);
  };

  return (
    <div className="group relative size-8 shrink-0">
      {/* Main tile */}
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex size-full items-center justify-center rounded-md border border-border/40",
          "bg-accent/20 transition-all duration-100",
          "hover:border-border hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {ext.iconUrl && !imgError ? (
          <img
            src={ext.iconUrl}
            alt={ext.name}
            className="size-[18px] rounded-sm object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-[18px] items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <PuzzleIcon className="size-3" />
          </div>
        )}
      </button>

      {/* Pin badge — inside tile boundary at bottom-right */}
      <button
        type="button"
        tabIndex={-1}
        onContextMenu={handleContextMenu}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(ext.id);
        }}
        className={cn(
          "absolute -bottom-[2px] -right-[2px] z-10 flex size-[14px] items-center justify-center",
          "rounded-full bg-background/90 shadow-sm ring-1 transition-all duration-100",
          ext.pinned
            ? "opacity-100 ring-primary/50"
            : "opacity-0 ring-border/50 group-hover:opacity-100",
        )}
      >
        <PinIcon
          className={cn(
            "size-2",
            ext.pinned ? "fill-primary text-primary" : "text-muted-foreground",
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add extension button
// ---------------------------------------------------------------------------

function AddExtensionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed",
        "border-border/50 text-muted-foreground/50 transition-all duration-100",
        "hover:border-border hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <PlusIcon className="size-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Panel content — shared between main renderer and overlay
// ---------------------------------------------------------------------------

function ExtensionsPanelContent({
  extensions,
  onOpenExtension,
  onOpenWebStore,
  onTogglePin,
  onRemove,
  onLoadUnpacked,
  onReload,
}: {
  extensions: BrowserExtensionInfo[];
  loading?: boolean;
  onOpenExtension: (id: string) => void;
  onOpenWebStore: () => void;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
  onLoadUnpacked?: () => void;
  onReload?: (id: string) => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<PanelContextMenuState | null>(null);

  return (
    <div className="flex flex-col gap-3 p-3 pb-5">
      <p className="px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        Extensions
      </p>

      {extensions.length === 0 ? (
        <p className="px-0.5 text-[11px] text-muted-foreground/50">
          No extensions installed. Click + to browse the Web Store.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {extensions.map((ext) => (
            <ExtensionIcon
              key={ext.id}
              ext={ext}
              onClick={() => onOpenExtension(ext.id)}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
              onContextMenu={(e, x, y) => setCtxMenu({ ext: e, x, y })}
            />
          ))}
          <AddExtensionButton onClick={onOpenWebStore} />
        </div>
      )}

      {onLoadUnpacked && (
        <button
          type="button"
          onClick={onLoadUnpacked}
          className="mt-0.5 w-full rounded px-1.5 py-1 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground/80"
        >
          Load unpacked...
        </button>
      )}

      {ctxMenu && (
        <PanelContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onTogglePin={(id) => {
            onTogglePin(id);
            setCtxMenu(null);
          }}
          onRemove={(id) => {
            onRemove(id);
            setCtxMenu(null);
          }}
          {...(onReload ? { onReload } : {})}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main renderer trigger — shown when the WebContentsView is NOT occluded
// ---------------------------------------------------------------------------

export function EmbeddedBrowserExtensionsButton({ projectId }: { projectId: string }) {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  const storeExtensions = useBrowserMetadataStore((s) => s.entries[projectId]?.extensions);
  const storeStatus = useBrowserMetadataStore((s) => s.entries[projectId]?.status);
  const extensions = useMemo(
    () => (storeExtensions as BrowserExtensionInfo[] | undefined) ?? [],
    [storeExtensions],
  );
  const loading = !storeStatus || storeStatus === "loading";

  const handleTogglePin = useCallback(
    (extensionId: string) => {
      if (!bridge) return;
      const ext = extensions.find((e) => e.id === extensionId);
      if (!ext) return;
      // Optimistic update — no loading spinner, UI updates instantly
      optimisticTogglePin(projectId as Parameters<typeof optimisticTogglePin>[0], extensionId);
      const currentlyPinned = extensions.filter((e) => e.pinned).map((e) => e.id);
      const newPinned = ext.pinned
        ? currentlyPinned.filter((id) => id !== extensionId)
        : [...currentlyPinned, extensionId];
      void bridge.setPinnedExtensions(projectId, newPinned);
    },
    [bridge, projectId, extensions],
  );

  const handleRemove = useCallback(
    (extensionId: string) => {
      if (!bridge) return;
      void bridge.uninstallExtension(projectId, extensionId);
    },
    [bridge, projectId],
  );

  const handleLoadUnpacked = useCallback(() => {
    void bridge?.pickAndLoadUnpackedExtension(projectId);
  }, [bridge, projectId]);

  const handleReload = useCallback(
    (extensionId: string) => {
      void bridge?.reloadExtension(projectId, extensionId);
    },
    [bridge, projectId],
  );

  const route = useRoutedPopoverSurface<
    HTMLButtonElement,
    { kind: string; extensionId?: string } | null
  >({
    routeKey: EXTENSIONS_PANEL_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    side: "bottom",
    params: { projectId, extensions, loading },
    onEvent: (_type, payload) => {
      if (typeof payload !== "object" || payload === null) return;
      const p = payload as { kind?: string; extensionId?: string };
      if (p.kind === "open" && p.extensionId) {
        void bridge?.openExtension(projectId, p.extensionId);
      } else if (p.kind === "webstore") {
        void bridge?.navigate(projectId, WEBSTORE_URL);
      } else if (p.kind === "togglePin" && p.extensionId) {
        handleTogglePin(p.extensionId);
        return;
      } else if (p.kind === "remove" && p.extensionId) {
        handleRemove(p.extensionId);
        return;
      } else if (p.kind === "loadUnpacked") {
        handleLoadUnpacked();
        return;
      } else if (p.kind === "reload" && p.extensionId) {
        handleReload(p.extensionId);
        return;
      }
      route.onOpenChange(false);
    },
  });

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
          onTogglePin={handleTogglePin}
          onRemove={handleRemove}
          onLoadUnpacked={handleLoadUnpacked}
          onReload={handleReload}
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
            onTogglePin={(id) => {
              controller.bridge.emitEvent("event", { kind: "togglePin", extensionId: id });
            }}
            onRemove={(id) => {
              controller.bridge.emitEvent("event", { kind: "remove", extensionId: id });
            }}
            onLoadUnpacked={() => {
              controller.bridge.emitEvent("event", { kind: "loadUnpacked" });
            }}
            onReload={(id) => {
              controller.bridge.emitEvent("event", { kind: "reload", extensionId: id });
            }}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
