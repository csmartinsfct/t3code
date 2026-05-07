import { memo, useCallback, useMemo } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileCode2Icon,
  LayoutListIcon,
  SearchCheckIcon,
} from "lucide-react";
import type { OverlayMenuItem } from "@t3tools/contracts";

import type { OrchestrationSwitcherItem } from "../../hooks/useOrchestrationSwitcher";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ThreadSwitcherDropdownProps {
  items: OrchestrationSwitcherItem[];
  currentLabel: string;
  onNavigate: (threadId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ThreadSwitcherDropdown = memo(function ThreadSwitcherDropdown({
  items,
  currentLabel,
  onNavigate,
}: ThreadSwitcherDropdownProps) {
  const timelineItem = useMemo(() => items.find((i) => i.kind === "timeline"), [items]);
  const threadItems = useMemo(() => items.filter((i) => i.kind !== "timeline"), [items]);
  const overlayItems = useMemo<OverlayMenuItem[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.sublabel ? { description: item.sublabel } : {}),
        icon:
          item.kind === "timeline"
            ? "LayoutList"
            : item.kind === "review-thread"
              ? "SearchCheck"
              : "FileCode2",
        iconClassName: item.kind === "review-thread" ? "size-3 text-info-foreground" : "size-3",
        ...(item.isActive
          ? { badge: "Current" }
          : item.kind === "review-thread"
            ? { badge: "Review" }
            : {}),
      })),
    [items],
  );

  const handleOverlaySelect = useCallback(
    (id: string) => {
      const item = items.find((entry) => entry.id === id);
      if (item) onNavigate(item.threadId);
    },
    [items, onNavigate],
  );

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
    <Menu
      overlayItems={overlayItems}
      overlayMenuAlign="start"
      overlayOnSelect={handleOverlaySelect}
    >
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:max-w-[280px]"
          />
        }
      >
        <span className="min-w-0 truncate">{currentLabel}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>

      <MenuPopup align="start" className="w-[320px] [&>div]:max-h-[400px]">
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
      </MenuPopup>
    </Menu>
  );
});
