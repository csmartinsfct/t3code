import { ProjectId, TicketId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { TicketingRepositoryLive } from "./Ticketing.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { TicketingRepository } from "../Services/Ticketing.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    TicketingRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const seedProject = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const projects = yield* ProjectionProjectRepository;
    yield* projects.upsert({
      projectId,
      title,
      nameHidden: false,
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      scripts: [],
      systemPrompt: null,
      promptOverrides: { orchestration: {} },
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
      deletedAt: null,
    });
  });

const seedTicket = (input: {
  id: TicketId;
  projectId: ProjectId;
  parentId: TicketId | null;
  ticketNumber: number;
  identifier: string;
  title: string;
  sortOrder: number;
  createdAt: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* TicketingRepository;
    yield* repository.createTicket({
      id: input.id,
      projectId: input.projectId,
      parentId: input.parentId,
      ticketNumber: input.ticketNumber,
      identifier: input.identifier,
      title: input.title,
      description: null,
      acceptanceCriteria: null,
      status: "todo",
      priority: "medium",
      sortOrder: input.sortOrder,
      isArchived: false,
      worktree: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  });

layer("TicketingRepository", (it) => {
  it.effect("lists children in deterministic order after reorder updates", () =>
    Effect.gen(function* () {
      const repository = yield* TicketingRepository;
      const projectId = ProjectId.makeUnsafe("project-ticketing-order");
      const parentId = TicketId.makeUnsafe("ticket-parent");
      const firstChildId = TicketId.makeUnsafe("ticket-child-a");
      const secondChildId = TicketId.makeUnsafe("ticket-child-b");
      const thirdChildId = TicketId.makeUnsafe("ticket-child-c");

      yield* seedProject(projectId, "Ticket order project");
      yield* seedTicket({
        id: parentId,
        projectId,
        parentId: null,
        ticketNumber: 1,
        identifier: "ORD-1",
        title: "Parent ticket",
        sortOrder: 0,
        createdAt: "2026-04-09T10:00:00.000Z",
      });
      yield* seedTicket({
        id: firstChildId,
        projectId,
        parentId,
        ticketNumber: 2,
        identifier: "ORD-2",
        title: "First child",
        sortOrder: 0,
        createdAt: "2026-04-09T10:01:00.000Z",
      });
      yield* seedTicket({
        id: secondChildId,
        projectId,
        parentId,
        ticketNumber: 3,
        identifier: "ORD-3",
        title: "Second child",
        sortOrder: 1000,
        createdAt: "2026-04-09T10:02:00.000Z",
      });
      yield* seedTicket({
        id: thirdChildId,
        projectId,
        parentId,
        ticketNumber: 4,
        identifier: "ORD-4",
        title: "Third child",
        sortOrder: 2000,
        createdAt: "2026-04-09T10:03:00.000Z",
      });

      const initial = yield* repository.listByParent({ parentId });
      assert.deepStrictEqual(
        initial.map((ticket) => ticket.id),
        [firstChildId, secondChildId, thirdChildId],
      );

      const thirdChild = initial.find((ticket) => ticket.id === thirdChildId);
      const firstChild = initial.find((ticket) => ticket.id === firstChildId);
      const secondChild = initial.find((ticket) => ticket.id === secondChildId);
      if (!thirdChild || !firstChild || !secondChild) {
        return yield* Effect.fail(new Error("Expected seeded child tickets to exist."));
      }

      yield* repository.updateTicket({
        ...thirdChild,
        sortOrder: 0,
        updatedAt: "2026-04-09T10:04:00.000Z",
      });
      yield* repository.updateTicket({
        ...firstChild,
        sortOrder: 1000,
        updatedAt: "2026-04-09T10:04:01.000Z",
      });
      yield* repository.updateTicket({
        ...secondChild,
        sortOrder: 1000,
        updatedAt: "2026-04-09T10:04:02.000Z",
      });

      const reordered = yield* repository.listByParent({ parentId });
      assert.deepStrictEqual(
        reordered.map((ticket) => ({
          id: ticket.id,
          sortOrder: ticket.sortOrder,
        })),
        [
          { id: thirdChildId, sortOrder: 0 },
          // same sortOrder - tiebroken by createdAt ASC
          { id: firstChildId, sortOrder: 1000 },
          { id: secondChildId, sortOrder: 1000 },
        ],
      );
    }),
  );

  it.effect("listSubtree returns multi-level descendants of the root, excluding the root", () =>
    Effect.gen(function* () {
      const repository = yield* TicketingRepository;
      const projectId = ProjectId.makeUnsafe("project-subtree");
      const rootId = TicketId.makeUnsafe("ticket-subtree-root");
      const childA = TicketId.makeUnsafe("ticket-subtree-childA");
      const childB = TicketId.makeUnsafe("ticket-subtree-childB");
      const grandA1 = TicketId.makeUnsafe("ticket-subtree-grandA1");
      const grandA2 = TicketId.makeUnsafe("ticket-subtree-grandA2");
      const greatGrandA1A = TicketId.makeUnsafe("ticket-subtree-greatA1A");
      const otherRoot = TicketId.makeUnsafe("ticket-subtree-other");

      yield* seedProject(projectId, "Subtree project");
      yield* seedTicket({
        id: rootId,
        projectId,
        parentId: null,
        ticketNumber: 1,
        identifier: "SUB-1",
        title: "Root",
        sortOrder: 0,
        createdAt: "2026-04-09T10:00:00.000Z",
      });
      yield* seedTicket({
        id: childA,
        projectId,
        parentId: rootId,
        ticketNumber: 2,
        identifier: "SUB-2",
        title: "Child A",
        sortOrder: 0,
        createdAt: "2026-04-09T10:01:00.000Z",
      });
      yield* seedTicket({
        id: childB,
        projectId,
        parentId: rootId,
        ticketNumber: 3,
        identifier: "SUB-3",
        title: "Child B",
        sortOrder: 1,
        createdAt: "2026-04-09T10:02:00.000Z",
      });
      yield* seedTicket({
        id: grandA1,
        projectId,
        parentId: childA,
        ticketNumber: 4,
        identifier: "SUB-4",
        title: "Grand A1",
        sortOrder: 0,
        createdAt: "2026-04-09T10:03:00.000Z",
      });
      yield* seedTicket({
        id: grandA2,
        projectId,
        parentId: childA,
        ticketNumber: 5,
        identifier: "SUB-5",
        title: "Grand A2",
        sortOrder: 1,
        createdAt: "2026-04-09T10:04:00.000Z",
      });
      yield* seedTicket({
        id: greatGrandA1A,
        projectId,
        parentId: grandA1,
        ticketNumber: 6,
        identifier: "SUB-6",
        title: "Great Grand A1A",
        sortOrder: 0,
        createdAt: "2026-04-09T10:05:00.000Z",
      });
      // Sibling top-level ticket — should not appear in the subtree of root.
      yield* seedTicket({
        id: otherRoot,
        projectId,
        parentId: null,
        ticketNumber: 7,
        identifier: "SUB-7",
        title: "Other root",
        sortOrder: 1,
        createdAt: "2026-04-09T10:06:00.000Z",
      });

      const descendants = yield* repository.listSubtree({
        projectId,
        rootTicketId: rootId,
      });
      const ids = new Set(descendants.map((t) => t.id));

      assert.strictEqual(ids.size, 5);
      assert.isTrue(ids.has(childA));
      assert.isTrue(ids.has(childB));
      assert.isTrue(ids.has(grandA1));
      assert.isTrue(ids.has(grandA2));
      assert.isTrue(ids.has(greatGrandA1A));
      assert.isFalse(ids.has(rootId));
      assert.isFalse(ids.has(otherRoot));
    }),
  );

  it.effect(
    "listSubtree respects the limit (returns up to limit + 1 for truncation detection)",
    () =>
      Effect.gen(function* () {
        const repository = yield* TicketingRepository;
        const projectId = ProjectId.makeUnsafe("project-subtree-limit");
        const rootId = TicketId.makeUnsafe("ticket-limit-root");

        yield* seedProject(projectId, "Subtree limit project");
        yield* seedTicket({
          id: rootId,
          projectId,
          parentId: null,
          ticketNumber: 1,
          identifier: "LIM-1",
          title: "Root",
          sortOrder: 0,
          createdAt: "2026-04-09T10:00:00.000Z",
        });
        // Seed 5 children of root.
        for (let i = 0; i < 5; i++) {
          yield* seedTicket({
            id: TicketId.makeUnsafe(`ticket-limit-child-${i}`),
            projectId,
            parentId: rootId,
            ticketNumber: i + 2,
            identifier: `LIM-${i + 2}`,
            title: `Child ${i}`,
            sortOrder: i,
            createdAt: `2026-04-09T10:0${i + 1}:00.000Z`,
          });
        }

        // limit = 3 → returns 4 rows (limit + 1) so the service can detect truncation.
        const limited = yield* repository.listSubtree({
          projectId,
          rootTicketId: rootId,
          limit: 3,
        });
        assert.strictEqual(limited.length, 4);

        // limit = 10 → returns all 5 children, no overflow row.
        const all = yield* repository.listSubtree({
          projectId,
          rootTicketId: rootId,
          limit: 10,
        });
        assert.strictEqual(all.length, 5);
      }),
  );

  it.effect(
    "listSubtree excludes archived descendants by default and includes them when requested",
    () =>
      Effect.gen(function* () {
        const repository = yield* TicketingRepository;
        const projectId = ProjectId.makeUnsafe("project-subtree-archived");
        const rootId = TicketId.makeUnsafe("ticket-arch-root");
        const archivedChildId = TicketId.makeUnsafe("ticket-arch-child");
        const liveChildId = TicketId.makeUnsafe("ticket-live-child");

        yield* seedProject(projectId, "Subtree archive project");
        yield* seedTicket({
          id: rootId,
          projectId,
          parentId: null,
          ticketNumber: 1,
          identifier: "ARC-1",
          title: "Root",
          sortOrder: 0,
          createdAt: "2026-04-09T10:00:00.000Z",
        });
        yield* seedTicket({
          id: archivedChildId,
          projectId,
          parentId: rootId,
          ticketNumber: 2,
          identifier: "ARC-2",
          title: "Archived child",
          sortOrder: 0,
          createdAt: "2026-04-09T10:01:00.000Z",
        });
        yield* seedTicket({
          id: liveChildId,
          projectId,
          parentId: rootId,
          ticketNumber: 3,
          identifier: "ARC-3",
          title: "Live child",
          sortOrder: 1,
          createdAt: "2026-04-09T10:02:00.000Z",
        });
        yield* repository.archiveTicket({ id: archivedChildId });

        const live = yield* repository.listSubtree({
          projectId,
          rootTicketId: rootId,
        });
        assert.strictEqual(live.length, 1);
        assert.strictEqual(live[0]?.id, liveChildId);

        const includingArchived = yield* repository.listSubtree({
          projectId,
          rootTicketId: rootId,
          includeArchived: true,
        });
        assert.strictEqual(includingArchived.length, 2);
      }),
  );
});
