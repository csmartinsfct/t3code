import { ProjectId, ThreadId, TicketId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  cloneThreadBoardContext,
  clearThreadUi,
  initializeThreadBoardContextFromSource,
  markThreadUnread,
  popThreadBoardTicket,
  pushThreadBoardTicket,
  reorderProjects,
  sanitizeThreadBoardContext,
  setManagementLastProjectId,
  setProjectExpanded,
  setThreadBoardRoot,
  setThreadBoardScrollLeft,
  syncProjects,
  syncThreads,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    threadLastVisitedAtById: {},
    boardContextByThreadId: {},
    managementLastProjectId: null,
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

    const next = markThreadUnread(initialState, threadId, null);

    expect(next).toBe(initialState);
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

  it("syncProjects preserves manual order when a project is recreated with the same cwd", () => {
    const oldProject1 = ProjectId.makeUnsafe("project-1");
    const oldProject2 = ProjectId.makeUnsafe("project-2");
    const recreatedProject2 = ProjectId.makeUnsafe("project-2b");
    const initialState = syncProjects(
      makeUiState({
        projectExpandedById: {
          [oldProject1]: true,
          [oldProject2]: false,
        },
        projectOrder: [oldProject2, oldProject1],
      }),
      [
        { id: oldProject1, cwd: "/tmp/project-1" },
        { id: oldProject2, cwd: "/tmp/project-2" },
      ],
    );

    const next = syncProjects(initialState, [
      { id: oldProject1, cwd: "/tmp/project-1" },
      { id: recreatedProject2, cwd: "/tmp/project-2" },
    ]);

    expect(next.projectOrder).toEqual([recreatedProject2, oldProject1]);
    expect(next.projectExpandedById[recreatedProject2]).toBe(false);
  });

  it("syncProjects returns a new state when only project cwd changes", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = syncProjects(
      makeUiState({
        projectExpandedById: {
          [project1]: false,
        },
        projectOrder: [project1],
      }),
      [{ id: project1, cwd: "/tmp/project-1" }],
    );

    const next = syncProjects(initialState, [{ id: project1, cwd: "/tmp/project-1-renamed" }]);

    expect(next).not.toBe(initialState);
    expect(next.projectOrder).toEqual([project1]);
    expect(next.projectExpandedById[project1]).toBe(false);
  });

  it("syncThreads prunes missing thread UI state", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const thread2 = ThreadId.makeUnsafe("thread-2");
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
        [thread2]: "2026-02-25T12:36:00.000Z",
      },
      boardContextByThreadId: {
        [thread1]: {
          projectId: project1,
          ticketStack: [ticket1],
          boardScrollLeft: 120,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
        [thread2]: {
          projectId: project1,
          ticketStack: [],
          boardScrollLeft: 0,
          updatedAt: "2026-02-25T12:36:00.000Z",
        },
      },
    });

    const next = syncThreads(initialState, [{ id: thread1 }]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
    expect(next.boardContextByThreadId).toEqual({
      [thread1]: {
        projectId: project1,
        ticketStack: [ticket1],
        boardScrollLeft: 120,
        updatedAt: "2026-02-25T12:35:00.000Z",
      },
    });
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

  it("clearThreadUi removes visit state for deleted threads", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
      },
      boardContextByThreadId: {
        [thread1]: {
          projectId: project1,
          ticketStack: [],
          boardScrollLeft: 48,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
      },
    });

    const next = clearThreadUi(initialState, thread1);

    expect(next.threadLastVisitedAtById).toEqual({});
    expect(next.boardContextByThreadId).toEqual({});
  });

  it("setThreadBoardRoot initializes board context for a thread", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");

    const next = setThreadBoardRoot(makeUiState(), thread1, project1);

    expect(next.boardContextByThreadId[thread1]).toMatchObject({
      projectId: project1,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("pushThreadBoardTicket appends ticket detail state for the active thread", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const ticket2 = TicketId.makeUnsafe("ticket-2");
    const initialState = setThreadBoardRoot(makeUiState(), thread1, project1);

    const next = pushThreadBoardTicket(
      pushThreadBoardTicket(initialState, thread1, project1, ticket1),
      thread1,
      project1,
      ticket2,
    );

    expect(next.boardContextByThreadId[thread1]?.ticketStack).toEqual([ticket1, ticket2]);
  });

  it("popThreadBoardTicket returns to the previous ticket in the stack", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const ticket2 = TicketId.makeUnsafe("ticket-2");
    const initialState = pushThreadBoardTicket(
      pushThreadBoardTicket(
        setThreadBoardRoot(makeUiState(), thread1, project1),
        thread1,
        project1,
        ticket1,
      ),
      thread1,
      project1,
      ticket2,
    );

    const next = popThreadBoardTicket(initialState, thread1);

    expect(next.boardContextByThreadId[thread1]?.ticketStack).toEqual([ticket1]);
  });

  it("sanitizeThreadBoardContext removes tickets that no longer belong to the active project", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const invalidTicket = TicketId.makeUnsafe("ticket-2");
    const initialState = makeUiState({
      boardContextByThreadId: {
        [thread1]: {
          projectId: project1,
          ticketStack: [ticket1, invalidTicket],
          boardScrollLeft: 32,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
      },
    });

    const next = sanitizeThreadBoardContext(initialState, thread1, project1, new Set([ticket1]));

    expect(next.boardContextByThreadId[thread1]).toMatchObject({
      projectId: project1,
      ticketStack: [ticket1],
      boardScrollLeft: 32,
    });
  });

  it("sanitizeThreadBoardContext resets mismatched projects to board root", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const initialState = makeUiState({
      boardContextByThreadId: {
        [thread1]: {
          projectId: project1,
          ticketStack: [ticket1],
          boardScrollLeft: 32,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
      },
    });

    const next = sanitizeThreadBoardContext(initialState, thread1, project2, new Set());

    expect(next.boardContextByThreadId[thread1]).toMatchObject({
      projectId: project2,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("cloneThreadBoardContext copies stack and scroll for same-project contexts", () => {
    const sourceThreadId = ThreadId.makeUnsafe("thread-source");
    const targetThreadId = ThreadId.makeUnsafe("thread-target");
    const project1 = ProjectId.makeUnsafe("project-1");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const ticket2 = TicketId.makeUnsafe("ticket-2");
    const initialState = makeUiState({
      boardContextByThreadId: {
        [sourceThreadId]: {
          projectId: project1,
          ticketStack: [ticket1, ticket2],
          boardScrollLeft: 96,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
      },
    });

    const next = cloneThreadBoardContext(initialState, sourceThreadId, targetThreadId, project1);

    expect(next.boardContextByThreadId[targetThreadId]).toMatchObject({
      projectId: project1,
      ticketStack: [ticket1, ticket2],
      boardScrollLeft: 96,
    });
    expect(next.boardContextByThreadId[targetThreadId]?.ticketStack).not.toBe(
      initialState.boardContextByThreadId[sourceThreadId]?.ticketStack,
    );
  });

  it("cloneThreadBoardContext falls back to board root when source has no context", () => {
    const sourceThreadId = ThreadId.makeUnsafe("thread-source");
    const targetThreadId = ThreadId.makeUnsafe("thread-target");
    const project1 = ProjectId.makeUnsafe("project-1");

    const next = cloneThreadBoardContext(makeUiState(), sourceThreadId, targetThreadId, project1);

    expect(next.boardContextByThreadId[targetThreadId]).toMatchObject({
      projectId: project1,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("cloneThreadBoardContext falls back to board root when source project mismatches", () => {
    const sourceThreadId = ThreadId.makeUnsafe("thread-source");
    const targetThreadId = ThreadId.makeUnsafe("thread-target");
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const ticket1 = TicketId.makeUnsafe("ticket-1");
    const initialState = makeUiState({
      boardContextByThreadId: {
        [sourceThreadId]: {
          projectId: project1,
          ticketStack: [ticket1],
          boardScrollLeft: 80,
          updatedAt: "2026-02-25T12:35:00.000Z",
        },
      },
    });

    const next = cloneThreadBoardContext(initialState, sourceThreadId, targetThreadId, project2);

    expect(next.boardContextByThreadId[targetThreadId]).toMatchObject({
      projectId: project2,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("initializeThreadBoardContextFromSource falls back to root when source is null", () => {
    const targetThreadId = ThreadId.makeUnsafe("thread-target");
    const project1 = ProjectId.makeUnsafe("project-1");

    const next = initializeThreadBoardContextFromSource(makeUiState(), {
      sourceThreadId: null,
      targetThreadId,
      projectId: project1,
    });

    expect(next.boardContextByThreadId[targetThreadId]).toMatchObject({
      projectId: project1,
      ticketStack: [],
      boardScrollLeft: 0,
    });
  });

  it("setThreadBoardScrollLeft preserves root board scroll per thread", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = setThreadBoardRoot(makeUiState(), thread1, project1);

    const next = setThreadBoardScrollLeft(initialState, thread1, 240);

    expect(next.boardContextByThreadId[thread1]?.boardScrollLeft).toBe(240);
  });

  it("syncProjects remaps the last management project by cwd when recreated", () => {
    const oldProject1 = ProjectId.makeUnsafe("project-1");
    const recreatedProject1 = ProjectId.makeUnsafe("project-1b");
    const initialState = syncProjects(setManagementLastProjectId(makeUiState(), oldProject1), [
      { id: oldProject1, cwd: "/tmp/project-1" },
    ]);

    const next = syncProjects(initialState, [{ id: recreatedProject1, cwd: "/tmp/project-1" }]);

    expect(next.managementLastProjectId).toBe(recreatedProject1);
  });
});
