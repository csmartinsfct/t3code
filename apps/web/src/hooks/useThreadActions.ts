import type { NativeApi } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

import { getFallbackThreadIdAfterDelete } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "./useHandleNewThread";
import { gitRemoveWorktreeMutationOptions } from "../lib/gitReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { toastManager } from "../components/ui/toast";
import { logWebTimeline, warnWebTimeline } from "../timelineLogger";
import { useSettings } from "./useSettings";
import { getWsRpcClient, type WsRpcClient } from "../wsRpcClient";
import type { Project, Thread } from "../types";

interface DeleteThreadWithCascadeInput {
  api: NativeApi;
  rpc: Pick<WsRpcClient["orchestration"], "listRuns" | "cancelRun">;
  projects: Project[];
  threads: Thread[];
  threadsById: Record<string, Thread>;
  threadId: ThreadId;
  routeThreadId: ThreadId | null;
  sortOrder: ReturnType<typeof useSettings>["sidebarThreadSortOrder"];
  navigate: (input: {
    to: "/" | "/$threadId";
    params?: { threadId: ThreadId };
    replace?: boolean;
  }) => Promise<unknown>;
  removeWorktree: (input: { cwd: string; path: string; force: boolean }) => Promise<unknown>;
  clearComposerDraftForThread: (threadId: ThreadId) => void;
  clearProjectDraftThreadById: (projectId: Thread["projectId"], threadId: ThreadId) => void;
  clearTerminalState: (threadId: ThreadId) => void;
}

