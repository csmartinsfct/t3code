/**
 * RepoDiscovery - Effect service contract for discovering git repositories
 * within a project workspace.
 *
 * Scans the workspace root for `.git` directories, maintains a live set of
 * discovered repo roots, and watches for new repos appearing/disappearing.
 *
 * @module RepoDiscovery
 */
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { GitDiscoveredRepo } from "@t3tools/contracts";

export class RepoDiscoveryError extends Schema.TaggedErrorClass<RepoDiscoveryError>()(
  "RepoDiscoveryError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface RepoDiscoveryShape {
  /** Run an initial scan and start the filesystem watcher for the given workspace root. */
  readonly start: (workspaceRoot: string) => Effect.Effect<void, RepoDiscoveryError>;

  /** Return the current list of discovered repos for the given workspace root. */
  readonly getRepos: (
    workspaceRoot: string,
  ) => Effect.Effect<ReadonlyArray<GitDiscoveredRepo>, RepoDiscoveryError>;

  /** Stream that emits whenever the discovered repo list changes. */
  readonly changes: Stream.Stream<{
    workspaceRoot: string;
    repos: ReadonlyArray<GitDiscoveredRepo>;
  }>;
}

export class RepoDiscovery extends ServiceMap.Service<RepoDiscovery, RepoDiscoveryShape>()(
  "t3/workspace/RepoDiscovery",
) {}
