import {
  CheckpointRef,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationStartupSnapshot,
  type OrchestrationThreadContent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  reconcileThreadContentCache,
  syncServerReadModel,
  syncThreadContent,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    isOrchestrationThread: false,
    parentThreadId: null,
    ticketId: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  const threadIdsByProjectId: AppState["threadIdsByProjectId"] = {
    [thread.projectId]: [thread.id],
  };
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        systemPrompt: null,
        promptOverrides: { orchestration: {} },
        scripts: [],
      },
    ],
    threads: [thread],
    threadsById: { [thread.id]: thread },
    sidebarThreadsById: {},
    threadIdsByProjectId,
    bootstrapComplete: true,
    orchestrationRunStatusByThreadId: {},
  };
}

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

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    parentThreadId: null,
    isOrchestrationThread: false,
    ticketId: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        nameHidden: false,
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
        },
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        systemPrompt: null,
        promptOverrides: { orchestration: {} },
        scripts: [],
      },
    ],
    threads: [thread],
  };
}

function makeStartupSnapshotThread(
  overrides: Partial<OrchestrationStartupSnapshot["threads"][number]>,
): OrchestrationStartupSnapshot["threads"][number] {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    parentThreadId: null,
    isOrchestrationThread: false,
    ticketId: null,
    latestTurn: null,
    latestTurnStatus: null,
    latestSessionStatus: null,
    session: null,
    latestUserActivity: null,
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    actionablePlanState: null,
    lastActivitySummary: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeStartupSnapshot(
  thread: OrchestrationStartupSnapshot["threads"][number],
): OrchestrationStartupSnapshot {
  return {
    ...makeReadModel(makeReadModelThread({})),
    threads: [thread],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    nameHidden: false,
    workspaceRoot: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    systemPrompt: null,
    promptOverrides: { orchestration: {} },
    scripts: [],
    ...overrides,
  };
}

describe("store read model sync", () => {
  it("marks bootstrap complete after snapshot sync", () => {
    const initialState: AppState = {
      ...makeState(makeThread()),
      bootstrapComplete: false,
    };

    const next = syncServerReadModel(initialState, makeReadModel(makeReadModelThread({})));

    expect(next.bootstrapComplete).toBe(true);
  });

  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-8",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-opus-4-8");
  });

  it("repairs provider/model mismatches from older Gemini fork commands", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          profileId: "metric",
          model: "gemini-2.5-pro",
          options: { effort: "max" },
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
    });
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          model: "sonnet",
        },
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-sonnet-5");
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });

  it("maps and updates project name visibility", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(makeReadModelThread({}));
    const synced = syncServerReadModel(initialState, {
      ...readModel,
      projects: [makeReadModelProject({ nameHidden: true })],
    });

    expect(synced.projects[0]?.nameHidden).toBe(true);

    const next = applyOrchestrationEvents(synced, [
      makeEvent("project.meta-updated", {
        projectId: ProjectId.makeUnsafe("project-1"),
        nameHidden: false,
        updatedAt: "2026-02-27T00:10:00.000Z",
      }),
    ]);
    expect(next.projects[0]?.nameHidden).toBe(false);
  });

  it("maps archivedAt from the read model", () => {
    const initialState = makeState(makeThread());
    const archivedAt = "2026-02-28T00:00:00.000Z";
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          archivedAt,
        }),
      ),
    );

    expect(next.threads[0]?.archivedAt).toBe(archivedAt);
  });

  it("represents shallow startup threads with unloaded message content and explicit summary fields", () => {
    const initialState = makeState(makeThread());
    const latestTurn = {
      turnId: TurnId.makeUnsafe("turn-1"),
      state: "completed" as const,
      requestedAt: "2026-02-27T00:01:00.000Z",
      startedAt: "2026-02-27T00:01:01.000Z",
      completedAt: "2026-02-27T00:02:00.000Z",
      assistantMessageId: MessageId.makeUnsafe("assistant-1"),
    };
    const next = syncServerReadModel(
      initialState,
      makeStartupSnapshot(
        makeStartupSnapshotThread({
          latestTurn,
          latestTurnStatus: "completed",
          latestUserActivity: {
            messageId: MessageId.makeUnsafe("user-1"),
            createdAt: "2026-02-27T00:01:00.000Z",
          },
          pendingApprovalCount: 1,
          pendingUserInputCount: 1,
          actionablePlanState: {
            id: "plan-1" as never,
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:01:30.000Z",
            updatedAt: "2026-02-27T00:01:30.000Z",
          },
        }),
      ),
    );

    expect(next.threads[0]?.messages).toBe("not-loaded");
    expect(next.sidebarThreadsById["thread-1"]).toMatchObject({
      latestUserMessageAt: "2026-02-27T00:01:00.000Z",
      hasPendingApprovals: true,
      hasPendingUserInput: true,
      hasActionableProposedPlan: true,
      latestTurn,
    });
  });

  it("keeps metadata updates on unloaded threads without fabricating empty conversations", () => {
    const initialState = syncServerReadModel(
      makeState(makeThread()),
      makeStartupSnapshot(
        makeStartupSnapshotThread({
          latestUserActivity: {
            messageId: MessageId.makeUnsafe("user-1"),
            createdAt: "2026-02-27T00:01:00.000Z",
          },
        }),
      ),
    );

    const next = applyOrchestrationEvent(
      initialState,
      makeEvent("thread.meta-updated", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "Renamed thread",
        updatedAt: "2026-02-27T00:03:00.000Z",
      }),
    );

    expect(next.threads[0]?.messages).toBe("not-loaded");
    expect(next.sidebarThreadsById["thread-1"]).toMatchObject({
      title: "Renamed thread",
      latestUserMessageAt: "2026-02-27T00:01:00.000Z",
    });
  });

  it("updates unloaded thread message summaries without materializing messages", () => {
    const initialState = syncServerReadModel(
      makeState(makeThread()),
      makeStartupSnapshot(
        makeStartupSnapshotThread({
          latestUserActivity: {
            messageId: MessageId.makeUnsafe("user-1"),
            createdAt: "2026-02-27T00:01:00.000Z",
          },
        }),
      ),
    );

    const afterUserMessage = applyOrchestrationEvent(
      initialState,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("user-2"),
        role: "user",
        text: "newer user message",
        turnId: TurnId.makeUnsafe("turn-2"),
        streaming: false,
        createdAt: "2026-02-27T00:05:00.000Z",
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    expect(afterUserMessage.threads[0]?.messages).toBe("not-loaded");
    expect(afterUserMessage.threads[0]?.latestUserMessageAt).toBe("2026-02-27T00:05:00.000Z");
    expect(afterUserMessage.sidebarThreadsById["thread-1"]?.latestUserMessageAt).toBe(
      "2026-02-27T00:05:00.000Z",
    );

    const afterAssistantMessage = applyOrchestrationEvent(
      initialState,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("assistant-1"),
        role: "assistant",
        text: "assistant response",
        turnId: TurnId.makeUnsafe("turn-2"),
        streaming: false,
        createdAt: "2026-02-27T00:06:00.000Z",
        updatedAt: "2026-02-27T00:06:00.000Z",
      }),
    );

    expect(afterAssistantMessage.threads[0]?.messages).toBe("not-loaded");
    expect(afterAssistantMessage.threads[0]?.latestUserMessageAt).toBe("2026-02-27T00:01:00.000Z");
    expect(afterAssistantMessage.sidebarThreadsById["thread-1"]?.latestUserMessageAt).toBe(
      "2026-02-27T00:01:00.000Z",
    );
  });

  it("hydrates unloaded thread content into loaded arrays and recomputes summaries", () => {
    const initialState = syncServerReadModel(
      makeState(makeThread()),
      makeStartupSnapshot(makeStartupSnapshotThread({})),
    );
    const content: OrchestrationThreadContent = {
      threadId: ThreadId.makeUnsafe("thread-1"),
      sequence: 2,
      messages: [
        {
          id: MessageId.makeUnsafe("user-1"),
          role: "user",
          text: "hello",
          attachments: [],
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-27T00:04:00.000Z",
          updatedAt: "2026-02-27T00:04:00.000Z",
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    };

    const next = syncThreadContent(initialState, content);

    expect(Array.isArray(next.threads[0]?.messages)).toBe(true);
    expect(next.sidebarThreadsById["thread-1"]?.latestUserMessageAt).toBe(
      "2026-02-27T00:04:00.000Z",
    );
  });

  it("reconciles live events that arrive while unloaded content is hydrating", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const initialState = syncServerReadModel(
      makeState(makeThread()),
      makeStartupSnapshot(makeStartupSnapshotThread({ id: threadId })),
    );
    const withPendingEvent = applyOrchestrationEvent(
      initialState,
      makeEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.makeUnsafe("assistant-live"),
          role: "assistant",
          text: "live update",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-27T00:05:00.000Z",
          updatedAt: "2026-02-27T00:05:00.000Z",
        },
        { sequence: 3 },
      ),
    );
    const hydrated = syncThreadContent(withPendingEvent, {
      threadId,
      sequence: 2,
      messages: [
        {
          id: MessageId.makeUnsafe("user-1"),
          role: "user",
          text: "hello",
          attachments: [],
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-27T00:04:00.000Z",
          updatedAt: "2026-02-27T00:04:00.000Z",
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });

    const messages = hydrated.threadsById[threadId]?.messages;
    expect(Array.isArray(messages) ? messages.map((message) => message.id) : []).toEqual([
      "user-1",
      "assistant-live",
    ]);
  });

  it("replays pending live events after an empty-sequence hydration snapshot", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const initialState = syncServerReadModel(
      makeState(makeThread()),
      makeStartupSnapshot(makeStartupSnapshotThread({ id: threadId })),
    );
    const withPendingEvent = applyOrchestrationEvent(
      initialState,
      makeEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.makeUnsafe("assistant-live"),
          role: "assistant",
          text: "live update",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-27T00:05:00.000Z",
          updatedAt: "2026-02-27T00:05:00.000Z",
        },
        { sequence: 1 },
      ),
    );
    const hydrated = syncThreadContent(withPendingEvent, {
      threadId,
      sequence: 0,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });

    const messages = hydrated.threadsById[threadId]?.messages;
    expect(Array.isArray(messages) ? messages.map((message) => message.id) : []).toEqual([
      "assistant-live",
    ]);
  });

  it("does not duplicate live events already included in hydrated content", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const initialState = syncServerReadModel(
      makeState(makeThread()),
      makeStartupSnapshot(makeStartupSnapshotThread({ id: threadId })),
    );
    const event = makeEvent(
      "thread.message-sent",
      {
        threadId,
        messageId: MessageId.makeUnsafe("assistant-live"),
        role: "assistant",
        text: "live update",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: false,
        createdAt: "2026-02-27T00:05:00.000Z",
        updatedAt: "2026-02-27T00:05:00.000Z",
      },
      { sequence: 3 },
    );
    const withPendingEvent = applyOrchestrationEvent(initialState, event);
    const hydrated = syncThreadContent(withPendingEvent, {
      threadId,
      sequence: 3,
      messages: [
        {
          id: event.payload.messageId,
          role: event.payload.role,
          text: event.payload.text,
          attachments: [],
          turnId: event.payload.turnId,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });

    const messages = hydrated.threadsById[threadId]?.messages;
    expect(Array.isArray(messages) ? messages.map((message) => message.id) : []).toEqual([
      "assistant-live",
    ]);
  });

  it("evicts least-recently used loaded content by byte budget while preserving pinned threads", () => {
    const firstThread = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      messages: [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "user",
          text: "x".repeat(200),
          turnId: TurnId.makeUnsafe("turn-1"),
          createdAt: "2026-02-27T00:00:00.000Z",
          streaming: false,
        },
      ],
    });
    const secondThread = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      messages: [
        {
          id: MessageId.makeUnsafe("message-2"),
          role: "user",
          text: "y".repeat(200),
          turnId: TurnId.makeUnsafe("turn-2"),
          createdAt: "2026-02-27T00:01:00.000Z",
          streaming: false,
        },
      ],
    });
    const state: AppState = {
      ...makeState(firstThread),
      threads: [firstThread, secondThread],
      threadsById: {
        [firstThread.id]: firstThread,
        [secondThread.id]: secondThread,
      },
      threadIdsByProjectId: {
        [firstThread.projectId]: [firstThread.id, secondThread.id],
      },
      threadContentCache: {
        [firstThread.id]: {
          sizeBytes: 1_000,
          loadedSequence: 1,
          lastAccessedAt: 1,
          pendingEvents: [],
        },
        [secondThread.id]: {
          sizeBytes: 1_000,
          loadedSequence: 1,
          lastAccessedAt: 2,
          pendingEvents: [],
        },
      },
    };

    const next = reconcileThreadContentCache(state, {
      focusedThreadId: secondThread.id,
      visibleThreadIds: [secondThread.id],
      maxBytes: 1_000,
      now: 10,
    });

    expect(next.threadsById[firstThread.id]?.messages).toBe("not-loaded");
    expect(Array.isArray(next.threadsById[secondThread.id]?.messages)).toBe(true);
  });

  it("projects recoverable ready-session lastError values into the thread error state", () => {
    const initialState = makeState(makeThread());
    const recoverableErrors = [
      "Agent reached the maximum number of turns. Send a follow-up to continue.",
      "Rate limited — wait a moment and try again.",
    ] as const;

    for (const lastError of recoverableErrors) {
      const next = syncServerReadModel(
        initialState,
        makeReadModel(
          makeReadModelThread({
            session: {
              threadId: ThreadId.makeUnsafe("thread-1"),
              status: "ready",
              providerName: "codex",
              runtimeMode: "approval-required",
              activeTurnId: null,
              lastError,
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          }),
        ),
      );

      expect(next.threads[0]?.session?.status).toBe("ready");
      expect(next.threads[0]?.error).toBe(lastError);
    }
  });

  it("replaces projects using snapshot order during recovery", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          scripts: [],
        },
      ],
      threads: [],
      threadsById: {},
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: true,
      orchestrationRunStatusByThreadId: {},
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project1, project2, project3]);
  });
});

