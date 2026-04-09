import { memo } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileCode2Icon,
  LayoutListIcon,
  SearchCheckIcon,
} from "lucide-react";

import type { OrchestrationSwitcherItem } from "../../hooks/useOrchestrationSwitcher";
import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ThreadSwitcherDropdownProps {
  items: OrchestrationSwitcherItem[];
  currentLabel: string;
  onNavigate: (threadId: string) => void;
}

// ---------------------------------------------------------------------------
// Status dot colors
// ---------------------------------------------------------------------------

function statusDotClass(item: OrchestrationSwitcherItem): string {
  if (item.kind === "timeline") return "";
  if (item.kind === "review-thread") {
    if (!item.isStarted) return "bg-muted-foreground/20";
    if (item.isActive) return "bg-sky-500";
    return "bg-sky-500/75";
  }
  if (!item.isStarted) return "bg-muted-foreground/30";
  if (item.isActive) return "bg-amber-500";
  return "bg-emerald-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ThreadSwitcherDropdown = memo(function ThreadSwitcherDropdown({
  items,
  currentLabel,
  onNavigate,
}: ThreadSwitcherDropdownProps) {
  const timelineItem = items.find((i) => i.kind === "timeline");
  const threadItems = items.filter((i) => i.kind !== "timeline");

  return (
    <Menu>
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

      <MenuPopup align="start" className="w-[300px]">
        {/* Timeline item */}
        {timelineItem && (
          <MenuItem
            className={cn("gap-2.5", timelineItem.isActive && "bg-accent/60")}
            onClick={() => onNavigate(timelineItem.threadId)}
          >
            <LayoutListIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-sm font-medium sm:text-xs">Timeline</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground/50 sm:text-[10px]">
                {timelineItem.sublabel}
              </span>
            </div>
            {timelineItem.isActive && <CheckIcon className="size-3 shrink-0 text-foreground/70" />}
          </MenuItem>
        )}

        {threadItems.length > 0 && <MenuSeparator />}

        {/* Working thread items */}
        {threadItems.map((item) => (
          <MenuItem
            key={item.id}
            className={cn(
              "gap-2.5",
              item.isActive && "bg-accent/60",
              !item.isStarted && "opacity-55",
              item.kind === "review-thread" && "pl-7",
            )}
            onClick={() => onNavigate(item.threadId)}
          >
            {item.kind === "review-thread" ? (
              <SearchCheckIcon className="size-3.5 shrink-0 text-sky-500/80" />
            ) : (
              <FileCode2Icon className="size-3.5 shrink-0 text-emerald-500/80" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium sm:text-xs">{item.label}</span>
                {item.kind === "review-thread" && (
                  <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                    Review
                  </span>
                )}
              </div>
              {item.sublabel && (
                <span className="min-w-0 truncate text-xs text-muted-foreground/50 sm:text-[10px]">
                  {item.sublabel}
                </span>
              )}
            </div>
            <span className={cn("mt-px size-1.5 shrink-0 rounded-full", statusDotClass(item))} />
            {item.isActive && <CheckIcon className="size-3 shrink-0 text-foreground/70" />}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
});
