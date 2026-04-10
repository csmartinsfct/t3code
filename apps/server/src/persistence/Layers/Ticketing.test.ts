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
      implementerModelJson: null,
      reviewerModelJson: null,
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
});
