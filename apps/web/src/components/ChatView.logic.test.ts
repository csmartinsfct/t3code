import { ProjectId, ThreadId, TicketId, TurnId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import type { Thread } from "../types";

import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildTicketLinkCacheKey,
  buildExpiredTerminalContextToastCopy,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  openTicketLinkInThread,
  reconcileMountedTerminalThreadIds,
  shouldAdvanceLiveClock,
  waitForStartedServerThread,
} from "./ChatView.logic";

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("openTicketLinkInThread", () => {
  it("opens board mode and pushes the resolved ticket", async () => {
    const setViewMode = vi.fn();
    const pushThreadBoardTicket = vi.fn();
    const getTicketByIdentifier = vi.fn(async () => ({ id: TicketId.makeUnsafe("ticket-1") }));

    await openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      resolvedTicketIdCache: new Map(),
      inFlightTicketResolutions: new Map(),
      getTicketByIdentifier,
      getBoardContext: () => null,
      setViewMode,
      pushThreadBoardTicket,
      showErrorToast: vi.fn(),
    });

    expect(getTicketByIdentifier).toHaveBeenCalledWith({
      identifier: "T3CO-191",
      projectId: ProjectId.makeUnsafe("project-1"),
    });
    expect(setViewMode).toHaveBeenCalledWith("management");
    expect(pushThreadBoardTicket).toHaveBeenCalledWith(
      ThreadId.makeUnsafe("thread-1"),
      ProjectId.makeUnsafe("project-1"),
      TicketId.makeUnsafe("ticket-1"),
    );
  });

  it("reuses in-flight resolutions for concurrent clicks", async () => {
    let resolveTicket!: (value: { id: TicketId }) => void;
    const resolution = new Promise<{ id: TicketId }>((resolve) => {
      resolveTicket = resolve;
    });
    const getTicketByIdentifier = vi.fn(() => resolution);
    const setViewMode = vi.fn();
    const pushThreadBoardTicket = vi.fn();
    const resolvedTicketIdCache = new Map<string, TicketId>();
    const inFlightTicketResolutions = new Map<string, Promise<TicketId>>();

    const first = openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      resolvedTicketIdCache,
      inFlightTicketResolutions,
      getTicketByIdentifier,
      getBoardContext: () => null,
      setViewMode,
      pushThreadBoardTicket,
      showErrorToast: vi.fn(),
    });
    const second = openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      resolvedTicketIdCache,
      inFlightTicketResolutions,
      getTicketByIdentifier,
      getBoardContext: () => null,
      setViewMode,
      pushThreadBoardTicket,
      showErrorToast: vi.fn(),
    });

    expect(getTicketByIdentifier).toHaveBeenCalledTimes(1);
    resolveTicket({ id: TicketId.makeUnsafe("ticket-1") });
    await Promise.all([first, second]);

    expect(pushThreadBoardTicket).toHaveBeenCalledTimes(2);
    expect(inFlightTicketResolutions.size).toBe(0);
  });

  it("uses the resolved cache on later clicks", async () => {
    const getTicketByIdentifier = vi.fn(async () => ({ id: TicketId.makeUnsafe("ticket-1") }));
    const resolvedTicketIdCache = new Map<string, TicketId>([
      [
        buildTicketLinkCacheKey(ProjectId.makeUnsafe("project-1"), "T3CO-191"),
        TicketId.makeUnsafe("ticket-1"),
      ],
    ]);
    const pushThreadBoardTicket = vi.fn();

    await openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      resolvedTicketIdCache,
      inFlightTicketResolutions: new Map(),
      getTicketByIdentifier,
      getBoardContext: () => null,
      setViewMode: vi.fn(),
      pushThreadBoardTicket,
      showErrorToast: vi.fn(),
    });

    expect(getTicketByIdentifier).not.toHaveBeenCalled();
    expect(pushThreadBoardTicket).toHaveBeenCalledTimes(1);
  });

  it("does not push a duplicate when the ticket is already on top of the board stack", async () => {
    const pushThreadBoardTicket = vi.fn();
    const setViewMode = vi.fn();

    await openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      resolvedTicketIdCache: new Map([
        [
          buildTicketLinkCacheKey(ProjectId.makeUnsafe("project-1"), "T3CO-191"),
          TicketId.makeUnsafe("ticket-1"),
        ],
      ]),
      inFlightTicketResolutions: new Map(),
      getTicketByIdentifier: vi.fn(),
      getBoardContext: () => ({
        projectId: ProjectId.makeUnsafe("project-1"),
        ticketStack: [TicketId.makeUnsafe("ticket-1")],
        boardScrollLeft: 0,
        updatedAt: "2026-04-11T12:00:00.000Z",
      }),
      setViewMode,
      pushThreadBoardTicket,
      showErrorToast: vi.fn(),
    });

    expect(setViewMode).toHaveBeenCalledWith("management");
    expect(pushThreadBoardTicket).not.toHaveBeenCalled();
  });

  it("shows a toast and stops when the thread has no project context", async () => {
    const showErrorToast = vi.fn();
    const getTicketByIdentifier = vi.fn();

    await openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: null,
      resolvedTicketIdCache: new Map(),
      inFlightTicketResolutions: new Map(),
      getTicketByIdentifier,
      getBoardContext: () => null,
      setViewMode: vi.fn(),
      pushThreadBoardTicket: vi.fn(),
      showErrorToast,
    });

    expect(showErrorToast).toHaveBeenCalledWith({
      title: "Ticket links only work in project threads",
    });
    expect(getTicketByIdentifier).not.toHaveBeenCalled();
  });

  it("shows a fallback toast when resolution fails", async () => {
    const showErrorToast = vi.fn();

    await openTicketLinkInThread({
      identifier: "T3CO-191",
      threadId: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      resolvedTicketIdCache: new Map(),
      inFlightTicketResolutions: new Map(),
      getTicketByIdentifier: vi.fn(async () => {
        throw new Error("No matching ticket");
      }),
      getBoardContext: () => null,
      setViewMode: vi.fn(),
      pushThreadBoardTicket: vi.fn(),
      showErrorToast,
    });

    expect(showErrorToast).toHaveBeenCalledWith({
      title: "Could not open ticket T3CO-191",
      description: "No matching ticket",
    });
  });
});

