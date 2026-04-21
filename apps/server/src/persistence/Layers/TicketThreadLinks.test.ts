import { ProjectId, ThreadId, TicketId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { TicketThreadLinkRepositoryLive } from "./TicketThreadLinks.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { TicketThreadLinkRepository } from "../Services/TicketThreadLinks.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    TicketThreadLinkRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
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

const seedThread = (input: {
  threadId: ThreadId;
  projectId: ProjectId;
  archivedAt?: string | null;
  deletedAt?: string | null;
}) =>
  Effect.gen(function* () {
    const threads = yield* ProjectionThreadRepository;
    yield* threads.upsert({
      threadId: input.threadId,
      projectId: input.projectId,
      title: `Thread ${input.threadId}`,
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      parentThreadId: null,
      isOrchestrationThread: false,
      ticketId: null,
      latestTurnId: null,
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
      archivedAt: input.archivedAt ?? null,
      deletedAt: input.deletedAt ?? null,
    });
  });

const seedTicket = (input: {
  ticketId: TicketId;
  projectId: ProjectId;
  ticketNumber: number;
  identifier: string;
  title: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO tickets (
        id,
        project_id,
        parent_id,
        ticket_number,
        identifier,
        title,
        description,
        acceptance_criteria_json,
        status,
        priority,
        sort_order,
        is_archived,
        worktree,
        created_at,
        updated_at
      )
      VALUES (
        ${input.ticketId},
        ${input.projectId},
        NULL,
        ${input.ticketNumber},
        ${input.identifier},
        ${input.title},
        NULL,
        NULL,
        'backlog',
        'none',
        0,
        0,
        NULL,
        '2026-04-09T10:00:00.000Z',
        '2026-04-09T10:00:00.000Z'
      )
    `;
  });

layer("TicketThreadLinkRepository", (it) => {
  it.effect("stores thread links and can filter ticket reads by link type", () =>
    Effect.gen(function* () {
      const repository = yield* TicketThreadLinkRepository;
      const projectId = ProjectId.makeUnsafe("project-ticket-thread-links");
      const ticketId = TicketId.makeUnsafe("ticket-ticket-thread-links");
      const threadId = ThreadId.makeUnsafe("thread-ticket-thread-links");

      yield* seedProject(projectId, "Alpha thread links");
      yield* seedThread({ threadId, projectId, archivedAt: "2026-04-09T10:30:00.000Z" });
      yield* seedTicket({
        ticketId,
        projectId,
        ticketNumber: 1,
        identifier: "ALPH-1",
        title: "Alpha link target",
      });

      yield* repository.upsertStructuredLink({
        ticketId,
        threadId,
        linkType: "origin",
        occurredAt: "2026-04-09T10:40:00.000Z",
      });
      yield* repository.upsertStructuredLink({
        ticketId,
        threadId,
        linkType: "bound",
        occurredAt: "2026-04-09T10:45:00.000Z",
      });
      yield* repository.replaceMentionLinksForMessage({
        projectId,
        ticketIds: [ticketId],
        threadId,
        messageId: "message-1",
        occurredAt: "2026-04-09T10:50:00.000Z",
      });

      const rows = yield* repository.listByTicketId({ ticketId });
      assert.deepStrictEqual(
        rows.map((row) => ({
          threadId: row.threadId,
          linkType: row.linkType,
          sourceMessageId: row.sourceMessageId,
          archivedAt: row.threadArchivedAt,
        })),
        [
          {
            threadId,
            linkType: "mention",
            sourceMessageId: "message-1",
            archivedAt: "2026-04-09T10:30:00.000Z",
          },
          {
            threadId,
            linkType: "bound",
            sourceMessageId: "",
            archivedAt: "2026-04-09T10:30:00.000Z",
          },
          {
            threadId,
            linkType: "origin",
            sourceMessageId: "",
            archivedAt: "2026-04-09T10:30:00.000Z",
          },
        ],
      );

      const originRows = yield* repository.listByTicketId({
        ticketId,
        linkTypes: ["origin"],
      });
      assert.deepStrictEqual(
        originRows.map((row) => ({
          threadId: row.threadId,
          linkType: row.linkType,
          sourceMessageId: row.sourceMessageId,
        })),
        [
          {
            threadId,
            linkType: "origin",
            sourceMessageId: "",
          },
        ],
      );
    }),
  );

  it.effect("replaces mention links for a message and removes them when deleted", () =>
    Effect.gen(function* () {
      const repository = yield* TicketThreadLinkRepository;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.makeUnsafe("project-ticket-thread-message-links");
      const firstTicketId = TicketId.makeUnsafe("ticket-thread-link-first");
      const secondTicketId = TicketId.makeUnsafe("ticket-thread-link-second");
      const threadId = ThreadId.makeUnsafe("thread-ticket-thread-message-links");

      yield* seedProject(projectId, "Beta thread links");
      yield* seedThread({ threadId, projectId });
      yield* seedTicket({
        ticketId: firstTicketId,
        projectId,
        ticketNumber: 1,
        identifier: "BETA-1",
        title: "First ticket",
      });
      yield* seedTicket({
        ticketId: secondTicketId,
        projectId,
        ticketNumber: 2,
        identifier: "BETA-2",
        title: "Second ticket",
      });

      yield* repository.replaceMentionLinksForMessage({
        projectId,
        ticketIds: [firstTicketId],
        threadId,
        messageId: "message-1",
        occurredAt: "2026-04-09T10:55:00.000Z",
      });
      yield* repository.replaceMentionLinksForMessage({
        projectId,
        ticketIds: [secondTicketId],
        threadId,
        messageId: "message-1",
        occurredAt: "2026-04-09T11:00:00.000Z",
      });

      const afterReplace = yield* repository.listByThreadId({ threadId });
      assert.deepStrictEqual(
        afterReplace.map((row) => ({
          ticketId: row.ticketId,
          linkType: row.linkType,
          sourceMessageId: row.sourceMessageId,
        })),
        [
          {
            ticketId: secondTicketId,
            linkType: "mention",
            sourceMessageId: "message-1",
          },
        ],
      );

      yield* repository.deleteLinksByMessageId({
        threadId,
        messageIds: ["message-1"],
      });

      const persistedRows = yield* sql<{
        readonly rowCount: number;
      }>`
        SELECT COUNT(*) AS "rowCount"
        FROM ticket_thread_links
        WHERE thread_id = ${threadId}
      `;
      assert.strictEqual(persistedRows[0]?.rowCount, 0);
    }),
  );
});
