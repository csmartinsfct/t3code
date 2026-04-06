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
import { useSettings } from "./useSettings";

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

      const deletedThreadIds = opts.deletedThreadIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads,
        deletedThreadId: threadId,
        deletedThreadIds,
        sortOrder: appSettings.sidebarThreadSortOrder,
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
        await removeWorktreeMutation.mutateAsync({
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
        const orphanedPath = getOrphanedWorktreePathForThread(survivingThreads, id);
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
        const remainingThreads = useStore.getState().threads;
        const fallbackThreadId = getFallbackThreadIdAfterDelete({
          threads: remainingThreads,
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
