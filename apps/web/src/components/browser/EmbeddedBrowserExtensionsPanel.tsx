import type { BrowserExtensionInfo, ContextMenuItem } from "@t3tools/contracts";
import { PinIcon, PinOffIcon, PlusIcon, PuzzleIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { useBrowserMetadataStore } from "~/lib/browserMetadataStore";
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
// Shared context menu helper
// ---------------------------------------------------------------------------

type ExtMenuBridge = {
  showContextMenu: (
    items: readonly ContextMenuItem<string>[],
    position?: { x: number; y: number },
  ) => Promise<string | null>;
  setPinnedExtensions: (projectId: string, extensionIds: string[]) => Promise<void>;
  uninstallExtension: (projectId: string, extensionId: string) => Promise<void>;
  listExtensions: (projectId: string) => Promise<BrowserExtensionInfo[]>;
};

export async function handleExtensionContextMenu(
  ext: BrowserExtensionInfo,
  position: { x: number; y: number },
  bridge: ExtMenuBridge,
  projectId: string,
): Promise<void> {
  const items: readonly ContextMenuItem<string>[] = [
    { id: "pin", label: ext.pinned ? "Unpin from toolbar" : "Pin to toolbar" },
    { id: "remove", label: "Remove extension", destructive: true },
  ];
  const result = await bridge.showContextMenu(items, position);
  if (!result) return;
  if (result === "pin") {
    const exts = await bridge.listExtensions(projectId);
    const currentlyPinned = exts.filter((e) => e.pinned).map((e) => e.id);
    const newPinned = ext.pinned
      ? currentlyPinned.filter((id) => id !== ext.id)
      : [...currentlyPinned, ext.id];
    await bridge.setPinnedExtensions(projectId, newPinned);
  } else if (result === "remove") {
    await bridge.uninstallExtension(projectId, ext.id);
  }
}

// ---------------------------------------------------------------------------
// Shared panel content rendered in both main and overlay contexts
// ---------------------------------------------------------------------------

function ExtensionIcon({
  ext,
  onClick,
  onTogglePin,
  onContextMenu,
}: {
  ext: BrowserExtensionInfo;
  onClick: () => void;
  onTogglePin: (id: string) => void;
  onContextMenu: (id: string, pos: { x: number; y: number }) => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group relative flex flex-col items-center">
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(ext.id, { x: e.clientX, y: e.clientY });
        }}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center",
          "rounded-md border border-transparent transition-all duration-150",
          "hover:border-border hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {ext.iconUrl && !imgError ? (
          <img
            src={ext.iconUrl}
            alt={ext.name}
            className="size-4 rounded-sm object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-4 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <PuzzleIcon className="size-3" />
          </div>
        )}
      </button>
      {/* Pin/unpin badge — appears on pointer-hover */}
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(ext.id);
        }}
        title={ext.pinned ? "Unpin from toolbar" : "Pin to toolbar"}
        className={cn(
          "absolute -right-0.5 -bottom-0.5 hidden size-3.5 items-center justify-center",
          "rounded-full bg-background shadow-sm ring-1 ring-border/50",
          "transition-colors group-hover:flex",
          ext.pinned ? "text-primary hover:text-primary/70" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {ext.pinned ? <PinOffIcon className="size-2" /> : <PinIcon className="size-2" />}
      </button>
      {/* Name label fades in on pointer-hover — immune to focus events */}
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
          "flex size-7 shrink-0 items-center justify-center",
          "rounded-md border border-dashed border-border/60 transition-all duration-150",
          "text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="size-3.5" />
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
  onTogglePin,
  onContextMenu,
}: {
  extensions: BrowserExtensionInfo[];
  loading?: boolean;
  onOpenExtension: (id: string) => void;
  onOpenWebStore: () => void;
  onTogglePin: (id: string) => void;
  onContextMenu: (id: string, pos: { x: number; y: number }) => void;
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
            <ExtensionIcon
              key={ext.id}
              ext={ext}
              onClick={() => onOpenExtension(ext.id)}
              onTogglePin={onTogglePin}
              onContextMenu={onContextMenu}
            />
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
// Main renderer trigger — shown when the WebContentsView is NOT occluded
// ---------------------------------------------------------------------------

export function EmbeddedBrowserExtensionsButton({ projectId }: { projectId: string }) {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;

  // Data is pre-loaded by useBrowserMetadata in the parent (KanbanBoard).
  // Select the array reference (stable when unchanged); memoize the cast to
  // avoid creating a new array on every render when the store has no entry yet.
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
      const currentlyPinned = extensions.filter((e) => e.pinned).map((e) => e.id);
      const newPinned = ext.pinned
        ? currentlyPinned.filter((id) => id !== extensionId)
        : [...currentlyPinned, extensionId];
      void bridge.setPinnedExtensions(projectId, newPinned);
    },
    [bridge, projectId, extensions],
  );

  const handleContextMenu = useCallback(
    (extensionId: string, pos: { x: number; y: number }) => {
      if (!bridge) return;
      const ext = extensions.find((e) => e.id === extensionId);
      if (!ext) return;
      const fullBridge: ExtMenuBridge = {
        showContextMenu: (items, position) =>
          window.desktopBridge!.showContextMenu(items, position),
        setPinnedExtensions: bridge.setPinnedExtensions,
        uninstallExtension: bridge.uninstallExtension,
        listExtensions: bridge.listExtensions,
      };
      void handleExtensionContextMenu(ext, pos, fullBridge, projectId);
    },
    [bridge, projectId, extensions],
  );

  const route = useRoutedPopoverSurface<
    HTMLButtonElement,
    { kind: string; extensionId?: string; x?: number; y?: number } | null
  >({
    routeKey: EXTENSIONS_PANEL_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    side: "bottom",
    params: { projectId, extensions, loading },
    onEvent: (_type, payload) => {
      if (typeof payload !== "object" || payload === null) return;
      const p = payload as { kind?: string; extensionId?: string; x?: number; y?: number };
      if (p.kind === "open" && p.extensionId) {
        void bridge?.openExtension(projectId, p.extensionId);
      } else if (p.kind === "webstore") {
        void bridge?.navigate(projectId, WEBSTORE_URL);
      } else if (p.kind === "togglePin" && p.extensionId) {
        handleTogglePin(p.extensionId);
        return; // don't close panel
      } else if (
        p.kind === "contextmenu" &&
        p.extensionId &&
        p.x !== undefined &&
        p.y !== undefined
      ) {
        const ext = extensions.find((e) => e.id === p.extensionId);
        if (ext && bridge) {
          const fullBridge: ExtMenuBridge = {
            showContextMenu: (items, position) =>
              window.desktopBridge!.showContextMenu(items, position),
            setPinnedExtensions: bridge.setPinnedExtensions,
            uninstallExtension: bridge.uninstallExtension,
            listExtensions: bridge.listExtensions,
          };
          void handleExtensionContextMenu(ext, { x: p.x, y: p.y }, fullBridge, projectId);
        }
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
          onContextMenu={handleContextMenu}
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
            onContextMenu={(id, pos) => {
              controller.bridge.emitEvent("event", {
                kind: "contextmenu",
                extensionId: id,
                x: pos.x,
                y: pos.y,
              });
            }}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
