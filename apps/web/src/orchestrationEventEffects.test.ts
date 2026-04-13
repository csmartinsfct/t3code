import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveOrchestrationBatchEffects,
  deriveStartupRecoveryClearThreadIds,
} from "./orchestrationEventEffects";

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId:
      "threadId" in payload
        ? payload.threadId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.makeUnsafe("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

describe("deriveOrchestrationBatchEffects", () => {
  it("targets draft promotion and terminal cleanup from thread lifecycle events", () => {
    const createdThreadId = ThreadId.makeUnsafe("thread-created");
    const deletedThreadId = ThreadId.makeUnsafe("thread-deleted");
    const archivedThreadId = ThreadId.makeUnsafe("thread-archived");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.created", {
        threadId: createdThreadId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Created thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
      }),
      makeEvent("thread.deleted", {
        threadId: deletedThreadId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.archived", {
        threadId: archivedThreadId,
        archivedAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    expect(effects.clearPromotedDraftThreadIds).toEqual([createdThreadId]);
    expect(effects.clearDeletedThreadIds).toEqual([deletedThreadId]);
    expect(effects.removeTerminalStateThreadIds).toEqual([deletedThreadId, archivedThreadId]);
    expect(effects.needsProviderInvalidation).toBe(false);
  });

  it("keeps only the final lifecycle outcome for a thread within one batch", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.deleted", {
        threadId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.created", {
        threadId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Recreated thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
      makeEvent("thread.turn-diff-completed", {
        threadId,
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant-1"),
        completedAt: "2026-02-27T00:00:03.000Z",
      }),
    ]);

    expect(effects.clearPromotedDraftThreadIds).toEqual([threadId]);
    expect(effects.clearDeletedThreadIds).toEqual([]);
    expect(effects.removeTerminalStateThreadIds).toEqual([]);
    expect(effects.needsProviderInvalidation).toBe(true);
  });

  it("collects interaction mode syncs from thread.interaction-mode-set events", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.interaction-mode-set", {
        threadId,
        interactionMode: "default",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    ]);

    expect(effects.syncInteractionModes).toEqual([{ threadId, interactionMode: "default" }]);
  });

  it("does not retain archive cleanup when a thread is unarchived later in the same batch", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.archived", {
        threadId,
        archivedAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.unarchived", {
        threadId,
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    expect(effects.clearPromotedDraftThreadIds).toEqual([]);
    expect(effects.clearDeletedThreadIds).toEqual([]);
    expect(effects.removeTerminalStateThreadIds).toEqual([]);
  });
});

describe("deriveStartupRecoveryClearThreadIds", () => {
  it("clears startup recovery markers when a thread starts live work again", () => {
    const parentThreadId = ThreadId.makeUnsafe("thread-parent");
    const childThreadId = ThreadId.makeUnsafe("thread-child");

    expect(
      deriveStartupRecoveryClearThreadIds({
        events: [
          makeEvent("thread.turn-start-requested", {
            threadId: childThreadId,
            messageId: MessageId.makeUnsafe("message-1"),
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: "2026-02-27T00:00:00.000Z",
          }),
        ],
        threadsById: {
          [parentThreadId]: { id: parentThreadId, parentThreadId: null },
          [childThreadId]: { id: childThreadId, parentThreadId },
        },
      }),
    ).toEqual([childThreadId, parentThreadId]);
  });

  it("clears startup recovery markers when a running session is re-established", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    expect(
      deriveStartupRecoveryClearThreadIds({
        events: [
          makeEvent("thread.session-set", {
            threadId,
            session: {
              threadId,
              providerName: "codex",
              runtimeMode: "full-access",
              status: "running",
              activeTurnId: TurnId.makeUnsafe("turn-1"),
              lastError: null,
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          }),
        ],
        threadsById: {
          [threadId]: { id: threadId, parentThreadId: null },
        },
      }),
    ).toEqual([threadId]);
  });

  it("ignores non-live session updates", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    expect(
      deriveStartupRecoveryClearThreadIds({
        events: [
          makeEvent("thread.session-set", {
            threadId,
            session: {
              threadId,
              providerName: "codex",
              runtimeMode: "full-access",
              status: "ready",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          }),
        ],
        threadsById: {
          [threadId]: { id: threadId, parentThreadId: null },
        },
      }),
    ).toEqual([]);
  });
});
