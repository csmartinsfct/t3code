import fsPromises from "node:fs/promises";
import nodePath from "node:path";

import type { GitDiscoveredRepo } from "@t3tools/contracts";
import { Duration, Effect, Exit, FileSystem, Layer, PubSub, Ref, Scope, Stream } from "effect";

import {
  RepoDiscovery,
  RepoDiscoveryError,
  type RepoDiscoveryShape,
} from "../Services/RepoDiscovery.ts";

const SCAN_MAX_DEPTH = 4;
const WATCH_DEBOUNCE_MS = 500;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "vendor",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  "out",
  ".venv",
  "__pycache__",
]);

/**
 * Walk `root` looking for directories that contain a `.git` entry.
 * Returns absolute paths of discovered repo roots.
 */
async function scanForGitRepos(root: string, maxDepth: number): Promise<string[]> {
  const repos: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission error or missing dir — skip
    }

    const hasGit = entries.some((e) => e.name === ".git");
    if (hasGit) {
      repos.push(dir);
      // Don't descend into a git repo looking for nested repos —
      // nested .git dirs inside a repo are submodules, not separate repos.
      return;
    }

    // No .git here — recurse into subdirectories
    const subdirs = entries.filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name));
    await Promise.all(subdirs.map((e) => walk(nodePath.join(dir, e.name), depth + 1)));
  }

  await walk(root, 0);
  return repos;
}

function repoPathsToDescriptors(workspaceRoot: string, repoPaths: string[]): GitDiscoveredRepo[] {
  return repoPaths.toSorted().map((repoRoot) => ({
    cwd: repoRoot,
    relativePath: nodePath.relative(workspaceRoot, repoRoot) || ".",
    label: nodePath.basename(repoRoot),
  }));
}

export const RepoDiscoveryLive = Layer.effect(
  RepoDiscovery,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const reposRef = yield* Ref.make<Map<string, ReadonlyArray<GitDiscoveredRepo>>>(new Map());
    const pubSub = yield* PubSub.unbounded<{
      workspaceRoot: string;
      repos: ReadonlyArray<GitDiscoveredRepo>;
    }>();
    const watcherScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

    const scan = (workspaceRoot: string) =>
      Effect.gen(function* () {
        const repoPaths = yield* Effect.promise(() =>
          scanForGitRepos(workspaceRoot, SCAN_MAX_DEPTH),
        );
        const repos = repoPathsToDescriptors(workspaceRoot, repoPaths);
        yield* Ref.update(reposRef, (map) => {
          const next = new Map(map);
          next.set(workspaceRoot, repos);
          return next;
        });
        yield* PubSub.publish(pubSub, { workspaceRoot, repos });
        return repos;
      });

    const start: RepoDiscoveryShape["start"] = (workspaceRoot) =>
      Effect.gen(function* () {
        // Initial scan
        yield* scan(workspaceRoot).pipe(
          Effect.mapError(
            () =>
              new RepoDiscoveryError({
                operation: "start.scan",
                detail: `Failed to scan workspace root: ${workspaceRoot}`,
              }),
          ),
        );

        // Start filesystem watcher with debounce
        const debouncedEvents = fs.watch(workspaceRoot).pipe(
          Stream.filter((event) => {
            const eventPath = event.path;
            return eventPath.endsWith(".git") || eventPath.includes(".git");
          }),
          Stream.debounce(Duration.millis(WATCH_DEBOUNCE_MS)),
        );

        yield* Stream.runForEach(debouncedEvents, () =>
          scan(workspaceRoot).pipe(Effect.ignoreCause({ log: true })),
        ).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
      });

    const getRepos: RepoDiscoveryShape["getRepos"] = (workspaceRoot) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(reposRef);
        const existing = map.get(workspaceRoot);
        if (existing !== undefined) {
          return existing;
        }
        // If not started yet, do a one-off scan
        return yield* scan(workspaceRoot).pipe(
          Effect.mapError(
            () =>
              new RepoDiscoveryError({
                operation: "getRepos.scan",
                detail: `Failed to scan workspace root: ${workspaceRoot}`,
              }),
          ),
        );
      });

    const changes: RepoDiscoveryShape["changes"] = Stream.fromPubSub(pubSub);

    return RepoDiscovery.of({ start, getRepos, changes });
  }),
);
