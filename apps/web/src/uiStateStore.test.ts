import { ProjectId, ThreadId, TicketId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  clearStartupWasWorkingThread,
  clearThreadUi,
  markThreadUnread,
  popManagementBoardTicket,
  pushManagementBoardTicket,
  reorderProjects,
  removeStartupRecoveryState,
  sanitizeManagementBoardContext,
  setManagementBoardRoot,
  setManagementBoardScrollLeft,
  setProjectExpanded,
  setStartupWasWorkingThreads,
  syncProjects,
  syncThreads,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    threadLastVisitedAtById: {},
    startupRecoveryStateByThreadId: {},
    managementBoardContext: null,
    boardViewMode: "cards",
    boardFiltersByProjectId: {},
    viewMode: "chat",
    ...overrides,
  };
}

describe("uiStateStore pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, latestTurnCompletedAt);

    expect(next.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:29:59.999Z");
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    expect(markThreadUnread(initialState, threadId, null)).toBe(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState = makeUiState({
      projectOrder: [project1, project2, project3],
    });

    const next = reorderProjects(initialState, project1, project3);

    expect(next.projectOrder).toEqual([project2, project3, project1]);
  });

  it("syncProjects preserves current project order during snapshot recovery", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
        [project2]: false,
      },
      projectOrder: [project2, project1],
    });

    const next = syncProjects(initialState, [
      { id: project1, cwd: "/tmp/project-1" },
      { id: project2, cwd: "/tmp/project-2" },
      { id: project3, cwd: "/tmp/project-3" },
    ]);

    expect(next.projectOrder).toEqual([project2, project1, project3]);
    expect(next.projectExpandedById[project2]).toBe(false);
  });

  it("syncProjects remaps the global management board context by cwd when the project id changes", () => {
    const oldProjectId = ProjectId.makeUnsafe("project-1");
    const recreatedProjectId = ProjectId.makeUnsafe("project-1b");
    const ticketId = TicketId.makeUnsafe("ticket-1");
    const initialState = syncProjects(
      makeUiState({
        managementBoardContext: {
          projectId: oldProjectId,
          ticketStack: [ticketId],
          boardScrollLeft: 120,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
      }),
      [{ id: oldProjectId, cwd: "/tmp/project-1" }],
    );

    const next = syncProjects(initialState, [{ id: recreatedProjectId, cwd: "/tmp/project-1" }]);

    expect(next.managementBoardContext).toMatchObject({
      projectId: recreatedProjectId,
      ticketStack: [ticketId],
      boardScrollLeft: 120,
    });
  });

  it("syncThreads prunes missing thread ui state without touching board state", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const thread2 = ThreadId.makeUnsafe("thread-2");
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
        [thread2]: "2026-02-25T12:36:00.000Z",
      },
      startupRecoveryStateByThreadId: {
        [thread1]: "active",
        [thread2]: "dismissed",
      },
      managementBoardContext: {
        projectId: project1,
        ticketStack: [ticket1],
        boardScrollLeft: 120,
        updatedAt: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = syncThreads(initialState, [{ id: thread1 }]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
    expect(next.startupRecoveryStateByThreadId).toEqual({
      [thread1]: "active",
    });
    expect(next.managementBoardContext).toEqual(initialState.managementBoardContext);
  });

  it("syncThreads seeds visit state for unseen snapshot threads", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const initialState = makeUiState();

    const next = syncThreads(initialState, [
      {
        id: thread1,
        seedVisitedAt: "2026-02-25T12:35:00.000Z",
      },
    ]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
  });

  it("setProjectExpanded updates expansion without touching order", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
      },
      projectOrder: [project1],
    });

    const next = setProjectExpanded(initialState, project1, false);

    expect(next.projectExpandedById[project1]).toBe(false);
    expect(next.projectOrder).toEqual([project1]);
  });

  it("clearThreadUi removes visit state for deleted threads without clearing the board context", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
      },
      startupRecoveryStateByThreadId: {
        [thread1]: "active",
      },
      managementBoardContext: {
        projectId: project1,
        ticketStack: [],
        boardScrollLeft: 48,
        updatedAt: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = clearThreadUi(initialState, thread1);

    expect(next.threadLastVisitedAtById).toEqual({});
    expect(next.startupRecoveryStateByThreadId).toEqual({});
    expect(next.managementBoardContext).toEqual(initialState.managementBoardContext);
  });

  it("tracks startup Was working markers separately from persisted thread ui", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const thread2 = ThreadId.makeUnsafe("thread-2");
    const initialState = makeUiState();

    const seeded = setStartupWasWorkingThreads(initialState, [thread1, thread2]);
    expect(seeded.startupRecoveryStateByThreadId).toEqual({
      [thread1]: "active",
      [thread2]: "active",
    });

    const cleared = clearStartupWasWorkingThread(seeded, thread1);
    expect(cleared.startupRecoveryStateByThreadId).toEqual({
      [thread1]: "dismissed",
      [thread2]: "active",
    });

    const removed = removeStartupRecoveryState(cleared, thread1);
    expect(removed.startupRecoveryStateByThreadId).toEqual({
      [thread2]: "active",
    });
  });

  it("only dismisses startup recovery markers that were actually active", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const initialState = makeUiState();

    expect(clearStartupWasWorkingThread(initialState, thread1)).toBe(initialState);

    const dismissedState = makeUiState({
      startupRecoveryStateByThreadId: {
        [thread1]: "dismissed",
      },
    });
    expect(clearStartupWasWorkingThread(dismissedState, thread1)).toBe(dismissedState);
  });

  it("setManagementBoardRoot initializes the global board context", () => {
    const project1 = ProjectId.makeUnsafe("project-1");

    const next = setManagementBoardRoot(makeUiState(), project1);

    expect(next.managementBoardContext).toMatchObject({
      projectId: project1,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("pushManagementBoardTicket appends ticket detail state for the active project", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const ticket2 = TicketId.makeUnsafe("ticket-2");
    const initialState = setManagementBoardRoot(makeUiState(), project1);

    const next = pushManagementBoardTicket(
      pushManagementBoardTicket(initialState, project1, ticket1),
      project1,
      ticket2,
    );

    expect(next.managementBoardContext?.ticketStack).toEqual([ticket1, ticket2]);
  });

  it("popManagementBoardTicket returns to the previous ticket in the stack", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const ticket2 = TicketId.makeUnsafe("ticket-2");
    const initialState = pushManagementBoardTicket(
      pushManagementBoardTicket(setManagementBoardRoot(makeUiState(), project1), project1, ticket1),
      project1,
      ticket2,
    );

    const next = popManagementBoardTicket(initialState);

    expect(next.managementBoardContext?.ticketStack).toEqual([ticket1]);
  });

  it("sanitizeManagementBoardContext removes tickets that no longer belong to the active project", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const invalidTicket = TicketId.makeUnsafe("ticket-2");
    const initialState = makeUiState({
      managementBoardContext: {
        projectId: project1,
        ticketStack: [ticket1, invalidTicket],
        boardScrollLeft: 32,
        updatedAt: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = sanitizeManagementBoardContext(initialState, project1, new Set([ticket1]));

    expect(next.managementBoardContext).toMatchObject({
      projectId: project1,
      ticketStack: [ticket1],
      boardScrollLeft: 32,
    });
  });

  it("sanitizeManagementBoardContext resets mismatched projects to the board root", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const initialState = makeUiState({
      managementBoardContext: {
        projectId: project1,
        ticketStack: [ticket1],
        boardScrollLeft: 32,
        updatedAt: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = sanitizeManagementBoardContext(initialState, project2, new Set());

    expect(next.managementBoardContext).toMatchObject({
      projectId: project2,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("setManagementBoardScrollLeft preserves the root board scroll globally", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = setManagementBoardRoot(makeUiState(), project1);

    const next = setManagementBoardScrollLeft(initialState, 240);

    expect(next.managementBoardContext?.boardScrollLeft).toBe(240);
  });
});
