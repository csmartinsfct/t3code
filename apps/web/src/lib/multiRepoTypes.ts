import type { GitDiscoveredRepo, GitStatusResult } from "@t3tools/contracts";

export type { GitDiscoveredRepo as RepoDescriptor } from "@t3tools/contracts";

export interface MultiRepoGitStatus {
  /** All repos discovered under the project. Empty array = no repos found. */
  repos: readonly GitDiscoveredRepo[];
  /** Map from repo cwd -> GitStatusResult. Populated as queries resolve. */
  statusByRepoCwd: Map<string, GitStatusResult>;
  /** True if any discovered repo exists (i.e., repos.length > 0). */
  hasAnyRepo: boolean;
  /** True if any repo has working tree changes. */
  hasAnyChanges: boolean;
  /** True while discovery or any status query is still loading. */
  isLoading: boolean;
}
