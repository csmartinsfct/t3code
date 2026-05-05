import type { TicketPriority, TicketStatus } from "@t3tools/contracts";
import { ChevronDownIcon, LayoutGridIcon, ListIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type { BoardViewMode } from "../../uiStateStore";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { cn } from "~/lib/utils";
import { OverlayRoutePopover, OverlayRoutePopoverPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
} from "../settings/ticketUtils";
import { PriorityIcon } from "./PriorityIcon";

interface BoardToolbarProps {
  statusFilter: Set<string>;
  onStatusFilterChange: (filter: Set<string>) => void;
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

const BOARD_TOOLBAR_FILTER_ROUTE_KEY = "board-toolbar-filter";

type BoardToolbarFilterKind = "status" | "priority" | "label";

type BoardToolbarFilterAction =
  | { action: "clear"; kind: BoardToolbarFilterKind }
  | { action: "toggle"; id: string; kind: BoardToolbarFilterKind };

type BoardToolbarLabel = { id: string; name: string; color: string };

export function BoardToolbar({
  statusFilter,
  onStatusFilterChange,
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

  const toggleStatus = useCallback(
    (s: string) => {
      const next = new Set(statusFilter);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      onStatusFilterChange(next);
    },
    [statusFilter, onStatusFilterChange],
  );

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

  const handleOverlayFilterEvent = useCallback(
    (type: string, payload: unknown) => {
      if (type !== "filter-action") return;
      const action = readBoardToolbarFilterAction(payload);
      if (!action) return;

      if (action.action === "clear") {
        if (action.kind === "status") onStatusFilterChange(new Set());
        else if (action.kind === "priority") onPriorityFilterChange(new Set());
        else onLabelFilterChange(new Set());
        return;
      }

      if (action.kind === "status") toggleStatus(action.id);
      else if (action.kind === "priority") togglePriority(action.id);
      else toggleLabel(action.id);
    },
    [
      onLabelFilterChange,
      onPriorityFilterChange,
      onStatusFilterChange,
      toggleLabel,
      togglePriority,
      toggleStatus,
    ],
  );

  const routedStatusPopover = useRoutedPopoverSurface<HTMLButtonElement>({
    routeKey: BOARD_TOOLBAR_FILTER_ROUTE_KEY,
    params: { kind: "status", selected: [...statusFilter] },
    side: "bottom",
    align: "start",
    onEvent: handleOverlayFilterEvent,
  });
  const routedPriorityPopover = useRoutedPopoverSurface<HTMLButtonElement>({
    routeKey: BOARD_TOOLBAR_FILTER_ROUTE_KEY,
    params: { kind: "priority", selected: [...priorityFilter] },
    side: "bottom",
    align: "start",
    onEvent: handleOverlayFilterEvent,
  });
  const routedLabelPopover = useRoutedPopoverSurface<HTMLButtonElement>({
    routeKey: BOARD_TOOLBAR_FILTER_ROUTE_KEY,
    params: { kind: "label", labels: availableLabels, selected: [...labelFilter] },
    side: "bottom",
    align: "start",
    onEvent: handleOverlayFilterEvent,
  });

  const statusText =
    statusFilter.size === 0
      ? "Status"
      : statusFilter.size === 1
        ? (STATUS_CONFIG[[...statusFilter][0] as TicketStatus]?.label ?? "Status")
        : `Status \u00b7 ${statusFilter.size}`;

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
        <Popover open={routedStatusPopover.domOpen} onOpenChange={routedStatusPopover.onOpenChange}>
          <PopoverTrigger
            ref={routedStatusPopover.triggerRef}
            onFocusCapture={routedStatusPopover.updateAnchor}
            onPointerDownCapture={routedStatusPopover.updateAnchor}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              statusFilter.size > 0
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {statusText}
            <ChevronDownIcon className="size-3 opacity-50" />
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="start" sideOffset={4} className="w-44">
            <BoardToolbarStatusFilterContent
              selected={statusFilter}
              onToggle={toggleStatus}
              onClear={() => onStatusFilterChange(new Set())}
            />
          </PopoverPopup>
        </Popover>
        <Popover
          open={routedPriorityPopover.domOpen}
          onOpenChange={routedPriorityPopover.onOpenChange}
        >
          <PopoverTrigger
            ref={routedPriorityPopover.triggerRef}
            onFocusCapture={routedPriorityPopover.updateAnchor}
            onPointerDownCapture={routedPriorityPopover.updateAnchor}
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
            <BoardToolbarPriorityFilterContent
              selected={priorityFilter}
              onToggle={togglePriority}
              onClear={() => onPriorityFilterChange(new Set())}
            />
          </PopoverPopup>
        </Popover>
        <Popover open={routedLabelPopover.domOpen} onOpenChange={routedLabelPopover.onOpenChange}>
          <PopoverTrigger
            ref={routedLabelPopover.triggerRef}
            onFocusCapture={routedLabelPopover.updateAnchor}
            onPointerDownCapture={routedLabelPopover.updateAnchor}
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
            <BoardToolbarLabelFilterContent
              labels={availableLabels}
              selected={labelFilter}
              onToggle={toggleLabel}
              onClear={() => onLabelFilterChange(new Set())}
            />
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
              "flex size-6 items-center justify-center rounded-r-[5px] transition-colors",
              viewMode === "list"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onViewModeChange("list")}
          >
            <ListIcon className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardToolbarStatusFilterContent({
  onClear,
  onToggle,
  selected,
}: {
  onClear: () => void;
  onToggle: (status: string) => void;
  selected: ReadonlySet<string>;
}) {
  return (
    <div className="-mx-4 -my-4 py-1">
      {ALL_STATUSES.map((s) => {
        const cfg = STATUS_CONFIG[s];
        return (
          <button
            key={s}
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            onClick={() => onToggle(s)}
          >
            <FilterCheck checked={selected.has(s)} />
            <div className={cn("size-2 rounded-full", cfg.dotClass)} />
            <span className="text-foreground">{cfg.label}</span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClear}
          >
            <XIcon className="size-3" />
            Clear
          </button>
        </>
      )}
    </div>
  );
}

function BoardToolbarPriorityFilterContent({
  onClear,
  onToggle,
  selected,
}: {
  onClear: () => void;
  onToggle: (priority: string) => void;
  selected: ReadonlySet<string>;
}) {
  return (
    <div className="-mx-4 -my-4 py-1">
      {ALL_PRIORITIES.map((p) => {
        const cfg = PRIORITY_CONFIG[p];
        return (
          <button
            key={p}
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            onClick={() => onToggle(p)}
          >
            <FilterCheck checked={selected.has(p)} />
            <PriorityIcon priority={p} className="size-4 text-muted-foreground" />
            <span className="text-foreground">{cfg.label}</span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClear}
          >
            <XIcon className="size-3" />
            Clear
          </button>
        </>
      )}
    </div>
  );
}

function BoardToolbarLabelFilterContent({
  labels,
  onClear,
  onToggle,
  selected,
}: {
  labels: readonly BoardToolbarLabel[];
  onClear: () => void;
  onToggle: (labelId: string) => void;
  selected: ReadonlySet<string>;
}) {
  return (
    <div className="-mx-4 -my-4 py-1">
      {labels.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No labels</div>
      ) : (
        labels.map((label) => (
          <button
            key={label.id}
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            onClick={() => onToggle(label.id)}
          >
            <FilterCheck checked={selected.has(label.id)} />
            <div className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
            <span className="truncate text-foreground">{label.name}</span>
          </button>
        ))
      )}
      {selected.size > 0 && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClear}
          >
            <XIcon className="size-3" />
            Clear
          </button>
        </>
      )}
    </div>
  );
}

registerOverlayRoute<{
  kind?: unknown;
  labels?: unknown;
  selected?: unknown;
}>(
  BOARD_TOOLBAR_FILTER_ROUTE_KEY,
  function BoardToolbarFilterOverlayRoute({ message, controller }) {
    const params = readBoardToolbarFilterParams(message.params);

    if (!params) {
      controller.fail(new Error("Board toolbar filter route requires filter params."));
      return null;
    }

    const selected = new Set(params.selected);
    const emitAction = (action: BoardToolbarFilterAction) => {
      controller.bridge.emitEvent("filter-action", action);
    };

    return (
      <OverlayRoutePopover>
        <OverlayRoutePopoverPopup
          side="bottom"
          align="start"
          sideOffset={4}
          className={params.kind === "label" ? "w-48" : "w-44"}
        >
          {params.kind === "status" ? (
            <BoardToolbarStatusFilterContent
              selected={selected}
              onToggle={(id) => emitAction({ action: "toggle", id, kind: "status" })}
              onClear={() => emitAction({ action: "clear", kind: "status" })}
            />
          ) : params.kind === "priority" ? (
            <BoardToolbarPriorityFilterContent
              selected={selected}
              onToggle={(id) => emitAction({ action: "toggle", id, kind: "priority" })}
              onClear={() => emitAction({ action: "clear", kind: "priority" })}
            />
          ) : (
            <BoardToolbarLabelFilterContent
              labels={params.labels}
              selected={selected}
              onToggle={(id) => emitAction({ action: "toggle", id, kind: "label" })}
              onClear={() => emitAction({ action: "clear", kind: "label" })}
            />
          )}
        </OverlayRoutePopoverPopup>
      </OverlayRoutePopover>
    );
  },
);

function readBoardToolbarFilterParams(params: Record<string, unknown>): {
  kind: BoardToolbarFilterKind;
  labels: readonly BoardToolbarLabel[];
  selected: readonly string[];
} | null {
  if (params.kind !== "status" && params.kind !== "priority" && params.kind !== "label") {
    return null;
  }
  const selected = Array.isArray(params.selected)
    ? params.selected.filter((value): value is string => typeof value === "string")
    : [];
  const labels =
    params.kind === "label" && Array.isArray(params.labels)
      ? params.labels.filter((label): label is BoardToolbarLabel => {
          if (!label || typeof label !== "object") return false;
          const candidate = label as { color?: unknown; id?: unknown; name?: unknown };
          return (
            typeof candidate.id === "string" &&
            typeof candidate.name === "string" &&
            typeof candidate.color === "string"
          );
        })
      : [];
  return { kind: params.kind, labels, selected };
}

function readBoardToolbarFilterAction(value: unknown): BoardToolbarFilterAction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { action?: unknown; id?: unknown; kind?: unknown };
  if (candidate.kind !== "status" && candidate.kind !== "priority" && candidate.kind !== "label") {
    return null;
  }
  if (candidate.action === "clear") {
    return { action: "clear", kind: candidate.kind };
  }
  if (candidate.action !== "toggle" || typeof candidate.id !== "string") return null;
  return { action: "toggle", id: candidate.id, kind: candidate.kind };
}
