import type {
  TicketDependency,
  TicketId,
  TicketStatus,
  TicketSummary,
  TicketTreeNode,
} from "@t3tools/contracts";
import { toposort } from "./toposort.js";

export type TicketAnnotation = "will-run" | "skipped-done" | "warn-reprocess";

export interface OrchestrationPlanTicket {
  ticket: TicketSummary;
  annotation: TicketAnnotation;
  selectedTicketId: TicketId;
}

export interface ExternalDep {
  ticket: TicketSummary;
  dependsOn: { identifier: string; title: string; status: TicketStatus };
}

export type OrchestrationPlan =
  | { kind: "valid"; orderedTickets: OrchestrationPlanTicket[] }
  | { kind: "blocked-external"; externalDeps: ExternalDep[] }
  | { kind: "blocked-cycle"; cycles: TicketSummary[][] };

const STATUS_ORDER: Record<TicketStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  blocked: 3,
  in_review: 4,
  done: 5,
  canceled: 6,
};

function boardOrderKey(ticket: TicketSummary): number {
  return STATUS_ORDER[ticket.status] * 1_000_000 + ticket.sortOrder;
}

function compareTicketsByBoardOrder(left: TicketSummary, right: TicketSummary): number {
  return (
    boardOrderKey(left) - boardOrderKey(right) ||
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
    left.ticketNumber - right.ticketNumber ||
    left.identifier.localeCompare(right.identifier)
  );
}

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

function buildTreeIndexes(input: {
  treeNodes: readonly TicketTreeNode[];
  allTickets: readonly TicketSummary[];
}) {
  const ticketById = new Map<TicketId, TicketSummary>();
  const depsById = new Map<
    TicketId,
    { dependsOnTicketId: TicketId; identifier: string; title: string; status: TicketStatus }[]
  >();
  const childIdsByParentId = new Map<TicketId, TicketId[]>();
  const parentIdByTicketId = new Map<TicketId, TicketId | null>();

  const addChildId = (parentId: TicketId, childId: TicketId) => {
    const existing = childIdsByParentId.get(parentId);
    if (existing) {
      if (!existing.includes(childId)) existing.push(childId);
      return;
    }
    childIdsByParentId.set(parentId, [childId]);
  };

  const walkTree = (nodes: readonly TicketTreeNode[], parentId: TicketId | null = null) => {
    for (const node of nodes) {
      ticketById.set(node.ticket.id, node.ticket);
      parentIdByTicketId.set(node.ticket.id, parentId);
      const nodeDependencies = Array.isArray(node.dependencies) ? node.dependencies : [];
      depsById.set(
        node.ticket.id,
        nodeDependencies.map((dep) => ({
          dependsOnTicketId: dep.dependsOnTicketId,
          identifier: dep.identifier,
          title: dep.title,
          status: dep.status,
        })),
      );
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child?.ticket?.id) {
            addChildId(node.ticket.id, child.ticket.id);
          }
        }
        walkTree(node.children as readonly TicketTreeNode[], node.ticket.id);
      }
    }
  };

  walkTree(input.treeNodes);

  for (const ticket of input.allTickets) {
    if (!ticketById.has(ticket.id)) ticketById.set(ticket.id, ticket);
    if (!parentIdByTicketId.has(ticket.id)) {
      parentIdByTicketId.set(ticket.id, ticket.parentId ?? null);
    }
    if (ticket.parentId) addChildId(ticket.parentId, ticket.id);
  }

  for (const [parentId, childIds] of childIdsByParentId) {
    childIdsByParentId.set(parentId, sortTicketIdsByBoardOrder(childIds, ticketById));
  }

  return {
    ticketById,
    depsById,
    childIdsByParentId,
    parentIdByTicketId,
  };
}

function collectLeafExecutionIds(input: {
  ticketId: TicketId;
  childIdsByParentId: ReadonlyMap<TicketId, readonly TicketId[]>;
}): TicketId[] {
  const childIds = input.childIdsByParentId.get(input.ticketId) ?? [];
  if (childIds.length === 0) return [input.ticketId];
  return childIds.flatMap((childId) =>
    collectLeafExecutionIds({
      ticketId: childId,
      childIdsByParentId: input.childIdsByParentId,
    }),
  );
}

