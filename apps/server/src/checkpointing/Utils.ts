import { Encoding } from "effect";
import {
  CheckpointRef,
  type GitDiscoveredRepo,
  ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

export const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.makeUnsafe(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}): string | undefined {
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}

/**
 * Resolve the list of git repository cwds that should be checkpointed for a
 * given thread. For worktree threads, returns a single cwd. For multi-repo
 * projects, returns one cwd per discovered repo. Falls back to the project
 * workspace root when no repos are discovered.
 */
export function resolveThreadWorkspaceCwds(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
  readonly discoveredRepos: ReadonlyArray<GitDiscoveredRepo>;
}): string[] {
  // Worktree threads are always single-repo
  if (input.thread.worktreePath) {
    return [input.thread.worktreePath];
  }

  // If repos are discovered, use them
  if (input.discoveredRepos.length > 0) {
    return input.discoveredRepos.map((r) => r.cwd);
  }

  // Fallback: treat project workspace root as a single repo
  const workspaceRoot = input.projects.find(
    (project) => project.id === input.thread.projectId,
  )?.workspaceRoot;
  return workspaceRoot ? [workspaceRoot] : [];
}