describe("reconcileMountedTerminalThreadIds", () => {
  it("keeps previously mounted open threads and adds the active open thread", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [
          ThreadId.makeUnsafe("thread-hidden"),
          ThreadId.makeUnsafe("thread-stale"),
        ],
        openThreadIds: [ThreadId.makeUnsafe("thread-hidden"), ThreadId.makeUnsafe("thread-active")],
        activeThreadId: ThreadId.makeUnsafe("thread-active"),
        activeThreadTerminalOpen: true,
      }),
    ).toEqual([ThreadId.makeUnsafe("thread-hidden"), ThreadId.makeUnsafe("thread-active")]);
  });

  it("drops mounted threads once their terminal drawer is no longer open", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [ThreadId.makeUnsafe("thread-closed")],
        openThreadIds: [],
        activeThreadId: ThreadId.makeUnsafe("thread-closed"),
        activeThreadTerminalOpen: false,
      }),
    ).toEqual([]);
  });

  it("keeps only the most recently active hidden terminal threads", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [
          ThreadId.makeUnsafe("thread-1"),
          ThreadId.makeUnsafe("thread-2"),
          ThreadId.makeUnsafe("thread-3"),
        ],
        openThreadIds: [
          ThreadId.makeUnsafe("thread-1"),
          ThreadId.makeUnsafe("thread-2"),
          ThreadId.makeUnsafe("thread-3"),
          ThreadId.makeUnsafe("thread-4"),
        ],
        activeThreadId: ThreadId.makeUnsafe("thread-4"),
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-4"),
    ]);
  });

  it("moves the active thread to the end so it is treated as most recently used", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [
          ThreadId.makeUnsafe("thread-a"),
          ThreadId.makeUnsafe("thread-b"),
          ThreadId.makeUnsafe("thread-c"),
        ],
        openThreadIds: [
          ThreadId.makeUnsafe("thread-a"),
          ThreadId.makeUnsafe("thread-b"),
          ThreadId.makeUnsafe("thread-c"),
        ],
        activeThreadId: ThreadId.makeUnsafe("thread-a"),
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual([
      ThreadId.makeUnsafe("thread-b"),
      ThreadId.makeUnsafe("thread-c"),
      ThreadId.makeUnsafe("thread-a"),
    ]);
  });

  it("defaults to the hidden mounted terminal cap", () => {
    const currentThreadIds = Array.from(
      { length: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS + 2 },
      (_, index) => ThreadId.makeUnsafe(`thread-${index + 1}`),
    );

    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: currentThreadIds,
        activeThreadId: null,
        activeThreadTerminalOpen: false,
      }),
    ).toEqual(currentThreadIds.slice(-MAX_HIDDEN_MOUNTED_TERMINAL_THREADS));
  });
});

