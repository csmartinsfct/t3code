import type {
  OrchestrationRunId,
  OrchestrationRunStatus,
  OrchestrationRunStreamEvent,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStore } from "~/store";
import { useUiStateStore } from "~/uiStateStore";

import { subscribeOrchestrationRunStatusSync } from "./useOrchestrationRunStatusSync";

// Audit traceability: c6cb176, caeb52a, eb37ddb.

const PROJECT_ALPHA = "project-alpha" as ProjectId;
const PROJECT_BETA = "project-beta" as ProjectId;
const THREAD_ALPHA = "thread-alpha" as ThreadId;
const THREAD_BETA = "thread-beta" as ThreadId;
const THREAD_LIVE = "thread-live" as ThreadId;

function asRunId(id: string): OrchestrationRunId {
  return id as unknown as OrchestrationRunId;
}

describe("subscribeOrchestrationRunStatusSync", () => {
  beforeEach(() => {
    useStore.setState({
      projects: [],
      threads: [],
      threadsById: {},
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: true,
      orchestrationRunStatusByThreadId: {},
    });
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
      startupRecoveryStateByThreadId: {
        [THREAD_LIVE]: "active",
      },
      boardContextByThreadId: {},
      managementLastProjectId: null,
      viewMode: "chat",
    });
  });

  it("merges snapshot statuses and clears startup recovery on live updates", () => {
    const listeners = new Map<ProjectId, (event: OrchestrationRunStreamEvent) => void>();
    const removeStartupRecoveryState = useUiStateStore.getState().removeStartupRecoveryState;
    const unsubscribe = subscribeOrchestrationRunStatusSync({
      projects: [{ id: PROJECT_ALPHA }, { id: PROJECT_BETA }],
      removeStartupRecoveryState,
      onRunEvent: (projectId, listener) => {
        listeners.set(projectId, listener);
        return vi.fn();
      },
    });

    expect(listeners.size).toBe(2);

    listeners.get(PROJECT_ALPHA)?.({
      type: "snapshot",
      projectId: PROJECT_ALPHA,
      runs: [
        {
          id: asRunId("run-alpha-1"),
          orchestrationThreadId: THREAD_ALPHA,
          projectId: PROJECT_ALPHA,
          status: "pending" as OrchestrationRunStatus,
          currentTicketIndex: 0,
          ticketCount: 0,
          currentPhase: "working",
          createdAt: "2026-04-11T12:00:00.000Z",
          updatedAt: "2026-04-11T12:00:00.000Z",
        },
        {
          id: asRunId("run-alpha-2"),
          orchestrationThreadId: THREAD_BETA,
          projectId: PROJECT_ALPHA,
          status: "running" as OrchestrationRunStatus,
          currentTicketIndex: 0,
          ticketCount: 0,
          currentPhase: "working",
          createdAt: "2026-04-11T12:00:00.000Z",
          updatedAt: "2026-04-11T12:00:00.000Z",
        },
      ],
    });

    expect(useStore.getState().orchestrationRunStatusByThreadId).toEqual({
      [THREAD_ALPHA]: "pending",
      [THREAD_BETA]: "running",
    });

    listeners.get(PROJECT_BETA)?.({
      type: "run.updated",
      projectId: PROJECT_BETA,
      run: {
        id: asRunId("run-live"),
        orchestrationThreadId: THREAD_LIVE,
        projectId: PROJECT_BETA,
        status: "running" as OrchestrationRunStatus,
        ticketOrder: [],
        currentTicketIndex: 0,
        currentPhase: "working",
        reviewIteration: 0,
        maxReviewIterations: 0,
        createdAt: "2026-04-11T12:00:00.000Z",
        updatedAt: "2026-04-11T12:00:00.000Z",
      },
    });

    expect(useStore.getState().orchestrationRunStatusByThreadId).toMatchObject({
      [THREAD_ALPHA]: "pending",
      [THREAD_BETA]: "running",
      [THREAD_LIVE]: "running",
    });
    expect(useUiStateStore.getState().startupRecoveryStateByThreadId[THREAD_LIVE]).toBeUndefined();

    unsubscribe();
  });

  it("returns a cleanup function that unsubscribes every project stream", () => {
    const unsubscribeAlpha = vi.fn();
    const unsubscribeBeta = vi.fn();

    const unsubscribe = subscribeOrchestrationRunStatusSync({
      projects: [{ id: PROJECT_ALPHA }, { id: PROJECT_BETA }],
      removeStartupRecoveryState: vi.fn(),
      onRunEvent: (projectId) => (projectId === PROJECT_ALPHA ? unsubscribeAlpha : unsubscribeBeta),
    });

    unsubscribe();

    expect(unsubscribeAlpha).toHaveBeenCalledTimes(1);
    expect(unsubscribeBeta).toHaveBeenCalledTimes(1);
  });
});