describe("incremental orchestration updates", () => {
  it("does not mark bootstrap complete for incremental events", () => {
    const state: AppState = {
      ...makeState(makeThread()),
      bootstrapComplete: false,
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.meta-updated", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "Updated title",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.bootstrapComplete).toBe(false);
  });

  it("preserves state identity for no-op project and thread deletes", () => {
    const thread = makeThread();
    const state = makeState(thread);

    const nextAfterProjectDelete = applyOrchestrationEvent(
      state,
      makeEvent("project.deleted", {
        projectId: ProjectId.makeUnsafe("project-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
    );
    const nextAfterThreadDelete = applyOrchestrationEvent(
      state,
      makeEvent("thread.deleted", {
        threadId: ThreadId.makeUnsafe("thread-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(nextAfterProjectDelete).toBe(state);
    expect(nextAfterThreadDelete).toBe(state);
  });

  it("reuses an existing project row when project.created arrives with a new id for the same cwd", () => {
    const originalProjectId = ProjectId.makeUnsafe("project-1");
    const recreatedProjectId = ProjectId.makeUnsafe("project-2");
    const state: AppState = {
      projects: [
        {
          id: originalProjectId,
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          scripts: [],
        },
      ],
      threads: [],
      threadsById: {},
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: true,
      orchestrationRunStatusByThreadId: {},
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("project.created", {
        projectId: recreatedProjectId,
        title: "Project Recreated",
        nameHidden: false,
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        systemPrompt: null,
        promptOverrides: { orchestration: {} },
        scripts: [],
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.id).toBe(recreatedProjectId);
    expect(next.projects[0]?.cwd).toBe("/tmp/project");
    expect(next.projects[0]?.name).toBe("Project Recreated");
  });

  it("removes stale project index entries when thread.created recreates a thread under a new project", () => {
    const originalProjectId = ProjectId.makeUnsafe("project-1");
    const recreatedProjectId = ProjectId.makeUnsafe("project-2");
    const threadId = ThreadId.makeUnsafe("thread-1");
    const thread = makeThread({
      id: threadId,
      projectId: originalProjectId,
    });
    const state: AppState = {
      projects: [
        {
          id: originalProjectId,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          scripts: [],
        },
        {
          id: recreatedProjectId,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          scripts: [],
        },
      ],
      threads: [thread],
      threadsById: { [thread.id]: thread },
      sidebarThreadsById: {},
      threadIdsByProjectId: {
        [originalProjectId]: [threadId],
      },
      bootstrapComplete: true,
      orchestrationRunStatusByThreadId: {},
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.created", {
        threadId,
        projectId: recreatedProjectId,
        title: "Recovered thread",
        modelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.threads).toHaveLength(1);
    expect(next.threads[0]?.projectId).toBe(recreatedProjectId);
    expect(next.threadIdsByProjectId[originalProjectId]).toBeUndefined();
    expect(next.threadIdsByProjectId[recreatedProjectId]).toEqual([threadId]);
  });

  it("preserves initial drafts from live thread.created events", () => {
    const state: AppState = {
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          scripts: [],
        },
      ],
      threads: [],
      threadsById: {},
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: true,
      orchestrationRunStatusByThreadId: {},
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.created", {
        threadId: ThreadId.makeUnsafe("thread-scheduled"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Scheduled task",
        modelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        initialDraft: {
          prompt: "Run the morning status check",
          skillIds: ["debug"],
          autoSend: true,
        },
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.threadsById["thread-scheduled"]?.initialDraft).toEqual({
      prompt: "Run the morning status check",
      skillIds: ["debug"],
      autoSend: true,
    });
  });

  it("updates only the affected thread for message events", () => {
    const thread1 = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      messages: [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "hello",
          turnId: TurnId.makeUnsafe("turn-1"),
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:00.000Z",
          streaming: false,
        },
      ],
    });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2") });
    const state: AppState = {
      ...makeState(thread1),
      threads: [thread1, thread2],
      threadsById: { [thread1.id]: thread1, [thread2.id]: thread2 },
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: thread1.id,
        messageId: MessageId.makeUnsafe("message-1"),
        role: "assistant",
        text: " world",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: true,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    const messages = next.threads[0]?.messages;
    expect(Array.isArray(messages) ? messages[0]?.text : null).toBe("hello world");
    expect(next.threads[0]?.latestTurn?.state).toBe("running");
    expect(next.threads[1]).toBe(thread2);
  });

  it("applies replay batches in sequence and updates session state", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "running",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvents(state, [
      makeEvent(
        "thread.session-set",
        {
          threadId: thread.id,
          session: {
            threadId: thread.id,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.makeUnsafe("turn-1"),
            lastError: null,
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
        },
        { sequence: 2 },
      ),
      makeEvent(
        "thread.message-sent",
        {
          threadId: thread.id,
          messageId: MessageId.makeUnsafe("assistant-1"),
          role: "assistant",
          text: "done",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-27T00:00:03.000Z",
          updatedAt: "2026-02-27T00:00:03.000Z",
        },
        { sequence: 3 },
      ),
    ]);

    expect(next.threads[0]?.session?.status).toBe("running");
    expect(next.threads[0]?.latestTurn?.state).toBe("completed");
    expect(next.threads[0]?.messages).toHaveLength(1);
  });

  it("keeps recoverable ready-session updates visible in the thread error state", () => {
    const state = makeState(makeThread());

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.session-set", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "Rate limited — wait a moment and try again.",
          updatedAt: "2026-02-27T00:00:02.000Z",
        },
      }),
    );

    expect(next.threads[0]?.session?.status).toBe("ready");
    expect(next.threads[0]?.error).toBe("Rate limited — wait a moment and try again.");
  });

  it("maps message metadata from thread.message-sent events", () => {
    const state = makeState(makeThread());

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("message-with-metadata"),
        role: "user",
        text: "Continue.",
        metadata: {
          origin: {
            kind: "orchestration-prompt",
            promptId: "resume",
            phase: "working",
            dispatchMode: "resume",
          },
        },
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: false,
        createdAt: "2026-02-27T00:00:03.000Z",
        updatedAt: "2026-02-27T00:00:03.000Z",
      }),
    );

    expect(next.threads[0]?.messages[0]).toMatchObject({
      text: "Continue.",
      metadata: {
        origin: {
          kind: "orchestration-prompt",
          promptId: "resume",
          phase: "working",
          dispatchMode: "resume",
        },
      },
    });
  });

  it("does not regress latestTurn when an older turn diff completes late", () => {
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-2"),
          state: "running",
          requestedAt: "2026-02-27T00:00:02.000Z",
          startedAt: "2026-02-27T00:00:03.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-diff-completed", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant-1"),
        completedAt: "2026-02-27T00:00:04.000Z",
      }),
    );

    expect(next.threads[0]?.turnDiffSummaries).toHaveLength(1);
    expect(next.threads[0]?.latestTurn).toEqual(state.threads[0]?.latestTurn);
  });

  it("rebinds live turn diffs to the authoritative assistant message when it arrives later", () => {
    const turnId = TurnId.makeUnsafe("turn-1");
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId,
          state: "completed",
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:02.000Z",
          assistantMessageId: MessageId.makeUnsafe("assistant:turn-1"),
        },
        turnDiffSummaries: [
          {
            turnId,
            completedAt: "2026-02-27T00:00:02.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
            assistantMessageId: MessageId.makeUnsafe("assistant:turn-1"),
            files: [{ path: "src/app.ts", additions: 1, deletions: 0 }],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("assistant-real"),
        role: "assistant",
        text: "final answer",
        turnId,
        streaming: false,
        createdAt: "2026-02-27T00:00:03.000Z",
        updatedAt: "2026-02-27T00:00:03.000Z",
      }),
    );

    expect(next.threads[0]?.turnDiffSummaries[0]?.assistantMessageId).toBe(
      MessageId.makeUnsafe("assistant-real"),
    );
    expect(next.threads[0]?.latestTurn?.assistantMessageId).toBe(
      MessageId.makeUnsafe("assistant-real"),
    );
  });

  it("reverts messages, plans, activities, and checkpoints by retained turns", () => {
    const state = makeState(
      makeThread({
        messages: [
          {
            id: MessageId.makeUnsafe("user-1"),
            role: "user",
            text: "first",
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
            completedAt: "2026-02-27T00:00:00.000Z",
            streaming: false,
          },
          {
            id: MessageId.makeUnsafe("assistant-1"),
            role: "assistant",
            text: "first reply",
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:00:01.000Z",
            completedAt: "2026-02-27T00:00:01.000Z",
            streaming: false,
          },
          {
            id: MessageId.makeUnsafe("user-2"),
            role: "user",
            text: "second",
            turnId: TurnId.makeUnsafe("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
            completedAt: "2026-02-27T00:00:02.000Z",
            streaming: false,
          },
        ],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "plan 1",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: "plan-2",
            turnId: TurnId.makeUnsafe("turn-2"),
            planMarkdown: "plan 2",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-27T00:00:02.000Z",
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        activities: [
          {
            id: EventId.makeUnsafe("activity-1"),
            tone: "info",
            kind: "step",
            summary: "one",
            payload: {},
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: EventId.makeUnsafe("activity-2"),
            tone: "info",
            kind: "step",
            summary: "two",
            payload: {},
            turnId: TurnId.makeUnsafe("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        turnDiffSummaries: [
          {
            turnId: TurnId.makeUnsafe("turn-1"),
            completedAt: "2026-02-27T00:00:01.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.makeUnsafe("ref-1"),
            files: [],
          },
          {
            turnId: TurnId.makeUnsafe("turn-2"),
            completedAt: "2026-02-27T00:00:03.000Z",
            status: "ready",
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.makeUnsafe("ref-2"),
            files: [],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.reverted", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnCount: 1,
      }),
    );

    const messages = next.threads[0]?.messages;
    expect(Array.isArray(messages) ? messages.map((message) => message.id) : []).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(next.threads[0]?.proposedPlans.map((plan) => plan.id)).toEqual(["plan-1"]);
    expect(next.threads[0]?.activities.map((activity) => activity.id)).toEqual([
      EventId.makeUnsafe("activity-1"),
    ]);
    expect(next.threads[0]?.turnDiffSummaries.map((summary) => summary.turnId)).toEqual([
      TurnId.makeUnsafe("turn-1"),
    ]);
  });

  it("clears pending source proposed plans after revert before a new session-set event", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-2"),
        state: "completed",
        requestedAt: "2026-02-27T00:00:02.000Z",
        startedAt: "2026-02-27T00:00:02.000Z",
        completedAt: "2026-02-27T00:00:03.000Z",
        assistantMessageId: MessageId.makeUnsafe("assistant-2"),
        sourceProposedPlan: {
          threadId: ThreadId.makeUnsafe("thread-source"),
          planId: "plan-2" as never,
        },
      },
      pendingSourceProposedPlan: {
        threadId: ThreadId.makeUnsafe("thread-source"),
        planId: "plan-2" as never,
      },
      turnDiffSummaries: [
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          completedAt: "2026-02-27T00:00:01.000Z",
          status: "ready",
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("ref-1"),
          files: [],
        },
        {
          turnId: TurnId.makeUnsafe("turn-2"),
          completedAt: "2026-02-27T00:00:03.000Z",
          status: "ready",
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("ref-2"),
          files: [],
        },
      ],
    });
    const reverted = applyOrchestrationEvent(
      makeState(thread),
      makeEvent("thread.reverted", {
        threadId: thread.id,
        turnCount: 1,
      }),
    );

    expect(reverted.threads[0]?.pendingSourceProposedPlan).toBeUndefined();

    const next = applyOrchestrationEvent(
      reverted,
      makeEvent("thread.session-set", {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.makeUnsafe("turn-3"),
          lastError: null,
          updatedAt: "2026-02-27T00:00:04.000Z",
        },
      }),
    );

    expect(next.threads[0]?.latestTurn).toMatchObject({
      turnId: TurnId.makeUnsafe("turn-3"),
      state: "running",
    });
    expect(next.threads[0]?.latestTurn?.sourceProposedPlan).toBeUndefined();
  });
});