describe("shouldAdvanceLiveClock", () => {
  it("ticks while the UI still considers work active", () => {
    expect(
      shouldAdvanceLiveClock({
        isWorking: true,
        timelineEntries: [],
      }),
    ).toBe(true);
  });

  it("ticks for streaming assistant output even if the session phase already drifted idle", () => {
    expect(
      shouldAdvanceLiveClock({
        isWorking: false,
        timelineEntries: [
          {
            kind: "message",
            message: {
              role: "assistant",
              streaming: true,
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("stops ticking once no live work or streaming output remains", () => {
    expect(
      shouldAdvanceLiveClock({
        isWorking: false,
        timelineEntries: [
          {
            kind: "message",
            message: {
              role: "assistant",
              streaming: false,
            },
          },
          {
            kind: "work",
          },
        ],
      }),
    ).toBe(false);
  });
});

const makeThread = (input?: {
  id?: ThreadId;
  latestTurn?: {
    turnId: TurnId;
    state: "running" | "completed";
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}) => ({
  id: input?.id ?? ThreadId.makeUnsafe("thread-1"),
  codexThreadId: null,
  projectId: ProjectId.makeUnsafe("project-1"),
  title: "Thread",
  modelSelection: { provider: "codex" as const, model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  session: null,
  messages: [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-03-29T00:00:00.000Z",
  archivedAt: null,
  updatedAt: "2026-03-29T00:00:00.000Z",
  latestTurn: input?.latestTurn
    ? {
        ...input.latestTurn,
        assistantMessageId: null,
      }
    : null,
  branch: null,
  worktreePath: null,
  turnDiffSummaries: [],
  activities: [],
  isOrchestrationThread: false,
  parentThreadId: null,
  ticketId: null,
});

function threadState(threads: Thread[]) {
  const threadsById: Record<string, Thread> = {};
  for (const t of threads) threadsById[t.id] = t;
  return { threads, threadsById };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useStore.setState((state) => ({
    ...state,
    projects: [],
    ...threadState([]),
    bootstrapComplete: true,
  }));
});

describe("waitForStartedServerThread", () => {
  it("resolves immediately when the thread is already started", async () => {
    const threadId = ThreadId.makeUnsafe("thread-started");
    useStore.setState((state) => ({
      ...state,
      ...threadState([
        makeThread({
          id: threadId,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-started"),
            state: "running",
            requestedAt: "2026-03-29T00:00:01.000Z",
            startedAt: "2026-03-29T00:00:01.000Z",
            completedAt: null,
          },
        }),
      ]),
    }));

    await expect(waitForStartedServerThread(threadId)).resolves.toBe(true);
  });

  it("waits for the thread to start via subscription updates", async () => {
    const threadId = ThreadId.makeUnsafe("thread-wait");
    useStore.setState((state) => ({
      ...state,
      ...threadState([makeThread({ id: threadId })]),
    }));

    const promise = waitForStartedServerThread(threadId, 500);

    useStore.setState((state) => ({
      ...state,
      ...threadState([
        makeThread({
          id: threadId,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-started"),
            state: "running",
            requestedAt: "2026-03-29T00:00:01.000Z",
            startedAt: "2026-03-29T00:00:01.000Z",
            completedAt: null,
          },
        }),
      ]),
    }));

    await expect(promise).resolves.toBe(true);
  });

  it("handles the thread starting between the initial read and subscription setup", async () => {
    const threadId = ThreadId.makeUnsafe("thread-race");
    useStore.setState((state) => ({
      ...state,
      ...threadState([makeThread({ id: threadId })]),
    }));

    const originalSubscribe = useStore.subscribe.bind(useStore);
    let raced = false;
    vi.spyOn(useStore, "subscribe").mockImplementation((listener) => {
      if (!raced) {
        raced = true;
        useStore.setState((state) => ({
          ...state,
          ...threadState([
            makeThread({
              id: threadId,
              latestTurn: {
                turnId: TurnId.makeUnsafe("turn-race"),
                state: "running",
                requestedAt: "2026-03-29T00:00:01.000Z",
                startedAt: "2026-03-29T00:00:01.000Z",
                completedAt: null,
              },
            }),
          ]),
        }));
      }
      return originalSubscribe(listener);
    });

    await expect(waitForStartedServerThread(threadId, 500)).resolves.toBe(true);
  });

  it("returns false after the timeout when the thread never starts", async () => {
    vi.useFakeTimers();

    const threadId = ThreadId.makeUnsafe("thread-timeout");
    useStore.setState((state) => ({
      ...state,
      ...threadState([makeThread({ id: threadId })]),
    }));
    const promise = waitForStartedServerThread(threadId, 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const projectId = ProjectId.makeUnsafe("project-1");
  const previousLatestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-03-29T00:00:00.000Z",
    startedAt: "2026-03-29T00:00:01.000Z",
    completedAt: "2026-03-29T00:00:10.000Z",
    assistantMessageId: null,
  };

  const previousSession = {
    provider: "codex" as const,
    status: "ready" as const,
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:10.000Z",
    orchestrationStatus: "idle" as const,
  };

  it("does not clear local dispatch before server state changes", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.makeUnsafe("thread-1"),
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
      isOrchestrationThread: false,
      parentThreadId: null,
      ticketId: null,
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: previousSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch when a new turn is already settled", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.makeUnsafe("thread-1"),
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
      isOrchestrationThread: false,
      parentThreadId: null,
      ticketId: null,
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.makeUnsafe("turn-2"),
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: "2026-03-29T00:01:30.000Z",
        },
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:01:30.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears local dispatch when the session changes without an observed running phase", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.makeUnsafe("thread-1"),
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
      isOrchestrationThread: false,
      parentThreadId: null,
      ticketId: null,
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:00:11.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });
});
