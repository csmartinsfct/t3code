/**
 * Pure validation logic for building an orchestration execution plan from a
 * set of selected tickets.
 *
 * Determines execution order via topological sort on dependency edges,
 * detects blocking conditions (external deps, cycles), and annotates each
 * ticket with its run status.
 */

import type { TicketId, TicketStatus, TicketSummary, TicketTreeNode } from "@t3tools/contracts";
import { toposort } from "@t3tools/shared/toposort";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TicketAnnotation = "will-run" | "skipped-done" | "warn-reprocess";

export interface OrchestrationPlanTicket {
  ticket: TicketSummary;
  annotation: TicketAnnotation;
}

export interface ExternalDep {
  ticket: TicketSummary;
  dependsOn: { identifier: string; title: string; status: TicketStatus };
}

export type OrchestrationPlan =
  | { kind: "valid"; orderedTickets: OrchestrationPlanTicket[] }
  | { kind: "blocked-external"; externalDeps: ExternalDep[] }
  | { kind: "blocked-cycle"; cycles: TicketSummary[][] };

// ---------------------------------------------------------------------------
// Status column ordering for board-order tiebreaking
// ---------------------------------------------------------------------------

const STATUS_ORDER: Record<TicketStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  blocked: 3,
  in_review: 4,
  done: 5,
  canceled: 6,
};

function boardOrderKey(t: TicketSummary): number {
  return STATUS_ORDER[t.status] * 1_000_000 + t.sortOrder;
}

