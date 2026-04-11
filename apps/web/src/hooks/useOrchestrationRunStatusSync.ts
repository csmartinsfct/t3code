import type {
  OrchestrationRunStatus,
  OrchestrationRunStreamEvent,
  ProjectId,
} from "@t3tools/contracts";
import { useEffect } from "react";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { getWsRpcClient } from "../wsRpcClient";

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
    if (projects.length === 0) return;

    const rpc = getWsRpcClient();

    const unsubscribers = projects.map((project) =>
      rpc.orchestration.onRunEvent(
        project.id as ProjectId,
        (event: OrchestrationRunStreamEvent) => {
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
            removeStartupRecoveryState(event.run.orchestrationThreadId);
          }
        },
      ),
    );

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [projects, removeStartupRecoveryState]);
}
