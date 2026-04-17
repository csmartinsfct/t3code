/**
 * ProjectionSnapshotQuery - Read-model snapshot query service interface.
 *
 * Exposes the current orchestration projection snapshot for read-only API
 * access.
 *
 * @module ProjectionSnapshotQuery
 */
import type {
  OrchestrationCheckpointSummary,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationStartupSnapshot,
  OrchestrationThreadContent,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Option } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionSnapshotCounts {
  readonly projectCount: number;
  readonly threadCount: number;
}

export interface ProjectionThreadSummary {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
}

export interface ProjectionThreadCheckpointContext {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly systemPrompt: string | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

/**
 * ProjectionSnapshotQueryShape - Service API for read-model snapshots.
 */
export interface ProjectionSnapshotQueryShape {
  /**
   * Read the latest orchestration projection snapshot.
   *
   * Rehydrates from projection tables and derives snapshot sequence from
   * projector cursor state.
   */
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;

  /**
   * Read the startup read model without per-thread content arrays.
   *
   * Projects and thread metadata are eager; messages, activities, checkpoints,
   * and proposed plans are loaded through getThreadContent.
   */
  readonly getStartupSnapshot: () => Effect.Effect<
    OrchestrationStartupSnapshot,
    ProjectionRepositoryError
  >;

  /**
   * Read one thread's nested content directly from projection tables.
   *
   * The returned sequence is the projection cursor observed in the same
   * transaction and is used by clients to reconcile live domain events.
   */
  readonly getThreadContent: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThreadContent, ProjectionRepositoryError>;

  /**
   * Read aggregate projection counts without hydrating the full read model.
   */
  readonly getCounts: () => Effect.Effect<ProjectionSnapshotCounts, ProjectionRepositoryError>;

  /**
   * Read the active project for an exact workspace root match.
   */
  readonly getActiveProjectByWorkspaceRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;

  /**
   * Read the earliest active thread for a project.
   */
  readonly getFirstActiveThreadIdByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<ThreadId>, ProjectionRepositoryError>;

  /**
   * Read a single project by ID (lightweight — no threads/messages/etc.).
   */
  readonly getProjectById: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;

  /**
   * Read a single thread by ID (lightweight — no messages/activities/sessions).
   */
  readonly getThreadById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionThreadSummary>, ProjectionRepositoryError>;

  /**
   * Check whether a thread has any user-role messages.
   * Returns None if the thread does not exist.
   */
  readonly hasThreadUserMessages: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<boolean>, ProjectionRepositoryError>;

  /**
   * Read the checkpoint context needed to resolve a single thread diff.
   */
  readonly getThreadCheckpointContext: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionThreadCheckpointContext>, ProjectionRepositoryError>;
}

/**
 * ProjectionSnapshotQuery - Service tag for projection snapshot queries.
 */
export class ProjectionSnapshotQuery extends ServiceMap.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("t3/orchestration/Services/ProjectionSnapshotQuery") {}
