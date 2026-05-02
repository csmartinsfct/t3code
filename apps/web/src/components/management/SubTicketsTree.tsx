import type {
  ProjectId,
  Ticket,
  TicketId,
  TicketSummary,
  TicketTreeNode,
  TicketingStreamEvent,
} from "@t3tools/contracts";
import { useDraggable } from "@dnd-kit/core";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { useTicketSelectionStore } from "../../ticketSelectionStore";
import { useUiStateStore } from "../../uiStateStore";
import { SubTicketRowButton, buildTicketDetailLookupInput } from "./KanbanTicketDetail";
import {
  SharedSubTicketPreviewPopup,
  useSubTicketPreviewHoverTarget,
} from "./SubTicketPreviewPopup";
import { handleTicketMultiSelectGesture } from "./ticketMultiSelect";

interface SubTicketsTreeProps {
  ticketId: TicketId;
  projectId: string;
  onNavigateToTicket: (ticketId: TicketId) => void;
  onMoveToBoardRequest: (tickets: readonly TicketSummary[]) => void;
  onArchiveRequest: (tickets: readonly TicketSummary[]) => void;
}

/**
 * Recursive sub-tickets tree on the ticket detail view. Shows every descendant
 * of the current ticket, with each subtree collapsible (default open).
 *
 * Performance posture:
 *  - Loads only the subtree of the current ticket via a single `getTree` RPC,
 *    backed by a recursive CTE on the server. Never loads the full project.
 *  - Server caps the result at 500 nodes; truncation surfaces a banner here.
 *  - No additional fetches on expand/collapse — the data is already in memory.
 *  - Live updates flow through the existing `TicketingStreamEvent` subscription.
 *
 * Preserves the legacy flat-list affordances on every row:
 *  - Drag-to-chat via `useDraggable`.
 *  - Multi-selection via Alt/Meta/Shift clicks (uses the shared selection store).
 *  - Right-click context menu (move-to-board, archive).
 *  - Hover preview popover.
 */
