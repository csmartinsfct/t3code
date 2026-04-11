import type { TicketDependency, TicketId, TicketSummary, TicketTreeNode } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildOrchestrationPlan, getSelectedTicketForExecutionEntry } from "./orchestrationPlan.js";

let counter = 0;

function makeTicket(
  overrides: Partial<TicketSummary> & { id: string; identifier: string },
): TicketSummary {
  counter += 1;
  return {
    projectId: "proj-1",
    parentId: null,
    ticketNumber: counter,
    title: overrides.identifier,
    status: "todo",
    priority: "none",
    sortOrder: counter * 1000,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as TicketSummary;
}

function makeTreeNode(
  ticket: TicketSummary,
  deps: TicketDependency[] = [],
  children: TicketTreeNode[] = [],
): TicketTreeNode {
  return { ticket, dependencies: deps, children } as TicketTreeNode;
}

function makeDep(
  ticketId: TicketId,
  dependsOnTicketId: TicketId,
  identifier: string,
  status: TicketSummary["status"] = "todo",
): TicketDependency {
  return { ticketId, dependsOnTicketId, identifier, title: identifier, status } as TicketDependency;
}

describe("buildOrchestrationPlan", () => {
  it("maps selected parent subtasks back to the parent ticket id", () => {
    const parent = makeTicket({ id: "parent" as TicketId, identifier: "T-PARENT" });
    const childA = makeTicket({
      id: "child-a" as TicketId,
      identifier: "T-CHILD-A",
      parentId: "parent" as TicketId,
      sortOrder: 2000,
    });
    const childB = makeTicket({
      id: "child-b" as TicketId,
      identifier: "T-CHILD-B",
      parentId: "parent" as TicketId,
      sortOrder: 1000,
    });
    const tree = [makeTreeNode(parent, [], [makeTreeNode(childA), makeTreeNode(childB)])];

    const plan = buildOrchestrationPlan(new Set(["parent" as TicketId]), tree, [
      parent,
      childA,
      childB,
    ]);

    expect(plan.kind).toBe("valid");
    if (plan.kind !== "valid") return;

    expect(plan.orderedTickets.map((entry) => entry.ticket.identifier)).toEqual([
      "T-CHILD-B",
      "T-CHILD-A",
    ]);
    expect(plan.orderedTickets.map((entry) => entry.selectedTicketId)).toEqual([
      parent.id,
      parent.id,
    ]);
  });

  it("keeps selected parent grouping when a child is selected directly too", () => {
    const parent = makeTicket({ id: "parent" as TicketId, identifier: "T-PARENT" });
    const child = makeTicket({
      id: "child" as TicketId,
      identifier: "T-CHILD",
      parentId: "parent" as TicketId,
    });
    const tree = [makeTreeNode(parent, [], [makeTreeNode(child)])];

    const plan = buildOrchestrationPlan(new Set(["parent", "child"] as TicketId[]), tree, [
      parent,
      child,
    ]);

    expect(plan.kind).toBe("valid");
    if (plan.kind !== "valid") return;

    expect(plan.orderedTickets).toHaveLength(1);
    expect(plan.orderedTickets[0]?.selectedTicketId).toBe(parent.id);
  });

  it("keeps separate selected-ticket groups for multi-ticket runs", () => {
    const parentA = makeTicket({
      id: "parent-a" as TicketId,
      identifier: "T-PARENT-A",
      sortOrder: 1000,
    });
    const childA = makeTicket({
      id: "child-a" as TicketId,
      identifier: "T-CHILD-A",
      parentId: parentA.id,
      sortOrder: 1000,
    });
    const leafB = makeTicket({ id: "leaf-b" as TicketId, identifier: "T-LEAF-B", sortOrder: 2000 });
    const tree = [makeTreeNode(parentA, [], [makeTreeNode(childA)]), makeTreeNode(leafB)];

    const plan = buildOrchestrationPlan(new Set([parentA.id, leafB.id]), tree, [
      parentA,
      childA,
      leafB,
    ]);

    expect(plan.kind).toBe("valid");
    if (plan.kind !== "valid") return;

    expect(plan.orderedTickets.map((entry) => entry.selectedTicketId)).toEqual([
      parentA.id,
      leafB.id,
    ]);
  });

  it("still blocks external dependencies for execution leaves", () => {
    const parent = makeTicket({ id: "parent" as TicketId, identifier: "T-PARENT" });
    const child = makeTicket({
      id: "child" as TicketId,
      identifier: "T-CHILD",
      parentId: parent.id,
    });
    const dep = makeTicket({ id: "dep" as TicketId, identifier: "T-DEP" });
    const tree = [
      makeTreeNode(
        parent,
        [],
        [makeTreeNode(child, [makeDep(child.id, dep.id, dep.identifier, "todo")])],
      ),
      makeTreeNode(dep),
    ];

    const plan = buildOrchestrationPlan(new Set([parent.id]), tree, [parent, child, dep]);

    expect(plan.kind).toBe("blocked-external");
  });
});

describe("getSelectedTicketForExecutionEntry", () => {
  it("prefers selectedTicketId when present and falls back to ticketId for legacy entries", () => {
    const selected = makeTicket({ id: "selected" as TicketId, identifier: "T-SELECTED" });
    const execution = makeTicket({ id: "execution" as TicketId, identifier: "T-EXECUTION" });
    const ticketsById = new Map([
      [selected.id, selected],
      [execution.id, execution],
    ]);

    expect(
      getSelectedTicketForExecutionEntry({
        entry: { ticketId: execution.id, selectedTicketId: selected.id },
        ticketsById,
      })?.id,
    ).toBe(selected.id);

    expect(
      getSelectedTicketForExecutionEntry({
        entry: { ticketId: execution.id },
        ticketsById,
      })?.id,
    ).toBe(execution.id);
  });
});
