import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
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

const PlatformSupport = Layer.provideMerge(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-ticketing-test" }),
  NodeServices.layer,
);

const TicketingTestLayer = it.layer(
  Layer.mergeAll(
    TicketingServiceLive.pipe(
      Layer.provide(TicketThreadLinkRepositoryLive),
      Layer.provide(ProjectionThreadRepositoryLive),
      Layer.provide(TicketingRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
      Layer.provide(PlatformSupport),
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
      assert.strictEqual(result.originThread?.linkedAt, ticket.createdAt);
      assert.ok(!("relatedThreads" in result));
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
      assert.ok(!("relatedThreads" in result));
    }),
  );

  it.effect("persists worktree updates and clears across ticket reads", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-worktree");
      const ticketing = yield* TicketingService;

      yield* seedProject(projectId, "Worktree project");

      const created = yield* ticketing.create({
        projectId,
        title: "Worktree persistence ticket",
      });

      const updated = yield* ticketing.update({
        id: created.id,
        worktree: "feature/t3co-161-inline-edit",
      });

      assert.strictEqual(updated.worktree, "feature/t3co-161-inline-edit");

      const byId = yield* ticketing.getById({ id: created.id });
      const byIdentifier = yield* ticketing.getByIdentifier({ identifier: created.identifier });
      const listed = yield* ticketing.list({ projectId });

      assert.strictEqual(byId.worktree, "feature/t3co-161-inline-edit");
      assert.strictEqual(byIdentifier.worktree, "feature/t3co-161-inline-edit");
      assert.strictEqual(listed[0]?.worktree, "feature/t3co-161-inline-edit");

      const cleared = yield* ticketing.update({
        id: created.id,
        worktree: null,
      });

      assert.strictEqual(cleared.worktree, null);

      const afterClear = yield* ticketing.getById({ id: created.id });
      const listedAfterClear = yield* ticketing.list({ projectId });

      assert.strictEqual(afterClear.worktree, null);
      assert.strictEqual(listedAfterClear[0]?.worktree, null);
    }),
  );

  it.effect("publishes ticket updates when labels are added and removed", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-label-events");
      const ticketing = yield* TicketingService;

      yield* seedProject(projectId, "Label events project");

      const ticket = yield* ticketing.create({
        projectId,
        title: "Label event ticket",
      });
      const label = yield* ticketing.createLabel({
        projectId,
        name: "Backend",
        color: "#3b82f6",
      });

      const eventsFiber = yield* ticketing.streamEvents.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;

      yield* ticketing.addTicketLabel({
        ticketId: ticket.id,
        labelId: label.id,
      });
      yield* ticketing.removeTicketLabel({
        ticketId: ticket.id,
        labelId: label.id,
      });

      const events = yield* Fiber.join(eventsFiber);

      assert.deepStrictEqual(
        events.map((event) => ({
          type: event.type,
          ticketId: event.type === "ticket_upserted" ? event.ticket.id : null,
          labels:
            event.type === "ticket_upserted" ? event.ticket.labels.map((item) => item.name) : [],
        })),
        [
          {
            type: "ticket_upserted",
            ticketId: ticket.id,
            labels: ["Backend"],
          },
          {
            type: "ticket_upserted",
            ticketId: ticket.id,
            labels: [],
          },
        ],
      );
    }),
  );

  it.effect("archives a ticket (hidden from default list, visible with includeArchived)", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-archive-basic");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "BasicArchiveTest");

      const ticket = yield* ticketing.create({ projectId, title: "Archive me" });

      yield* ticketing.archive({ id: ticket.id });

      const defaultList = yield* ticketing.list({ projectId });
      assert.deepStrictEqual(
        defaultList.map((t) => t.id),
        [],
      );

      const withArchived = yield* ticketing.list({ projectId, includeArchived: true });
      assert.strictEqual(withArchived.length, 1);
      assert.strictEqual(withArchived[0]?.isArchived, true);

      yield* ticketing.unarchive({ id: ticket.id });
      const afterUnarchive = yield* ticketing.list({ projectId });
      assert.strictEqual(afterUnarchive.length, 1);
      assert.strictEqual(afterUnarchive[0]?.isArchived, false);
    }),
  );

  it.effect("archive cascades to sub-tickets", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-archive-cascade");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "CascadeArchiveTest");

      const parent = yield* ticketing.create({ projectId, title: "Parent" });
      const child = yield* ticketing.create({
        projectId,
        title: "Child",
        parentId: parent.id,
      });
      const grandchild = yield* ticketing.create({
        projectId,
        title: "Grandchild",
        parentId: child.id,
      });

      yield* ticketing.archive({ id: parent.id });

      const withArchived = yield* ticketing.list({ projectId, includeArchived: true });
      const archivedIds = withArchived.filter((t) => t.isArchived).map((t) => t.id);
      assert.deepStrictEqual(new Set(archivedIds), new Set([parent.id, child.id, grandchild.id]));

      yield* ticketing.unarchive({ id: parent.id });
      const afterUnarchive = yield* ticketing.list({ projectId });
      assert.strictEqual(afterUnarchive.length, 3);
      for (const t of afterUnarchive) {
        assert.strictEqual(t.isArchived, false);
      }
    }),
  );

  it.effect("ingests an image dataUrl and rewrites the artifact payload to storage=local", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-attach-ingest");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "IngestProject");

      const ticket = yield* ticketing.create({ projectId, title: "Attach ingest ticket" });

      // 1x1 transparent PNG
      const tinyPngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const artifact = yield* ticketing.createArtifact({
        ticketId: ticket.id,
        type: "image",
        title: "Tiny PNG",
        payload: {
          dataUrl: `data:image/png;base64,${tinyPngBase64}`,
          name: "tiny.png",
          mimeType: "image/png",
        },
      });

      const payload = artifact.payload as Record<string, unknown>;
      assert.strictEqual(payload.storage, "local");
      assert.strictEqual(typeof payload.attachmentId, "string");
      assert.strictEqual(payload.mimeType, "image/png");
      assert.strictEqual(typeof payload.sizeBytes, "number");
    }),
  );

  it.effect("rejects a non-image MIME type when ingesting via dataUrl", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-attach-badmime");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "BadMimeProject");
      const ticket = yield* ticketing.create({ projectId, title: "Bad MIME" });

      const exit = yield* Effect.exit(
        ticketing.createArtifact({
          ticketId: ticket.id,
          type: "image",
          payload: {
            dataUrl: "data:application/octet-stream;base64,AAAA",
            name: "file.bin",
            mimeType: "application/octet-stream",
          },
        }),
      );
      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.effect("stores figma_url and mermaid payloads verbatim (no ingest)", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-attach-other");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "OtherTypesProject");
      const ticket = yield* ticketing.create({ projectId, title: "Other artifact types" });

      const figma = yield* ticketing.createArtifact({
        ticketId: ticket.id,
        type: "figma_url",
        payload: { url: "https://figma.com/design/abc", nodeId: "1:2" },
      });
      const mermaid = yield* ticketing.createArtifact({
        ticketId: ticket.id,
        type: "mermaid",
        payload: { source: "graph TD; A-->B" },
      });

      assert.deepStrictEqual(figma.payload, {
        url: "https://figma.com/design/abc",
        nodeId: "1:2",
      });
      assert.deepStrictEqual(mermaid.payload, { source: "graph TD; A-->B" });
    }),
  );

  it.effect("updateArtifact changes the title and leaves payload untouched", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-attach-rename");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "RenameProject");
      const ticket = yield* ticketing.create({ projectId, title: "Rename target" });

      const figma = yield* ticketing.createArtifact({
        ticketId: ticket.id,
        type: "figma_url",
        title: "Original",
        payload: { url: "https://figma.com/design/xyz" },
      });

      const renamed = yield* ticketing.updateArtifact({
        id: figma.id,
        title: "Renamed",
      });
      assert.strictEqual(renamed.title, "Renamed");
      assert.deepStrictEqual(renamed.payload, { url: "https://figma.com/design/xyz" });

      // null clears the title
      const cleared = yield* ticketing.updateArtifact({ id: figma.id, title: null });
      assert.strictEqual(cleared.title, null);
    }),
  );

  it.effect("updateArtifact publishes an artifact_upserted stream event", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.makeUnsafe("project-attach-stream");
      const ticketing = yield* TicketingService;
      yield* seedProject(projectId, "StreamProject");
      const ticket = yield* ticketing.create({ projectId, title: "Stream target" });

      const figma = yield* ticketing.createArtifact({
        ticketId: ticket.id,
        type: "figma_url",
        title: "Before",
        payload: { url: "https://figma.com/design/s" },
      });

      const eventsFiber = yield* ticketing.streamEvents.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;

      yield* ticketing.updateArtifact({ id: figma.id, title: "After" });

      const collected = yield* Fiber.join(eventsFiber);
      const events = Array.from(collected);
      assert.strictEqual(events.length, 1);
      const first = events[0]!;
      assert.strictEqual(first.type, "artifact_upserted");
      if (first.type === "artifact_upserted") {
        assert.strictEqual(first.artifact.id, figma.id);
        assert.strictEqual(first.artifact.title, "After");
      }
    }),
  );
});
