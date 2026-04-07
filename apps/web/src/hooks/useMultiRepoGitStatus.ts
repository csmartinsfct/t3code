import type { GitDiscoveredRepo, GitStatusResult } from "@t3tools/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { gitDiscoverReposQueryOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import type { MultiRepoGitStatus } from "../lib/multiRepoTypes";

const EMPTY_REPOS: readonly GitDiscoveredRepo[] = [];

/**
 * Discovers git repos under a project root and queries git status for each.
 *
 * Returns a stable {@link MultiRepoGitStatus} object that aggregates discovery
 * and per-repo status into a single view used by the header, diff panel, and
 * git actions controls.
 */
export function useMultiRepoGitStatus(projectCwd: string | null): MultiRepoGitStatus {
  const discoverQuery = useQuery(gitDiscoverReposQueryOptions(projectCwd));
  const rawRepos = discoverQuery.data?.repos;

  // Keep a stable reference for repos to avoid re-renders when the array
  // identity changes but the contents are the same.
  const prevReposRef = useRef(EMPTY_REPOS);
  const repos = useMemo(() => {
    if (!rawRepos || rawRepos.length === 0) return EMPTY_REPOS;
    const prev = prevReposRef.current;
    if (prev.length === rawRepos.length && prev.every((r, i) => r.cwd === rawRepos[i]!.cwd)) {
      return prev;
    }
    prevReposRef.current = rawRepos;
    return rawRepos;
  }, [rawRepos]);

  const statusQueries = useQueries({
    queries: repos.map((repo) => gitStatusQueryOptions(repo.cwd)),
  });

  const statusByRepoCwd = useMemo(() => {
    const map = new Map<string, GitStatusResult>();
    for (let i = 0; i < repos.length; i++) {
      const data = statusQueries[i]?.data;
      if (data) map.set(repos[i]!.cwd, data);
    }
    return map;
  }, [repos, statusQueries]);

  return useMemo(
    () => ({
      repos,
      statusByRepoCwd,
      hasAnyRepo: repos.length > 0,
      hasAnyChanges: Array.from(statusByRepoCwd.values()).some((s) => s.hasWorkingTreeChanges),
      isLoading: discoverQuery.isLoading || statusQueries.some((q) => q.isLoading),
    }),
    [repos, statusByRepoCwd, discoverQuery.isLoading, statusQueries],
  );
}
