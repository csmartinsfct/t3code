import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { TicketingRepositoryLive } from "../../persistence/Layers/Ticketing.ts";
import { TicketThreadLinkRepositoryLive } from "../../persistence/Layers/TicketThreadLinks.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { TicketThreadLinkRepository } from "../../persistence/Services/TicketThreadLinks.ts";
import { TicketingService } from "../Services/Ticketing.ts";
import { TicketingServiceLive } from "./Ticketing.ts";

const TicketingTestLayer = it.layer(
  Layer.mergeAll(
    TicketingServiceLive.pipe(
      Layer.provide(TicketThreadLinkRepositoryLive),
      Layer.provide(ProjectionThreadRepositoryLive),
      Layer.provide(TicketingRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    ),
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

TicketingTestLayer("TicketingService", (it) => {
  it.effect("stores an origin-thread link when a ticket is created from a thread", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-origin");
      const threadId = ThreadId.makeUnsafe("thread-origin");
      const ticketing = yield* TicketingService;
      const links = yield* TicketThreadLinkRepository;

      yield* seedProject(projectId, "Origin project");
      yield* seedThread({ threadId, projectId });

      const ticket = yield* ticketing.create({
        projectId,
        originThreadId: threadId,
        title: "Origin linked ticket",
      });

      const persistedLinks = yield* links.listByThreadId({ threadId });
      assert.deepStrictEqual(
        persistedLinks.map((link) => ({
          ticketId: link.ticketId,
          threadId: link.threadId,
          linkType: link.linkType,
          sourceMessageId: link.sourceMessageId,
        })),
        [
          {
            ticketId: ticket.id,
            threadId,
            linkType: "origin",
            sourceMessageId: "",
          },
        ],
      );
    }),
  );

  it.effect("rejects origin threads that belong to another project", () =>
    Effect.gen(function* () {
      const ticketing = yield* TicketingService;
      const projectId = ProjectId.makeUnsafe("project-ticket");
      const otherProjectId = ProjectId.makeUnsafe("project-thread");
      const threadId = ThreadId.makeUnsafe("thread-cross-project");

      yield* seedProject(projectId, "Alpha ticket project");
      yield* seedProject(otherProjectId, "Beta thread project");
      yield* seedThread({ threadId, projectId: otherProjectId });

      const exit = yield* Effect.exit(
        ticketing.create({
          projectId,
          originThreadId: threadId,
          title: "Cross-project origin",
        }),
      );

      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.effect("returns only the archived origin thread and ignores non-origin links", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-links");
      const originThreadId = ThreadId.makeUnsafe("thread-origin-links");
      const relatedThreadId = ThreadId.makeUnsafe("thread-related-links");
      const deletedThreadId = ThreadId.makeUnsafe("thread-deleted-links");
      const ticketing = yield* TicketingService;
      const links = yield* TicketThreadLinkRepository;

      yield* seedProject(projectId, "Gamma linked project");
      yield* seedThread({
        threadId: originThreadId,
        projectId,
        archivedAt: "2026-04-09T10:30:00.000Z",
      });
      yield* seedThread({ threadId: relatedThreadId, projectId });
      yield* seedThread({
        threadId: deletedThreadId,
        projectId,
        deletedAt: "2026-04-09T11:00:00.000Z",
      });

      const ticket = yield* ticketing.create({
        projectId,
        originThreadId: originThreadId,
        title: "Linked thread ticket",
      });

      yield* links.upsertStructuredLink({
        ticketId: ticket.id,
        threadId: relatedThreadId,
        linkType: "bound",
        occurredAt: "2026-04-09T11:00:00.000Z",
      });
      yield* links.replaceMentionLinksForMessage({
        projectId,
        ticketIds: [ticket.id],
        threadId: relatedThreadId,
        messageId: "message-1",
        occurredAt: "2026-04-09T11:05:00.000Z",
      });
      yield* links.upsertStructuredLink({
        ticketId: ticket.id,
        threadId: deletedThreadId,
        linkType: "bound",
        occurredAt: "2026-04-09T11:10:00.000Z",
      });

      const result = yield* ticketing.getThreadLinks({ ticketId: ticket.id });

      assert.strictEqual(result.originThread?.threadId, originThreadId);
      assert.strictEqual(result.originThread?.archivedAt, "2026-04-09T10:30:00.000Z");
      assert.deepStrictEqual(result.originThread?.linkTypes, ["origin"]);
      assert.strictEqual(result.originThread?.isVisible, false);
      assert.strictEqual(result.originThread?.linkedAt, ticket.createdAt);
      assert.deepStrictEqual(
        result.relatedThreads.map((thread) => ({
          threadId: thread.threadId,
          linkTypes: thread.linkTypes,
          isVisible: thread.isVisible,
          linkedAt: thread.linkedAt,
        })),
        [
          {
            threadId: relatedThreadId,
            linkTypes: ["bound", "mention"],
            isVisible: true,
            linkedAt: "2026-04-09T11:00:00.000Z",
          },
        ],
      );
    }),
  );

  it.effect("omits deleted origin threads from thread links", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-deleted-origin");
      const deletedOriginThreadId = ThreadId.makeUnsafe("thread-deleted-origin");
      const ticketing = yield* TicketingService;

      yield* seedProject(projectId, "Deleted origin project");
      yield* seedThread({ threadId: deletedOriginThreadId, projectId });

      const ticket = yield* ticketing.create({
        projectId,
        originThreadId: deletedOriginThreadId,
        title: "Deleted origin ticket",
      });

      yield* seedThread({
        threadId: deletedOriginThreadId,
        projectId,
        deletedAt: "2026-04-09T10:30:00.000Z",
      });

      const result = yield* ticketing.getThreadLinks({ ticketId: ticket.id });

      assert.strictEqual(result.originThread, null);
      assert.deepStrictEqual(result.relatedThreads, []);
    }),
  );
});
