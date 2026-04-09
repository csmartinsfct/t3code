import type { TicketDependency, TicketId, TicketSummary, TicketTreeNode } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildOrchestrationPlan } from "./orchestrationValidation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function makeTicket(
  overrides: Partial<TicketSummary> & { id: string; identifier: string },
): TicketSummary {
  counter++;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildOrchestrationPlan", () => {
  it("returns empty for empty selection", () => {
    const plan = buildOrchestrationPlan(new Set(), [], []);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets).toEqual([]);
    }
  });

  it("single ticket with no deps", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1" });
    const tree = [makeTreeNode(t1)];

    const plan = buildOrchestrationPlan(new Set(["1" as TicketId]), tree, [t1]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets).toHaveLength(1);
      expect(plan.orderedTickets[0]!.annotation).toBe("will-run");
    }
  });

  it("expands a selected parent ticket into its leaf subtickets", () => {
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
    if (plan.kind === "valid") {
      expect(plan.orderedTickets.map((entry) => entry.ticket.identifier)).toEqual([
        "T-CHILD-B",
        "T-CHILD-A",
      ]);
    }
  });

  it("dedupes parent expansion when a subtask is also selected directly", () => {
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
    if (plan.kind === "valid") {
      expect(plan.orderedTickets.map((entry) => entry.ticket.identifier)).toEqual(["T-CHILD"]);
    }
  });

  it("does not crash when sibling tree nodes arrive without nested dependency data", () => {
    const parent = makeTicket({ id: "parent" as TicketId, identifier: "T-PARENT" });
    const child = makeTicket({
      id: "child" as TicketId,
      identifier: "T-CHILD",
      parentId: "parent" as TicketId,
    });
    const target = makeTicket({ id: "target" as TicketId, identifier: "T-TARGET" });
    const malformedTree = [
      {
        ticket: parent,
        children: [{ ticket: child }],
        dependencies: [],
      } as unknown as TicketTreeNode,
      {
        ticket: target,
      } as unknown as TicketTreeNode,
    ];

    const plan = buildOrchestrationPlan(new Set(["target" as TicketId]), malformedTree, [target]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets).toHaveLength(1);
      expect(plan.orderedTickets[0]!.ticket.identifier).toBe("T-TARGET");
    }
  });

  it("orders tickets by dependency", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1", sortOrder: 2000 });
    const t2 = makeTicket({ id: "2" as TicketId, identifier: "T-2", sortOrder: 1000 });
    // T-2 depends on T-1 (T-1 must run first)
    const tree = [
      makeTreeNode(t1),
      makeTreeNode(t2, [makeDep("2" as TicketId, "1" as TicketId, "T-1")]),
    ];

    const plan = buildOrchestrationPlan(new Set(["1", "2"] as TicketId[]), tree, [t1, t2]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets[0]!.ticket.identifier).toBe("T-1");
      expect(plan.orderedTickets[1]!.ticket.identifier).toBe("T-2");
    }
  });

  it("falls back to board order when no deps", () => {
    const t1 = makeTicket({
      id: "1" as TicketId,
      identifier: "T-1",
      status: "todo",
      sortOrder: 3000,
    });
    const t2 = makeTicket({
      id: "2" as TicketId,
      identifier: "T-2",
      status: "todo",
      sortOrder: 1000,
    });
    const t3 = makeTicket({
      id: "3" as TicketId,
      identifier: "T-3",
      status: "todo",
      sortOrder: 2000,
    });
    const tree = [makeTreeNode(t1), makeTreeNode(t2), makeTreeNode(t3)];

    const plan = buildOrchestrationPlan(new Set(["1", "2", "3"] as TicketId[]), tree, [t1, t2, t3]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      const ids = plan.orderedTickets.map((o) => o.ticket.identifier);
      // Sorted by sortOrder: T-2 (1000), T-3 (2000), T-1 (3000)
      expect(ids).toEqual(["T-2", "T-3", "T-1"]);
    }
  });

  it("marks done tickets as skipped and places them at the end", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1", status: "done" });
    const t2 = makeTicket({ id: "2" as TicketId, identifier: "T-2", status: "todo" });
    const tree = [makeTreeNode(t1), makeTreeNode(t2)];

    const plan = buildOrchestrationPlan(new Set(["1", "2"] as TicketId[]), tree, [t1, t2]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets[0]!.ticket.identifier).toBe("T-2");
      expect(plan.orderedTickets[0]!.annotation).toBe("will-run");
      expect(plan.orderedTickets[1]!.ticket.identifier).toBe("T-1");
      expect(plan.orderedTickets[1]!.annotation).toBe("skipped-done");
    }
  });

  it("marks in-progress tickets with warn-reprocess", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1", status: "in_progress" });
    const tree = [makeTreeNode(t1)];

    const plan = buildOrchestrationPlan(new Set(["1" as TicketId]), tree, [t1]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets[0]!.annotation).toBe("warn-reprocess");
    }
  });

  it("marks in-review tickets with warn-reprocess", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1", status: "in_review" });
    const tree = [makeTreeNode(t1)];

    const plan = buildOrchestrationPlan(new Set(["1" as TicketId]), tree, [t1]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      expect(plan.orderedTickets[0]!.annotation).toBe("warn-reprocess");
    }
  });

  it("blocks on external non-done dependency", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1" });
    const t2 = makeTicket({ id: "2" as TicketId, identifier: "T-2" });
    // T-1 depends on T-2, but T-2 is NOT selected
    const tree = [
      makeTreeNode(t1, [makeDep("1" as TicketId, "2" as TicketId, "T-2", "todo")]),
      makeTreeNode(t2),
    ];

    const plan = buildOrchestrationPlan(new Set(["1" as TicketId]), tree, [t1, t2]);
    expect(plan.kind).toBe("blocked-external");
    if (plan.kind === "blocked-external") {
      expect(plan.externalDeps).toHaveLength(1);
      expect(plan.externalDeps[0]!.dependsOn.identifier).toBe("T-2");
    }
  });

  it("allows external dependency when it is done", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1" });
    const t2 = makeTicket({ id: "2" as TicketId, identifier: "T-2", status: "done" });
    // T-1 depends on T-2 which is done → allowed
    const tree = [
      makeTreeNode(t1, [makeDep("1" as TicketId, "2" as TicketId, "T-2", "done")]),
      makeTreeNode(t2),
    ];

    const plan = buildOrchestrationPlan(new Set(["1" as TicketId]), tree, [t1, t2]);
    expect(plan.kind).toBe("valid");
  });

  it("blocks on dependency cycle", () => {
    const t1 = makeTicket({ id: "1" as TicketId, identifier: "T-1" });
    const t2 = makeTicket({ id: "2" as TicketId, identifier: "T-2" });
    // T-1 depends on T-2, T-2 depends on T-1 → cycle
    const tree = [
      makeTreeNode(t1, [makeDep("1" as TicketId, "2" as TicketId, "T-2")]),
      makeTreeNode(t2, [makeDep("2" as TicketId, "1" as TicketId, "T-1")]),
    ];

    const plan = buildOrchestrationPlan(new Set(["1", "2"] as TicketId[]), tree, [t1, t2]);
    expect(plan.kind).toBe("blocked-cycle");
    if (plan.kind === "blocked-cycle") {
      expect(plan.cycles.length).toBeGreaterThan(0);
    }
  });

  it("handles diamond dependency correctly", () => {
    const a = makeTicket({ id: "a" as TicketId, identifier: "A", sortOrder: 4000 });
    const b = makeTicket({ id: "b" as TicketId, identifier: "B", sortOrder: 3000 });
    const c = makeTicket({ id: "c" as TicketId, identifier: "C", sortOrder: 2000 });
    const d = makeTicket({ id: "d" as TicketId, identifier: "D", sortOrder: 1000 });
    // D depends on B and C; B and C depend on A
    const tree = [
      makeTreeNode(a),
      makeTreeNode(b, [makeDep("b" as TicketId, "a" as TicketId, "A")]),
      makeTreeNode(c, [makeDep("c" as TicketId, "a" as TicketId, "A")]),
      makeTreeNode(d, [
        makeDep("d" as TicketId, "b" as TicketId, "B"),
        makeDep("d" as TicketId, "c" as TicketId, "C"),
      ]),
    ];

    const plan = buildOrchestrationPlan(new Set(["a", "b", "c", "d"] as TicketId[]), tree, [
      a,
      b,
      c,
      d,
    ]);
    expect(plan.kind).toBe("valid");
    if (plan.kind === "valid") {
      const ids = plan.orderedTickets.map((o) => o.ticket.identifier);
      expect(ids[0]).toBe("A"); // A first (no deps)
      expect(ids[ids.length - 1]).toBe("D"); // D last (depends on B and C)
    }
  });
});
