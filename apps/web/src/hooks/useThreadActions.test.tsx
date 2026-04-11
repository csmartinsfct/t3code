import type { NativeApi, ThreadId, TurnId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { useTerminalStateStore } from "../terminalStateStore";
import type { Project, Thread } from "../types";
import { deleteThreadWithCascade } from "./useThreadActions";

function makeProject(): Project {
  return {
    id: "project-1" as Project["id"],
    name: "Project One",
    cwd: "/repo/project-one",
    defaultModelSelection: null,
    systemPrompt: null,
    promptOverrides: {} as Project["promptOverrides"],
    scripts: [],
  };
}

function makeThread(input: {
  id: string;
  title: string;
  updatedAt: string;
  isOrchestrationThread?: boolean;
  parentThreadId?: string | null;
  sessionStatus?: NonNullable<Thread["session"]>["status"] | null;
}): Thread {
  return {
    id: input.id as ThreadId,
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: input.title,
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session:
      input.sessionStatus === null
        ? null
        : {
            provider: "codex",
            status: input.sessionStatus ?? "closed",
            orchestrationStatus: input.sessionStatus === "closed" ? "stopped" : "running",
            createdAt: "2026-04-11T08:00:00.000Z",
            updatedAt: "2026-04-11T08:00:00.000Z",
            ...(input.sessionStatus === "running" ? { activeTurnId: "turn-1" as TurnId } : {}),
          },
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-11T08:00:00.000Z",
    archivedAt: null,
    updatedAt: input.updatedAt,
    latestTurn: null,
    pendingSourceProposedPlan: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    initialDraft: undefined,
    isOrchestrationThread: input.isOrchestrationThread ?? false,
    parentThreadId: input.parentThreadId ?? null,
    ticketId: null,
  };
}

describe("deleteThreadWithCascade", () => {
  beforeEach(() => {
    // Audit traceability: 3423f5b.
    const parentId = "thread-parent" as ThreadId;
    const childId = "thread-child-working" as ThreadId;

    useComposerDraftStore.setState({
      draftsByThreadId: {
        [parentId]: {
          prompt: "parent draft",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          codeSnippets: [],
          ticketAttachments: [],
          skills: [],
          modelSelectionByProvider: {},
          activeProvider: null,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
        [childId]: {
          prompt: "child draft",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          codeSnippets: [],
          ticketAttachments: [],
          skills: [],
          modelSelectionByProvider: {},
          activeProvider: null,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      },
      draftThreadsByThreadId: {
        [parentId]: {
          projectId: "project-1" as Project["id"],
          createdAt: "2026-04-11T08:00:00.000Z",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
        [childId]: {
          projectId: "project-1" as Project["id"],
          createdAt: "2026-04-11T08:00:00.000Z",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        ["project-1" as Project["id"]]: parentId,
      },
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });

    useTerminalStateStore.setState({
      terminalStateByThreadId: {
        [parentId]: {
          terminalOpen: true,
          terminalHeight: 420,
          terminalIds: ["default"],
          runningTerminalIds: ["default"],
          activeTerminalId: "default",
          terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
          activeTerminalGroupId: "group-default",
        },
        [childId]: {
          terminalOpen: true,
          terminalHeight: 360,
          terminalIds: ["default"],
          runningTerminalIds: ["default"],
          activeTerminalId: "default",
          terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
          activeTerminalGroupId: "group-default",
        },
      },
      terminalEventEntriesByKey: {
        "thread-parent\u0000default": [
          {
            id: 1,
            event: {
              kind: "stdout",
              threadId: parentId,
              terminalId: "default",
              data: "parent output",
            } as never,
          },
        ],
        "thread-child-working\u0000default": [
          {
            id: 2,
            event: {
              kind: "stdout",
              threadId: childId,
              terminalId: "default",
              data: "child output",
            } as never,
          },
        ],
      },
      nextTerminalEventId: 3,
    });
  });

  it("cascades orchestration-parent deletion through active runs, child cleanup, and fallback navigation", async () => {
    const dispatchCommandSpy = vi.fn(async () => undefined);
    const closeTerminalSpy = vi.fn(async () => undefined);
    const listRunsSpy = vi.fn(async () => [
      {
        id: "run-1",
        orchestrationThreadId: "thread-parent",
        status: "running",
      },
    ]);
    const cancelRunSpy = vi.fn(async () => undefined);
    const navigateSpy = vi.fn(async () => undefined);
    const removeWorktreeSpy = vi.fn(async () => undefined);

    const parentThread = makeThread({
      id: "thread-parent",
      title: "Parent orchestration",
      updatedAt: "2026-04-11T08:02:00.000Z",
      isOrchestrationThread: true,
      sessionStatus: "running",
    });
    const childWorkingThread = makeThread({
      id: "thread-child-working",
      title: "Child working",
      updatedAt: "2026-04-11T08:01:30.000Z",
      parentThreadId: "thread-parent",
      sessionStatus: "running",
    });
    const childClosedThread = makeThread({
      id: "thread-child-closed",
      title: "Child closed",
      updatedAt: "2026-04-11T08:01:00.000Z",
      parentThreadId: "thread-parent",
      sessionStatus: "closed",
    });
    const siblingThread = makeThread({
      id: "thread-sibling",
      title: "Sibling",
      updatedAt: "2026-04-11T08:03:00.000Z",
      sessionStatus: "closed",
    });
    const threads = [parentThread, childWorkingThread, childClosedThread, siblingThread];

    await deleteThreadWithCascade({
      api: {
        orchestration: {
          dispatchCommand: dispatchCommandSpy,
        },
        terminal: {
          close: closeTerminalSpy,
        },
        dialogs: {
          confirm: vi.fn(async () => false),
        },
      } as unknown as NativeApi,
      rpc: {
        listRuns: listRunsSpy as never,
        cancelRun: cancelRunSpy as never,
      },
      projects: [makeProject()],
      threads,
      threadsById: Object.fromEntries(threads.map((thread) => [thread.id, thread])),
      threadId: "thread-parent" as ThreadId,
      routeThreadId: "thread-parent" as ThreadId,
      sortOrder: "updated_at",
      navigate: navigateSpy,
      removeWorktree: removeWorktreeSpy,
      clearComposerDraftForThread: useComposerDraftStore.getState().clearDraftThread,
      clearProjectDraftThreadById: useComposerDraftStore.getState().clearProjectDraftThreadById,
      clearTerminalState: useTerminalStateStore.getState().clearTerminalState,
    });

    expect(listRunsSpy).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(cancelRunSpy).toHaveBeenCalledWith({ runId: "run-1" });

    expect(dispatchCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.session.stop",
        threadId: "thread-child-working",
      }),
    );
    expect(dispatchCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.delete",
        threadId: "thread-child-working",
      }),
    );
    expect(dispatchCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.delete",
        threadId: "thread-child-closed",
      }),
    );
    expect(dispatchCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.session.stop",
        threadId: "thread-parent",
      }),
    );
    expect(dispatchCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.delete",
        threadId: "thread-parent",
      }),
    );

    expect(closeTerminalSpy).toHaveBeenCalledWith({
      threadId: "thread-child-working",
      deleteHistory: true,
    });
    expect(closeTerminalSpy).toHaveBeenCalledWith({
      threadId: "thread-child-closed",
      deleteHistory: true,
    });
    expect(closeTerminalSpy).toHaveBeenCalledWith({
      threadId: "thread-parent",
      deleteHistory: true,
    });

    expect(
      useComposerDraftStore.getState().draftsByThreadId["thread-child-working" as ThreadId],
    ).toBeUndefined();
    expect(
      useComposerDraftStore.getState().draftsByThreadId["thread-parent" as ThreadId],
    ).toBeUndefined();
    expect(
      useComposerDraftStore.getState().projectDraftThreadIdByProjectId[
        "project-1" as Project["id"]
      ],
    ).toBeUndefined();

    expect(
      useTerminalStateStore.getState().terminalEventEntriesByKey[
        "thread-child-working\u0000default"
      ],
    ).toBeUndefined();
    expect(
      useTerminalStateStore.getState().terminalEventEntriesByKey["thread-parent\u0000default"],
    ).toBeUndefined();
    expect(
      useTerminalStateStore.getState().terminalStateByThreadId[
        "thread-child-working" as ThreadId
      ] ?? null,
    ).toSatisfy(
      (value) =>
        value === null ||
        (value.terminalOpen === false &&
          Array.isArray(value.runningTerminalIds) &&
          value.runningTerminalIds.length === 0),
    );
    expect(
      useTerminalStateStore.getState().terminalStateByThreadId["thread-parent" as ThreadId] ?? null,
    ).toSatisfy(
      (value) =>
        value === null ||
        (value.terminalOpen === false &&
          Array.isArray(value.runningTerminalIds) &&
          value.runningTerminalIds.length === 0),
    );

    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/$threadId",
      params: { threadId: "thread-sibling" },
      replace: true,
    });
    expect(removeWorktreeSpy).not.toHaveBeenCalled();
  });
});