export function SubTicketsTree({
  ticketId,
  projectId,
  onNavigateToTicket,
  onMoveToBoardRequest,
  onArchiveRequest,
}: SubTicketsTreeProps) {
  const [roots, setRoots] = useState<readonly TicketTreeNode[] | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [truncated, setTruncated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(() => {
    const api = ensureNativeApi();
    let cancelled = false;
    api.ticketing
      .getTree({ projectId: projectId as ProjectId, rootTicketId: ticketId })
      .then((result) => {
        if (cancelled) return;
        setRoots(result.roots);
        setTotalCount(result.totalCount);
        setTruncated(result.truncated);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load sub-tickets");
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, projectId]);

  useEffect(() => {
    const cleanup = fetchTree();
    return cleanup;
  }, [fetchTree]);

  // Build a flat id set so we can cheaply detect whether a stream event affects
  // this subtree without walking the tree on every event.
  const idsInSubtree = useMemo(() => {
    const set = new Set<string>();
    if (!roots) return set;
    const walk = (node: TicketTreeNode) => {
      set.add(node.ticket.id);
      for (const child of node.children) walk(child);
    };
    for (const node of roots) walk(node);
    return set;
  }, [roots]);

  // Single subscription handles both tree refetch and preview cache invalidation.
  useEffect(() => {
    const api = ensureNativeApi();
    return api.ticketing.onEvent((event: TicketingStreamEvent) => {
      if (event.type === "ticket_upserted") {
        const idStr = event.ticket.id as string;
        const parentIdStr = (event.ticket.parentId ?? "") as string;
        // Invalidate preview cache for updated tickets.
        cacheRef.current.delete(idStr);
        // Refetch tree if the event affects this subtree.
        if (
          idsInSubtree.has(idStr) ||
          parentIdStr === (ticketId as string) ||
          (parentIdStr.length > 0 && idsInSubtree.has(parentIdStr))
        ) {
          fetchTree();
        }
        return;
      }
      if (event.type === "ticket_deleted" && idsInSubtree.has(event.ticketId as string)) {
        fetchTree();
      }
    });
  }, [idsInSubtree, ticketId, fetchTree]);

  // Hover-preview cache shared across the whole tree.
  const cacheRef = useRef(new Map<string, Ticket>());
  const inflightRef = useRef(new Map<string, Promise<Ticket | null>>());

  const fetchPreview = useCallback(
    async (id: TicketId): Promise<Ticket | null> => {
      const key = id as string;
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const existing = inflightRef.current.get(key);
      if (existing) return existing;
      const promise = ensureNativeApi()
        .ticketing.getById(buildTicketDetailLookupInput(id, projectId))
        .then((t) => {
          cacheRef.current.set(key, t);
          return t;
        })
        .catch(() => null)
        .finally(() => {
          inflightRef.current.delete(key);
        });
      inflightRef.current.set(key, promise);
      return promise;
    },
    [projectId],
  );

  const getCached = useCallback((id: TicketId): Ticket | undefined => {
    return cacheRef.current.get(id as string);
  }, []);

  // Selection store integration (same as the legacy flat list).
  const selectedTicketIds = useTicketSelectionStore((s) => s.selectedTicketIds);
  const selectedTickets = useTicketSelectionStore((s) => s.selectedTickets);
  const toggleTicket = useTicketSelectionStore((s) => s.toggleTicket);
  const rangeSelectTo = useTicketSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useTicketSelectionStore((s) => s.clearSelection);

  // Pre-order traversal of the visible (loaded) subtree, used as the canonical
  // ordering for shift-click range selection. Matches the visual order users see.
  const orderedTickets = useMemo<readonly TicketSummary[]>(() => {
    if (!roots) return [];
    const out: TicketSummary[] = [];
    const walk = (node: TicketTreeNode) => {
      out.push(node.ticket);
      for (const child of node.children) walk(child);
    };
    for (const node of roots) walk(node);
    return out;
  }, [roots]);

  const selectedSubtreeTickets = useMemo(
    () => [...selectedTickets.values()].filter((t) => idsInSubtree.has(t.id as string)),
    [selectedTickets, idsInSubtree],
  );

  const handleMultiSelectClick = useCallback(
    (e: React.MouseEvent, sub: TicketSummary) => {
      handleTicketMultiSelectGesture(e, sub, orderedTickets, {
        toggleTicket,
        rangeSelectTo,
      });
    },
    [orderedTickets, toggleTicket, rangeSelectTo],
  );

  // Single preview state for the whole tree — one mounted preview shell whose
  // content/anchor swaps as the pointer moves between rows.
  const {
    cancelPreviewTimers,
    handlePreviewMouseEnter: handleRowMouseEnter,
    handlePreviewMouseLeave: handleRowMouseLeave,
    previewTarget,
  } = useSubTicketPreviewHoverTarget({
    closeDelayMs: 200,
    openDelayMs: 300,
  });

  if (roots === null && error === null) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Sub-tickets</h3>
        <SubTicketsTreeSkeleton />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Sub-tickets</h3>
        <p className="text-xs text-destructive-foreground">{error}</p>
      </div>
    );
  }

  if (!roots || roots.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="sub-tickets-tree">
      <h3 className="text-xs font-medium text-muted-foreground">Sub-tickets ({totalCount})</h3>
      {truncated ? (
        <p className="text-xs text-muted-foreground/80">
          Subtree is large — showing the first {totalCount} descendants.
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5" data-testid="sub-tickets-tree-root">
        {roots.map((node) => (
          <SubTicketTreeNodeRow
            key={node.ticket.id}
            node={node}
            selectedTicketIds={selectedTicketIds}
            selectedSubtreeTickets={selectedSubtreeTickets}
            previewTicketId={previewTarget?.ticketId ?? null}
            onRowMouseEnter={handleRowMouseEnter}
            onRowMouseLeave={handleRowMouseLeave}
            onMultiSelectClick={handleMultiSelectClick}
            onNavigate={(id) => {
              clearSelection();
              onNavigateToTicket(id);
            }}
            onMoveToBoardRequest={onMoveToBoardRequest}
            onArchiveRequest={onArchiveRequest}
          />
        ))}
      </ul>
      <SharedSubTicketPreviewPopup
        anchorElement={previewTarget?.anchorElement ?? null}
        ticketId={previewTarget?.ticketId ?? null}
        side="top"
        align="end"
        alignOffset={-190}
        sideOffset={4}
        collisionPadding={12}
        fetchPreview={fetchPreview}
        getCached={getCached}
        onMouseEnter={cancelPreviewTimers}
        onMouseLeave={handleRowMouseLeave}
      />
    </div>
  );
}

interface SubTicketTreeNodeRowProps {
  node: TicketTreeNode;
  selectedTicketIds: ReadonlySet<TicketId>;
  selectedSubtreeTickets: readonly TicketSummary[];
  previewTicketId: TicketId | null;
  onRowMouseEnter: (id: TicketId, anchorElement: Element) => void;
  onRowMouseLeave: () => void;
  onMultiSelectClick: (e: React.MouseEvent, sub: TicketSummary) => void;
  onNavigate: (ticketId: TicketId) => void;
  onMoveToBoardRequest: (tickets: readonly TicketSummary[]) => void;
  onArchiveRequest: (tickets: readonly TicketSummary[]) => void;
}

function SubTicketTreeNodeRow({
  node,
  selectedTicketIds,
  selectedSubtreeTickets,
  previewTicketId,
  onRowMouseEnter,
  onRowMouseLeave,
  onMultiSelectClick,
  onNavigate,
  onMoveToBoardRequest,
  onArchiveRequest,
}: SubTicketTreeNodeRowProps) {
  const ticket = node.ticket;
  const ticketId = ticket.id;
  const isCollapsed = useUiStateStore((state) => state.collapsedTicketIds[ticketId] === true);
  const toggleTicketCollapsed = useUiStateStore((state) => state.toggleTicketCollapsed);
  const hasChildren = node.children.length > 0;
  const isOpen = !isCollapsed && hasChildren;
  const isSelected = selectedTicketIds.has(ticketId);

  const handleChevronClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      if (!hasChildren) return;
      toggleTicketCollapsed(ticketId);
    },
    [hasChildren, ticketId, toggleTicketCollapsed],
  );

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticketId,
    data: { ticket, status: ticket.status },
  });

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const api = ensureNativeApi();
      const selection =
        selectedTicketIds.has(ticketId) && selectedSubtreeTickets.length > 0
          ? selectedSubtreeTickets
          : [ticket];
      const clicked = await api.contextMenu.show(
        [
          {
            id: "move-to-board",
            label: selection.length > 1 ? "Move all tickets to the board" : "Move to board",
          },
          {
            id: "archive",
            label: selection.length > 1 ? `Archive (${selection.length})` : "Archive",
          },
        ],
        {
          x: e.clientX,
          y: e.clientY,
        },
      );
      if (clicked === "move-to-board") {
        onMoveToBoardRequest(selection);
      } else if (clicked === "archive") {
        onArchiveRequest(selection);
      }
    },
    [
      onArchiveRequest,
      onMoveToBoardRequest,
      selectedSubtreeTickets,
      selectedTicketIds,
      ticket,
      ticketId,
    ],
  );

  const isPreviewOpen = previewTicketId === ticketId;

  return (
    <li className="flex flex-col" data-ticket-id={ticketId}>
      <div
        className="flex w-full items-center gap-1"
        onMouseEnter={(event) => onRowMouseEnter(ticketId, event.currentTarget)}
        onMouseLeave={onRowMouseLeave}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? "Collapse sub-tickets" : "Expand sub-tickets"}
            aria-expanded={isOpen}
            onClick={handleChevronClick}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            data-testid="sub-ticket-tree-chevron"
          >
            <ChevronRightIcon
              className={`size-3.5 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            <ChevronRightIcon className="size-3.5 text-muted-foreground/25" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <SubTicketRowButton
            subTicket={ticket}
            isSelected={isSelected}
            isDragging={isDragging}
            isPreviewOpen={isPreviewOpen}
            buttonRef={setNodeRef}
            onClick={(e) => {
              if (e.altKey || e.metaKey || e.shiftKey) {
                onMultiSelectClick(e, ticket);
                return;
              }
              onNavigate(ticketId);
            }}
            buttonProps={{
              "data-ticket-selectable": true,
              ...attributes,
              ...listeners,
              onContextMenu: handleContextMenu,
            }}
          />
        </div>
      </div>
      {isOpen ? (
        <ul
          className="ml-2 flex flex-col gap-0.5 border-l border-border/40 pl-2"
          data-testid="sub-tickets-tree-children"
        >
          {node.children.map((child) => (
            <SubTicketTreeNodeRow
              key={child.ticket.id}
              node={child}
              selectedTicketIds={selectedTicketIds}
              selectedSubtreeTickets={selectedSubtreeTickets}
              previewTicketId={previewTicketId}
              onRowMouseEnter={onRowMouseEnter}
              onRowMouseLeave={onRowMouseLeave}
              onMultiSelectClick={onMultiSelectClick}
              onNavigate={onNavigate}
              onMoveToBoardRequest={onMoveToBoardRequest}
              onArchiveRequest={onArchiveRequest}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SubTicketsTreeSkeleton() {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
          data-testid="sub-tickets-tree-skeleton-row"
        >
          <span className="size-4 shrink-0" />
          <span className="h-4 w-12 animate-pulse rounded bg-muted/60" />
          <span className="h-4 w-16 animate-pulse rounded bg-muted/40" />
          <span className="h-4 flex-1 animate-pulse rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}

/**
 * Total descendant count from a flat tree, useful in tests/diagnostics.
 * Exported so callers can reuse the same counting logic.
 */
export function countTreeNodes(roots: ReadonlyArray<TicketTreeNode>): number {
  let count = 0;
  const walk = (node: TicketTreeNode) => {
    count += 1;
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return count;
}

// Helps tests assert on summaries without coupling to TicketingStreamEvent shape.
export type SubTicketsTreeNodeSummary = TicketSummary;
