import type { TicketPriority } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  GlobeIcon,
  LayoutGridIcon,
  ListIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type { BoardViewMode } from "../../uiStateStore";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ALL_PRIORITIES, PRIORITY_CONFIG } from "../settings/ticketUtils";
import { PriorityIcon } from "./PriorityIcon";

interface BoardToolbarProps {
  priorityFilter: Set<string>;
  onPriorityFilterChange: (filter: Set<string>) => void;
  labelFilter: Set<string>;
  onLabelFilterChange: (filter: Set<string>) => void;
  availableLabels: ReadonlyArray<{ id: string; name: string; color: string }>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  viewMode: BoardViewMode;
  onViewModeChange: (mode: BoardViewMode) => void;
}

function FilterCheck({ checked }: { checked: boolean }) {
  return (
    <div
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {checked && (
        <svg
          className="size-2.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      )}
    </div>
  );
}

export function BoardToolbar({
  priorityFilter,
  onPriorityFilterChange,
  labelFilter,
  onLabelFilterChange,
  availableLabels,
  searchQuery,
  onSearchQueryChange,
  viewMode,
  onViewModeChange,
}: BoardToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(!!searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const togglePriority = useCallback(
    (p: string) => {
      const next = new Set(priorityFilter);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      onPriorityFilterChange(next);
    },
    [priorityFilter, onPriorityFilterChange],
  );

  const toggleLabel = useCallback(
    (id: string) => {
      const next = new Set(labelFilter);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onLabelFilterChange(next);
    },
    [labelFilter, onLabelFilterChange],
  );

  const priorityText =
    priorityFilter.size === 0
      ? "Priority"
      : priorityFilter.size === 1
        ? (PRIORITY_CONFIG[[...priorityFilter][0] as TicketPriority]?.label ?? "Priority")
        : `Priority \u00b7 ${priorityFilter.size}`;

  const labelText = labelFilter.size === 0 ? "Labels" : `Labels \u00b7 ${labelFilter.size}`;

  return (
    <div className="flex items-center justify-between border-b border-border px-3 pb-1.5 pt-1.5 sm:px-5 mb-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mr-1">
          filters
        </span>
        <Popover>
          <PopoverTrigger
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              priorityFilter.size > 0
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {priorityText}
            <ChevronDownIcon className="size-3 opacity-50" />
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="start" sideOffset={4} className="w-44">
            <div className="-mx-4 -my-4 py-1">
              {ALL_PRIORITIES.map((p) => {
                const cfg = PRIORITY_CONFIG[p];
                return (
                  <button
                    key={p}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    onClick={() => togglePriority(p)}
                  >
                    <FilterCheck checked={priorityFilter.has(p)} />
                    <PriorityIcon priority={p} className="size-4 text-muted-foreground" />
                    <span className="text-foreground">{cfg.label}</span>
                  </button>
                );
              })}
              {priorityFilter.size > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => onPriorityFilterChange(new Set())}
                  >
                    <XIcon className="size-3" />
                    Clear
                  </button>
                </>
              )}
            </div>
          </PopoverPopup>
        </Popover>
        <Popover>
          <PopoverTrigger
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              labelFilter.size > 0
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {labelText}
            <ChevronDownIcon className="size-3 opacity-50" />
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="start" sideOffset={4} className="w-48">
            <div className="-mx-4 -my-4 py-1">
              {availableLabels.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No labels</div>
              ) : (
                availableLabels.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    onClick={() => toggleLabel(l.id)}
                  >
                    <FilterCheck checked={labelFilter.has(l.id)} />
                    <div className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
                    <span className="truncate text-foreground">{l.name}</span>
                  </button>
                ))
              )}
              {labelFilter.size > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => onLabelFilterChange(new Set())}
                  >
                    <XIcon className="size-3" />
                    Clear
                  </button>
                </>
              )}
            </div>
          </PopoverPopup>
        </Popover>
      </div>
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            "relative flex h-6 cursor-text items-center rounded-md border border-border transition-[width,color] duration-200 ease-out",
            searchOpen ? "w-44" : "w-[5.5rem] text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            if (!searchOpen) {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }
          }}
        >
          <SearchIcon
            className={cn(
              "pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2",
              searchOpen ? "text-muted-foreground" : "text-current opacity-80",
            )}
          />
          {searchOpen ? (
            <>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                onBlur={() => {
                  if (!searchQuery) setSearchOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onSearchQueryChange("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="Search tickets..."
                className="h-full w-full bg-transparent pl-7 pr-6 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => onSearchQueryChange("")}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </>
          ) : (
            <span className="pointer-events-none pl-7 text-[11px] font-medium text-current">
              Search
            </span>
          )}
        </div>

        <div className="flex items-center rounded-md border border-border">
          <button
            type="button"
            className={cn(
              "flex size-6 items-center justify-center rounded-l-[5px] transition-colors",
              viewMode === "cards"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewModeChange("cards")}
          >
            <LayoutGridIcon className="size-3" />
          </button>
          <button
            type="button"
            className={cn(
              "flex size-6 items-center justify-center transition-colors",
              viewMode === "list"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewModeChange("list")}
          >
            <ListIcon className="size-3" />
          </button>
          <button
            type="button"
            className={cn(
              "flex size-6 items-center justify-center rounded-r-[5px] transition-colors",
              viewMode === "browser"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewModeChange("browser")}
          >
            <GlobeIcon className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