export async function deleteThreadWithCascade(
  input: DeleteThreadWithCascadeInput,
  opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {},
): Promise<void> {
  const {
    api,
    clearComposerDraftForThread,
    clearProjectDraftThreadById,
    clearTerminalState,
    navigate,
    projects,
    removeWorktree,
    routeThreadId,
    rpc,
    sortOrder,
    threadId,
    threads,
    threadsById,
  } = input;
  const thread = threadsById[threadId];
  if (!thread) return;

  const threadProject = projects.find((project) => project.id === thread.projectId);
  const deletedIds = opts.deletedThreadIds;
  const survivingThreads =
    deletedIds && deletedIds.size > 0
      ? threads.filter((entry) => entry.id === threadId || !deletedIds.has(entry.id))
      : threads;
  const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
  const displayWorktreePath = orphanedWorktreePath
    ? formatWorktreePathForDisplay(orphanedWorktreePath)
    : null;
  const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
  const shouldDeleteWorktree =
    canDeleteWorktree &&
    (await api.dialogs.confirm(
      [
        "This thread is the only one linked to this worktree:",
        displayWorktreePath ?? orphanedWorktreePath,
        "",
        "Delete the worktree too?",
      ].join("\n"),
    ));
  const cascadedDeletedThreadIds = new Set<ThreadId>();

  if (thread.isOrchestrationThread) {
    logWebTimeline("orchestration.delete.cascade.start", {
      threadId,
      projectId: thread.projectId,
    });
    try {
      const runs = await rpc.listRuns({ projectId: thread.projectId });
      const activeRun = runs.find(
        (r) =>
          r.orchestrationThreadId === threadId &&
          (r.status === "running" || r.status === "paused" || r.status === "pending"),
      );
      if (activeRun) {
        logWebTimeline("orchestration.delete.cancel-run", {
          threadId,
          runId: activeRun.id,
          runStatus: activeRun.status,
        });
        await rpc.cancelRun({ runId: activeRun.id }).catch(() => undefined);
      }
    } catch {
      warnWebTimeline("orchestration.delete.cancel-run.error", { threadId });
    }

    const childThreads = threads.filter((entry) => entry.parentThreadId === threadId);
    childThreads.forEach((child) => cascadedDeletedThreadIds.add(child.id));
    logWebTimeline("orchestration.delete.child-threads", {
      threadId,
      childCount: childThreads.length,
    });
    await Promise.allSettled(
      childThreads.map(async (child) => {
        if (child.session && child.session.status !== "closed") {
          await api.orchestration
            .dispatchCommand({
              type: "thread.session.stop",
              commandId: newCommandId(),
              threadId: child.id,
              createdAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        }
        try {
          await api.terminal.close({ threadId: child.id, deleteHistory: true });
        } catch {
          // Terminal may already be closed.
        }
        await api.orchestration.dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: child.id,
        });
        clearComposerDraftForThread(child.id);
        clearProjectDraftThreadById(child.projectId, child.id);
        clearTerminalState(child.id);
      }),
    );
  }

  if (thread.session && thread.session.status !== "closed") {
    await api.orchestration
      .dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  try {
    await api.terminal.close({ threadId, deleteHistory: true });
  } catch {
    // Terminal may already be closed.
  }

  const shouldNavigateToFallback = routeThreadId === threadId;
  const deletedThreadIdsForFallback = new Set<ThreadId>([
    ...(deletedIds ?? []),
    ...cascadedDeletedThreadIds,
  ]);
  const fallbackThreadId = getFallbackThreadIdAfterDelete({
    threads,
    deletedThreadId: threadId,
    sortOrder,
    deletedThreadIds: deletedThreadIdsForFallback,
  });
  await api.orchestration.dispatchCommand({
    type: "thread.delete",
    commandId: newCommandId(),
    threadId,
  });
  clearComposerDraftForThread(threadId);
  clearProjectDraftThreadById(thread.projectId, thread.id);
  clearTerminalState(threadId);

  if (shouldNavigateToFallback) {
    if (fallbackThreadId) {
      await navigate({
        to: "/$threadId",
        params: { threadId: fallbackThreadId },
        replace: true,
      });
    } else {
      await navigate({ to: "/", replace: true });
    }
  }

  if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
    return;
  }

  try {
    await removeWorktree({
      cwd: threadProject.cwd,
      path: orphanedWorktreePath,
      force: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
    console.error("Failed to remove orphaned worktree after thread deletion", {
      threadId,
      projectCwd: threadProject.cwd,
      worktreePath: orphanedWorktreePath,
      error,
    });
    toastManager.add({
      type: "error",
      title: "Thread deleted, but worktree removal failed",
      description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
    });
  }
}

export function useThreadActions() {
  const appSettings = useSettings();
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));

  const archiveThread = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = useStore.getState().threadsById[threadId];
      if (!thread) return;
      if (thread.session?.status === "running" && thread.session.activeTurnId != null) {
        throw new Error("Cannot archive a running thread.");
      }

      await api.orchestration.dispatchCommand({
        type: "thread.archive",
        commandId: newCommandId(),
        threadId,
      });

      if (routeThreadId === threadId) {
        await handleNewThread(thread.projectId);
      }
    },
    [handleNewThread, routeThreadId],
  );

  const unarchiveThread = useCallback(async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId,
    });
  }, []);

  const deleteThread = useCallback(
    async (threadId: ThreadId, opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {}) => {
      const api = readNativeApi();
      if (!api) return;
      const { projects, threads, threadsById } = useStore.getState();
      await deleteThreadWithCascade(
        {
          api,
          rpc: getWsRpcClient().orchestration,
          projects,
          threads,
          threadsById,
          threadId,
          routeThreadId,
          sortOrder: appSettings.sidebarThreadSortOrder,
          navigate,
          removeWorktree: (input) => removeWorktreeMutation.mutateAsync(input),
          clearComposerDraftForThread,
          clearProjectDraftThreadById,
          clearTerminalState,
        },
        opts,
      );
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      appSettings.sidebarThreadSortOrder,
      navigate,
      removeWorktreeMutation,
      routeThreadId,
    ],
  );

  const confirmAndDeleteThread = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = useStore.getState().threadsById[threadId];
      if (!thread) return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }

      await deleteThread(threadId);
    },
    [appSettings.confirmThreadDelete, deleteThread],
  );

  const deleteThreadBatch = useCallback(
    async (threadIds: ReadonlyArray<ThreadId>) => {
      const api = readNativeApi();
      if (!api || threadIds.length === 0) return;

      const { projects, threads, threadsById } = useStore.getState();
      const deletedIdSet = new Set<ThreadId>(threadIds);
      const survivingThreads = threads.filter((entry) => !deletedIdSet.has(entry.id));
      // Pre-compute orphaned worktrees and ask once
      const orphanedWorktrees: Array<{
        threadId: ThreadId;
        path: string;
        projectCwd: string;
      }> = [];
      for (const id of threadIds) {
        const thread = threadsById[id];
        if (!thread) continue;
        const threadsRemainingAfterBatchDelete = [thread, ...survivingThreads];
        const orphanedPath = getOrphanedWorktreePathForThread(threadsRemainingAfterBatchDelete, id);
        if (!orphanedPath) continue;
        const project = projects.find((p) => p.id === thread.projectId);
        if (project) {
          orphanedWorktrees.push({
            threadId: id,
            path: orphanedPath,
            projectCwd: project.cwd,
          });
        }
      }

      let shouldDeleteWorktrees = false;
      if (orphanedWorktrees.length > 0) {
        const paths = orphanedWorktrees.map((w) => formatWorktreePathForDisplay(w.path) ?? w.path);
        shouldDeleteWorktrees = await api.dialogs.confirm(
          [
            `${orphanedWorktrees.length} orphaned worktree${orphanedWorktrees.length === 1 ? "" : "s"} will be left behind:`,
            ...paths.map((p) => `  ${p}`),
            "",
            "Delete them too?",
          ].join("\n"),
        );
      }

      // Cancel any active orchestration runs for orchestration parent threads
      const orchestrationParents = threadIds.filter((id) => threadsById[id]?.isOrchestrationThread);
      if (orchestrationParents.length > 0) {
        logWebTimeline("orchestration.delete-batch.cascade.start", {
          orchestrationParentCount: orchestrationParents.length,
        });
        const rpc = getWsRpcClient();
        await Promise.allSettled(
          orchestrationParents.map(async (id) => {
            const thread = threadsById[id];
            if (!thread) return;
            try {
              const runs = await rpc.orchestration.listRuns({ projectId: thread.projectId });
              const activeRun = runs.find(
                (r) =>
                  r.orchestrationThreadId === id &&
                  (r.status === "running" || r.status === "paused" || r.status === "pending"),
              );
              if (activeRun) {
                logWebTimeline("orchestration.delete-batch.cancel-run", {
                  threadId: id,
                  runId: activeRun.id,
                  runStatus: activeRun.status,
                });
                await rpc.orchestration.cancelRun({ runId: activeRun.id }).catch(() => undefined);
              }
            } catch {
              // Best effort
              warnWebTimeline("orchestration.delete-batch.cancel-run.error", { threadId: id });
            }

            // Delete child threads not already in the batch
            const childThreads = threads.filter(
              (t) => t.parentThreadId === id && !deletedIdSet.has(t.id),
            );
            await Promise.allSettled(
              childThreads.map(async (child) => {
                if (child.session && child.session.status !== "closed") {
                  await api.orchestration
                    .dispatchCommand({
                      type: "thread.session.stop",
                      commandId: newCommandId(),
                      threadId: child.id,
                      createdAt: new Date().toISOString(),
                    })
                    .catch(() => undefined);
                }
                try {
                  await api.terminal.close({ threadId: child.id, deleteHistory: true });
                } catch {
                  // Terminal may already be closed.
                }
                await api.orchestration.dispatchCommand({
                  type: "thread.delete",
                  commandId: newCommandId(),
                  threadId: child.id,
                });
                clearComposerDraftForThread(child.id);
                clearProjectDraftThreadById(child.projectId, child.id);
                clearTerminalState(child.id);
              }),
            );
          }),
        );
      }

      // Fire all thread deletions in parallel
      await Promise.allSettled(
        threadIds.map(async (id) => {
          const thread = threadsById[id];
          if (!thread) return;

          if (thread.session && thread.session.status !== "closed") {
            await api.orchestration
              .dispatchCommand({
                type: "thread.session.stop",
                commandId: newCommandId(),
                threadId: id,
                createdAt: new Date().toISOString(),
              })
              .catch(() => undefined);
          }

          try {
            await api.terminal.close({ threadId: id, deleteHistory: true });
          } catch {
            // Terminal may already be closed.
          }

          await api.orchestration.dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: id,
          });

          clearComposerDraftForThread(id);
          clearProjectDraftThreadById(thread.projectId, id);
          clearTerminalState(id);
        }),
      );

      // Navigate once if the current route thread was among deleted
      if (routeThreadId && deletedIdSet.has(routeThreadId)) {
        const fallbackThreadId = getFallbackThreadIdAfterDelete({
          threads,
          deletedThreadId: routeThreadId,
          deletedThreadIds: deletedIdSet,
          sortOrder: appSettings.sidebarThreadSortOrder,
        });
        if (fallbackThreadId) {
          await navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          await navigate({ to: "/", replace: true });
        }
      }

      // Batch worktree removal
      if (shouldDeleteWorktrees && orphanedWorktrees.length > 0) {
        await Promise.allSettled(
          orphanedWorktrees.map(async ({ path, projectCwd }) => {
            try {
              await removeWorktreeMutation.mutateAsync({
                cwd: projectCwd,
                path,
                force: true,
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Unknown error removing worktree.";
              console.error("Failed to remove orphaned worktree after batch deletion", {
                path,
                projectCwd,
                error,
              });
              toastManager.add({
                type: "error",
                title: "Worktree removal failed",
                description: `Could not remove ${formatWorktreePathForDisplay(path) ?? path}. ${message}`,
              });
            }
          }),
        );
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      appSettings.sidebarThreadSortOrder,
      navigate,
      removeWorktreeMutation,
      routeThreadId,
    ],
  );

  return {
    archiveThread,
    unarchiveThread,
    deleteThread,
    deleteThreadBatch,
    confirmAndDeleteThread,
  };
}