function buildSelectedExecutionMap(input: {
  selectedIds: ReadonlySet<TicketId>;
  ticketById: ReadonlyMap<TicketId, TicketSummary>;
  childIdsByParentId: ReadonlyMap<TicketId, readonly TicketId[]>;
  parentIdByTicketId: ReadonlyMap<TicketId, TicketId | null>;
}): Map<TicketId, TicketId> {
  const selectedTickets = [...input.selectedIds]
    .map((ticketId) => input.ticketById.get(ticketId))
    .filter((ticket): ticket is TicketSummary => ticket !== undefined)
    .map((ticket) => {
      let depth = 0;
      let cursor = input.parentIdByTicketId.get(ticket.id) ?? null;
      while (cursor) {
        depth += 1;
        cursor = input.parentIdByTicketId.get(cursor) ?? null;
      }
      return { ticket, depth };
    })
    .toSorted((left, right) => {
      const byDepth = left.depth - right.depth;
      if (byDepth !== 0) return byDepth;
      return compareTicketsByBoardOrder(left.ticket, right.ticket);
    });

  const selectedTicketIdByExecutionId = new Map<TicketId, TicketId>();
  for (const selected of selectedTickets) {
    for (const executionId of collectLeafExecutionIds({
      ticketId: selected.ticket.id,
      childIdsByParentId: input.childIdsByParentId,
    })) {
      if (!selectedTicketIdByExecutionId.has(executionId)) {
        selectedTicketIdByExecutionId.set(executionId, selected.ticket.id);
      }
    }
  }
  return selectedTicketIdByExecutionId;
}

export function flattenTicketTree(nodes: readonly TicketTreeNode[]): TicketSummary[] {
  const tickets: TicketSummary[] = [];
  const walk = (entries: readonly TicketTreeNode[]) => {
    for (const node of entries) {
      tickets.push(node.ticket);
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return tickets;
}

export function buildOrchestrationPlan(
  selectedIds: ReadonlySet<TicketId>,
  treeNodes: readonly TicketTreeNode[],
  allTickets: readonly TicketSummary[],
): OrchestrationPlan {
  if (selectedIds.size === 0) {
    return { kind: "valid", orderedTickets: [] };
  }

  const { ticketById, depsById, childIdsByParentId, parentIdByTicketId } = buildTreeIndexes({
    treeNodes,
    allTickets,
  });

  const selectedTicketIdByExecutionId = buildSelectedExecutionMap({
    selectedIds,
    ticketById,
    childIdsByParentId,
    parentIdByTicketId,
  });

  const executionIds = new Set(selectedTicketIdByExecutionId.keys());
  const selectedTickets: TicketSummary[] = [];
  for (const id of executionIds) {
    const ticket = ticketById.get(id);
    if (ticket) selectedTickets.push(ticket);
  }

  const TERMINAL_STATUSES: ReadonlySet<TicketStatus> = new Set(["done", "canceled"]);
  const externalDeps: ExternalDep[] = [];

  for (const ticket of selectedTickets) {
    const deps = depsById.get(ticket.id) ?? [];
    for (const dep of deps) {
      if (executionIds.has(dep.dependsOnTicketId)) continue;
      if (TERMINAL_STATUSES.has(dep.status)) continue;
      externalDeps.push({
        ticket,
        dependsOn: { identifier: dep.identifier, title: dep.title, status: dep.status },
      });
    }
  }

  if (externalDeps.length > 0) {
    return { kind: "blocked-external", externalDeps };
  }

  const runnableTickets = selectedTickets.filter((ticket) => !TERMINAL_STATUSES.has(ticket.status));
  const skippedTickets = selectedTickets.filter((ticket) => TERMINAL_STATUSES.has(ticket.status));
  runnableTickets.sort(compareTicketsByBoardOrder);

  const internalEdges: { from: TicketSummary; to: TicketSummary }[] = [];
  for (const ticket of runnableTickets) {
    const deps = depsById.get(ticket.id) ?? [];
    for (const dep of deps) {
      if (!executionIds.has(dep.dependsOnTicketId)) continue;
      if (TERMINAL_STATUSES.has(dep.status)) continue;
      const depTicket = ticketById.get(dep.dependsOnTicketId);
      if (depTicket) {
        internalEdges.push({ from: ticket, to: depTicket });
      }
    }
  }

  const result = toposort(runnableTickets, internalEdges, (ticket) => ticket.id);
  if (result.cycles.length > 0) {
    return { kind: "blocked-cycle", cycles: result.cycles };
  }

  const orderedTickets: OrchestrationPlanTicket[] = [
    ...result.sorted.map((ticket) => ({
      ticket,
      annotation: annotateTicket(ticket),
      selectedTicketId: selectedTicketIdByExecutionId.get(ticket.id) ?? ticket.id,
    })),
    ...skippedTickets.map((ticket) => ({
      ticket,
      annotation: "skipped-done" as const,
      selectedTicketId: selectedTicketIdByExecutionId.get(ticket.id) ?? ticket.id,
    })),
  ];

  return { kind: "valid", orderedTickets };
}

export function getSelectedTicketForExecutionEntry<TTicket>(input: {
  entry: { ticketId: TicketId; selectedTicketId?: TicketId | undefined };
  ticketsById: ReadonlyMap<TicketId, TTicket>;
}): TTicket | null {
  const selectedTicketId = input.entry.selectedTicketId ?? input.entry.ticketId;
  return input.ticketsById.get(selectedTicketId) ?? null;
}
