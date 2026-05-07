import { ArrowUpDownIcon } from "lucide-react";
import { useRef } from "react";

import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const SIDEBAR_SORT_MENU_OVERLAY_ROUTE_KEY = "sidebar-sort-menu";

const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};

const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

type SidebarSortMenuResult =
  | { kind: "project"; sortOrder: SidebarProjectSortOrder }
  | { kind: "thread"; sortOrder: SidebarThreadSortOrder };

function SidebarSortMenuContent({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <>
      <MenuGroup>
        <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">Sort projects</div>
        <MenuRadioGroup value={projectSortOrder} onValueChange={onProjectSortOrderChange}>
          {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
            ([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ),
          )}
        </MenuRadioGroup>
      </MenuGroup>
      <MenuGroup>
        <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
          Sort threads
        </div>
        <MenuRadioGroup value={threadSortOrder} onValueChange={onThreadSortOrderChange}>
          {(
            Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
          ).map(([value, label]) => (
            <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </>
  );
}

export function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  const route = useRoutedPopoverSurface<HTMLButtonElement, SidebarSortMenuResult>({
    routeKey: SIDEBAR_SORT_MENU_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    side: "bottom",
    interaction: "click",
    params: {
      projectSortOrder,
      threadSortOrder,
    },
    onEvent: (type, payload) => {
      if (type !== "sort-change" || !isSidebarSortMenuResult(payload)) return;
      const result = payload;
      if (result.kind === "project") {
        onProjectSortOrderChange(result.sortOrder);
      } else {
        onThreadSortOrderChange(result.sortOrder);
      }
    },
  });

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              onFocusCapture={route.updateAnchor}
              onMouseOverCapture={route.updateAnchor}
              ref={route.triggerRef}
            />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sort projects</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <SidebarSortMenuContent
          projectSortOrder={projectSortOrder}
          threadSortOrder={threadSortOrder}
          onProjectSortOrderChange={onProjectSortOrderChange}
          onThreadSortOrderChange={onThreadSortOrderChange}
        />
      </MenuPopup>
    </Menu>
  );
}

registerOverlayRoute<{
  projectSortOrder?: unknown;
  threadSortOrder?: unknown;
}>(
  SIDEBAR_SORT_MENU_OVERLAY_ROUTE_KEY,
  function SidebarSortMenuOverlayRoute({ message, controller }) {
    const projectSortOrder = readProjectSortOrderParam(message.params.projectSortOrder);
    const threadSortOrder = readThreadSortOrderParam(message.params.threadSortOrder);
    const suppressSelectionCloseRef = useRef(false);

    const emitSortChange = (result: SidebarSortMenuResult) => {
      suppressSelectionCloseRef.current = true;
      controller.bridge.emitEvent("sort-change", result);
    };

    return (
      <Menu
        open
        trackEmbeddedBrowserOverlay={false}
        onOpenChange={(open, details) => {
          if (open) return;
          if (suppressSelectionCloseRef.current) {
            suppressSelectionCloseRef.current = false;
            return;
          }
          if (!shouldDismissSidebarSortMenuRoute(getOpenChangeReason(details))) return;
          controller.cancel("dismissed");
        }}
      >
        <OverlayRouteMenuPopup align="end" side="bottom" className="min-w-44">
          <SidebarSortMenuContent
            projectSortOrder={projectSortOrder}
            threadSortOrder={threadSortOrder}
            onProjectSortOrderChange={(sortOrder) =>
              emitSortChange({
                kind: "project",
                sortOrder,
              } satisfies SidebarSortMenuResult)
            }
            onThreadSortOrderChange={(sortOrder) =>
              emitSortChange({
                kind: "thread",
                sortOrder,
              } satisfies SidebarSortMenuResult)
            }
          />
        </OverlayRouteMenuPopup>
      </Menu>
    );
  },
);

function isSidebarSortMenuResult(value: unknown): value is SidebarSortMenuResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Record<keyof SidebarSortMenuResult, unknown>>;
  if (candidate.kind === "project") return isProjectSortOrder(candidate.sortOrder);
  if (candidate.kind === "thread") return isThreadSortOrder(candidate.sortOrder);
  return false;
}

function readProjectSortOrderParam(value: unknown): SidebarProjectSortOrder {
  return isProjectSortOrder(value) ? value : "updated_at";
}

function readThreadSortOrderParam(value: unknown): SidebarThreadSortOrder {
  return isThreadSortOrder(value) ? value : "updated_at";
}

function isProjectSortOrder(value: unknown): value is SidebarProjectSortOrder {
  return value === "created_at" || value === "manual" || value === "updated_at";
}

function isThreadSortOrder(value: unknown): value is SidebarThreadSortOrder {
  return value === "created_at" || value === "updated_at";
}

function getOpenChangeReason(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

export function shouldDismissSidebarSortMenuRoute(reason: string | null): boolean {
  return reason === "outside-press" || reason === "escape-key";
}
