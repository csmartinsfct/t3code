import { memo, useCallback } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileCode2Icon,
  LayoutListIcon,
  SearchCheckIcon,
} from "lucide-react";

import type { OrchestrationSwitcherItem } from "../../hooks/useOrchestrationSwitcher";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ThreadSwitcherDropdownProps {
  items: OrchestrationSwitcherItem[];
  currentLabel: string;
  onNavigate: (threadId: string) => void;
}

const THREAD_SWITCHER_MENU_OVERLAY_ROUTE_KEY = "thread-switcher-menu";

type ThreadSwitcherMenuResult = { threadId: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ThreadSwitcherDropdown = memo(function ThreadSwitcherDropdown({
  items,
  currentLabel,
  onNavigate,
}: ThreadSwitcherDropdownProps) {
  const route = useRoutedPopoverSurface<HTMLButtonElement, ThreadSwitcherMenuResult>({
    routeKey: THREAD_SWITCHER_MENU_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: { items },
    onResult: (result) => onNavigate(result.threadId),
  });

  // Scroll the active item into view when the menu mounts it
  const activeRefCallback = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      // Defer so the popup is fully laid out before scrolling
      requestAnimationFrame(() => {
        node.scrollIntoView({ block: "center" });
      });
    }
  }, []);

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:max-w-[280px]"
            onFocusCapture={route.updateAnchor}
            onMouseOverCapture={route.updateAnchor}
            ref={route.triggerRef}
          />
        }
      >
        <span className="min-w-0 truncate">{currentLabel}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>

      <MenuPopup align="start" className="w-[320px] [&>div]:max-h-[400px]">
        <ThreadSwitcherMenuContent
          activeRefCallback={activeRefCallback}
          items={items}
          onNavigate={onNavigate}
        />
      </MenuPopup>
    </Menu>
  );
});

function ThreadSwitcherMenuContent({
  activeRefCallback,
  items,
  onNavigate,
}: {
  activeRefCallback?: ((node: HTMLDivElement | null) => void) | undefined;
  items: readonly OrchestrationSwitcherItem[];
  onNavigate: (threadId: string) => void;
}) {
  const timelineItem = items.find((item) => item.kind === "timeline");
  const threadItems = items.filter((item) => item.kind !== "timeline");

  return (
    <>
      {timelineItem && (
        <MenuItem
          className={cn("mb-1.5 gap-2", timelineItem.isActive && "bg-accent")}
          onClick={() => onNavigate(timelineItem.threadId)}
        >
          <LayoutListIcon className="size-3.5 shrink-0 sm:size-3" />
          <span className="text-base font-medium sm:text-sm">Timeline</span>
          <span className="flex-1" />
          {timelineItem.isActive && (
            <CheckIcon className="size-3.5 shrink-0 text-foreground/70 sm:size-3" />
          )}
        </MenuItem>
      )}
      {threadItems.length > 0 && (
        <>
          {threadItems.map((item) => {
            const isReview = item.kind === "review-thread";

            return (
              <MenuItem
                key={item.id}
                ref={item.isActive ? activeRefCallback : undefined}
                className={cn(
                  "items-start gap-2",
                  item.isActive && "bg-accent",
                  !item.isStarted && "opacity-50",
                  isReview && "pl-6",
                )}
                onClick={() => onNavigate(item.threadId)}
              >
                {isReview ? (
                  <SearchCheckIcon className="mt-[5px] size-3.5 shrink-0 text-info-foreground sm:mt-1 sm:size-3" />
                ) : (
                  <FileCode2Icon className="mt-[5px] size-3.5 shrink-0 text-success-foreground sm:mt-1 sm:size-3" />
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-medium sm:text-sm">{item.label}</span>
                    {isReview && (
                      <Badge variant="info" size="sm">
                        Review
                      </Badge>
                    )}
                  </div>
                  {item.sublabel && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground sm:text-[11px]">
                      {item.sublabel}
                    </span>
                  )}
                </div>

                {item.isActive && (
                  <CheckIcon className="mt-[5px] size-3.5 shrink-0 text-foreground/70 sm:mt-1 sm:size-3" />
                )}
              </MenuItem>
            );
          })}
        </>
      )}
    </>
  );
}

registerOverlayRoute<{
  items?: unknown;
}>(
  THREAD_SWITCHER_MENU_OVERLAY_ROUTE_KEY,
  function ThreadSwitcherMenuOverlayRoute({ message, controller }) {
    const items = readThreadSwitcherItemsParam(message.params.items);

    return (
      <OverlayRouteMenu>
        <OverlayRouteMenuPopup align="start" className="w-[320px] [&>div]:max-h-[400px]">
          <ThreadSwitcherMenuContent
            items={items}
            onNavigate={(threadId) => controller.submit({ threadId })}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);

function readThreadSwitcherItemsParam(value: unknown): OrchestrationSwitcherItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is OrchestrationSwitcherItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<Record<keyof OrchestrationSwitcherItem, unknown>>;
    return (
      typeof candidate.id === "string" &&
      (candidate.kind === "timeline" ||
        candidate.kind === "working-thread" ||
        candidate.kind === "review-thread") &&
      typeof candidate.label === "string" &&
      typeof candidate.sublabel === "string" &&
      typeof candidate.isActive === "boolean" &&
      typeof candidate.isStarted === "boolean" &&
      typeof candidate.threadId === "string"
    );
  });
}
