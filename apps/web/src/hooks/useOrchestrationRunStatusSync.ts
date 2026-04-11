import type {
  ThreadId,
  OrchestrationRunStatus,
  OrchestrationRunStreamEvent,
  ProjectId,
} from "@t3tools/contracts";
import { useEffect } from "react";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { getWsRpcClient } from "../wsRpcClient";

export function subscribeOrchestrationRunStatusSync(input: {
  projects: ReadonlyArray<{ id: ProjectId }>;
  removeStartupRecoveryState: (threadId: ThreadId) => void;
  onRunEvent: (
    projectId: ProjectId,
    listener: (event: OrchestrationRunStreamEvent) => void,
  ) => () => void;
}): () => void {
  if (input.projects.length === 0) {
    return () => undefined;
  }

  const unsubscribers = input.projects.map((project) =>
    input.onRunEvent(project.id, (event: OrchestrationRunStreamEvent) => {
      if (event.type === "snapshot") {
        const updates: Record<string, OrchestrationRunStatus> = {};
        for (const run of event.runs) {
          updates[run.orchestrationThreadId] = run.status;
        }
        useStore.setState((s) => ({
          orchestrationRunStatusByThreadId: {
            ...s.orchestrationRunStatusByThreadId,
            ...updates,
          },
        }));
      } else if (event.type === "run.created" || event.type === "run.updated") {
        useStore.setState((s) => ({
          orchestrationRunStatusByThreadId: {
            ...s.orchestrationRunStatusByThreadId,
            [event.run.orchestrationThreadId]: event.run.status,
          },
        }));
        input.removeStartupRecoveryState(event.run.orchestrationThreadId);
      }
    }),
  );

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}

/**
 * Subscribes to orchestration run events for all known projects and syncs
 * run statuses into the Zustand store's `orchestrationRunStatusByThreadId` map.
 *
 * Call this once at the Sidebar level so orchestration threads can show a
 * "Working" status pill even when the orchestrator session is idle between turns.
 */
export function useOrchestrationRunStatusSync(): void {
  const projects = useStore((s) => s.projects);
  const removeStartupRecoveryState = useUiStateStore((state) => state.removeStartupRecoveryState);

  useEffect(() => {
    const rpc = getWsRpcClient();
    return subscribeOrchestrationRunStatusSync({
      projects: projects.map((project) => ({ id: project.id as ProjectId })),
      removeStartupRecoveryState,
      onRunEvent: rpc.orchestration.onRunEvent,
    });
  }, [projects, removeStartupRecoveryState]);
}