function compareTicketsByBoardOrder(left: TicketSummary, right: TicketSummary): number {
  return (
    boardOrderKey(left) - boardOrderKey(right) ||
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
    left.ticketNumber - right.ticketNumber ||
    left.identifier.localeCompare(right.identifier)
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function annotateTicket(ticket: TicketSummary): TicketAnnotation {
  if (ticket.status === "done" || ticket.status === "canceled") return "skipped-done";
  if (ticket.status === "in_progress" || ticket.status === "in_review") return "warn-reprocess";
  return "will-run";
}

function sortTicketIdsByBoardOrder(
  ticketIds: readonly TicketId[],
  ticketById: ReadonlyMap<TicketId, TicketSummary>,
): TicketId[] {
  return [...ticketIds].toSorted((leftId, rightId) => {
    const left = ticketById.get(leftId);
    const right = ticketById.get(rightId);
    if (!left || !right) return String(leftId).localeCompare(String(rightId));
    return compareTicketsByBoardOrder(left, right);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Build an orchestration execution plan for the given selected tickets.
 *
 * @param selectedIds   IDs of selected tickets.
 * @param treeNodes     Full project ticket tree (from `api.ticketing.getTree`).
 *                      Each node includes `dependencies` with the full edge list.
 * @param allTickets    All flat tickets in the project (for board-order fallback).
 */
export function buildOrchestrationPlan(
  selectedIds: ReadonlySet<TicketId>,
  treeNodes: readonly TicketTreeNode[],
  allTickets: readonly TicketSummary[],
): OrchestrationPlan {
  if (selectedIds.size === 0) {
    return { kind: "valid", orderedTickets: [] };
  }

  // Build lookup maps from the tree.
  const ticketById = new Map<TicketId, TicketSummary>();
  const depsById = new Map<
    TicketId,
    { dependsOnTicketId: TicketId; identifier: string; title: string; status: TicketStatus }[]
  >();
  const childIdsByParentId = new Map<TicketId, TicketId[]>();

  const addChildId = (parentId: TicketId, childId: TicketId) => {
    const existing = childIdsByParentId.get(parentId);
    if (existing) {
      if (!existing.includes(childId)) existing.push(childId);
      return;
    }
    childIdsByParentId.set(parentId, [childId]);
  };

  function walkTree(nodes: readonly TicketTreeNode[]) {
    for (const node of nodes) {
      ticketById.set(node.ticket.id, node.ticket);
      const nodeDependencies = Array.isArray(node.dependencies) ? node.dependencies : [];
      depsById.set(
        node.ticket.id,
        nodeDependencies.map((d) => ({
          dependsOnTicketId: d.dependsOnTicketId,
          identifier: d.identifier,
          title: d.title,
          status: d.status,
        })),
      );
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child?.ticket?.id) {
            addChildId(node.ticket.id, child.ticket.id);
          }
        }
        walkTree(node.children as readonly TicketTreeNode[]);
      }
    }
  }
  walkTree(treeNodes);

  // Also index from the flat list (tree may not include all — e.g. subtickets
  // might only appear as children).
  for (const t of allTickets) {
    if (!ticketById.has(t.id)) ticketById.set(t.id, t);
    if (t.parentId) addChildId(t.parentId, t.id);
  }

  for (const [parentId, childIds] of childIdsByParentId) {
    childIdsByParentId.set(parentId, sortTicketIdsByBoardOrder(childIds, ticketById));
  }

  const collectLeafExecutionIds = (ticketId: TicketId): TicketId[] => {
    const childIds = childIdsByParentId.get(ticketId) ?? [];
    if (childIds.length === 0) return [ticketId];
    return childIds.flatMap((childId) => collectLeafExecutionIds(childId));
  };

  const executionIds = new Set<TicketId>();
  for (const selectedId of selectedIds) {
    for (const executionId of collectLeafExecutionIds(selectedId)) {
      executionIds.add(executionId);
    }
  }

  // Resolve selected tickets.
  const selectedTickets: TicketSummary[] = [];
  for (const id of executionIds) {
    const t = ticketById.get(id);
    if (t) selectedTickets.push(t);
  }

  // -----------------------------------------------------------------------
  // 1. Check for external (non-selected, non-done) dependencies
  // -----------------------------------------------------------------------

  const TERMINAL_STATUSES: ReadonlySet<TicketStatus> = new Set(["done", "canceled"]);
  const externalDeps: ExternalDep[] = [];

  for (const ticket of selectedTickets) {
    const deps = depsById.get(ticket.id) ?? [];
    for (const dep of deps) {
      if (executionIds.has(dep.dependsOnTicketId)) continue; // internal
      if (TERMINAL_STATUSES.has(dep.status)) continue; // already done
      externalDeps.push({
        ticket,
        dependsOn: { identifier: dep.identifier, title: dep.title, status: dep.status },
      });
    }
  }

  if (externalDeps.length > 0) {
    return { kind: "blocked-external", externalDeps };
  }

  // -----------------------------------------------------------------------
  // 2. Build internal dependency edges and topological sort
  // -----------------------------------------------------------------------

  // Only sort non-terminal tickets; done/canceled are appended at the end as "skipped".
  const runnableTickets = selectedTickets.filter((t) => !TERMINAL_STATUSES.has(t.status));
  const skippedTickets = selectedTickets.filter((t) => TERMINAL_STATUSES.has(t.status));

  // Sort runnable tickets by board order so toposort uses it as tiebreaker.
  runnableTickets.sort(compareTicketsByBoardOrder);

  const internalEdges: { from: TicketSummary; to: TicketSummary }[] = [];
  for (const ticket of runnableTickets) {
    const deps = depsById.get(ticket.id) ?? [];
    for (const dep of deps) {
      if (!executionIds.has(dep.dependsOnTicketId)) continue;
      if (TERMINAL_STATUSES.has(dep.status)) continue; // skip done deps
      const depTicket = ticketById.get(dep.dependsOnTicketId);
      if (depTicket) {
        internalEdges.push({ from: ticket, to: depTicket });
      }
    }
  }

  const result = toposort(runnableTickets, internalEdges, (t) => t.id);

  if (result.cycles.length > 0) {
    return { kind: "blocked-cycle", cycles: result.cycles };
  }

  // -----------------------------------------------------------------------
  // 3. Build ordered plan: sorted runnable first, then skipped
  // -----------------------------------------------------------------------

  const orderedTickets: OrchestrationPlanTicket[] = [
    ...result.sorted.map((ticket) => ({ ticket, annotation: annotateTicket(ticket) })),
    ...skippedTickets.map((ticket) => ({ ticket, annotation: "skipped-done" as const })),
  ];

  return { kind: "valid", orderedTickets };
}
