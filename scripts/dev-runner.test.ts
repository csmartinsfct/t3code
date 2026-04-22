import * as NodeServices from "@effect/platform-node/NodeServices";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  clearConflictingPorts,
  createDevRunnerEnv,
  findFirstAvailableOffset,
  getConflictPortsForMode,
  pruneOrphanWorktreeDirs,
  resolveModePortOffsets,
  resolveOffset,
  resolveWorktreeAwareBaseDir,
} from "./dev-runner.ts";

import { createHash } from "node:crypto";

const shortHash = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 12);

it.layer(NodeServices.layer)("dev-runner", (it) => {
  describe("resolveOffset", () => {
    it.effect("uses explicit T3CODE_PORT_OFFSET when provided", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: 12, devInstance: undefined });
        assert.deepStrictEqual(result, {
          offset: 12,
          source: "T3CODE_PORT_OFFSET=12",
        });
      }),
    );

    it.effect("hashes non-numeric instance values", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: undefined, devInstance: "feature-branch" });
        assert.ok(result.offset >= 1);
        assert.ok(result.offset <= 3000);
      }),
    );

    it.effect("throws for negative port offset", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.try({
            try: () => resolveOffset({ portOffset: -1, devInstance: undefined }),
            catch: (cause) => String(cause),
          }),
        );

        assert.ok(error.includes("Invalid T3CODE_PORT_OFFSET"));
      }),
    );
  });

  describe("createDevRunnerEnv", () => {
    it.effect("defaults T3CODE_HOME to ~/.t3 when not provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: undefined,
          authToken: undefined,
          noBrowser: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_HOME, resolve(homedir(), ".t3"));
      }),
    );

    it.effect("supports explicit typed overrides", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:server",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: "/tmp/custom-t3",
          authToken: "secret",
          noBrowser: true,
          logWebSocketEvents: true,
          host: "0.0.0.0",
          port: 4222,
          devUrl: new URL("http://localhost:7331"),
        });

        assert.equal(env.T3CODE_HOME, resolve("/tmp/custom-t3"));
        assert.equal(env.T3CODE_PORT, "4222");
        assert.equal(env.VITE_WS_URL, "ws://localhost:4222");
        assert.equal(env.T3CODE_NO_BROWSER, "1");
        assert.equal(env.T3CODE_LOG_WS_EVENTS, "1");
        assert.equal(env.T3CODE_HOST, "0.0.0.0");
        assert.equal(env.VITE_DEV_SERVER_URL, "http://localhost:7331/");
      }),
    );

    it.effect("does not force websocket logging on in dev mode when unset", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            T3CODE_LOG_WS_EVENTS: "keep-me-out",
          },
          serverOffset: 0,
          webOffset: 0,
          t3Home: undefined,
          authToken: undefined,
          noBrowser: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_MODE, "web");
        assert.equal(env.T3CODE_LOG_WS_EVENTS, undefined);
      }),
    );

    it.effect("forwards explicit websocket logging false without coercing it away", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: undefined,
          authToken: undefined,
          noBrowser: undefined,
          logWebSocketEvents: false,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_LOG_WS_EVENTS, "0");
      }),
    );

    it.effect("uses custom t3Home when provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: "/tmp/my-t3",
          authToken: undefined,
          noBrowser: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_HOME, resolve("/tmp/my-t3"));
      }),
    );

    it.effect("does not export backend bootstrap env for dev:desktop", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop",
          baseEnv: {
            T3CODE_PORT: "3773",
            T3CODE_AUTH_TOKEN: "stale-token",
            T3CODE_MODE: "web",
            T3CODE_NO_BROWSER: "0",
            T3CODE_HOST: "0.0.0.0",
            VITE_WS_URL: "ws://localhost:3773",
          },
          serverOffset: 0,
          webOffset: 0,
          t3Home: "/tmp/my-t3",
          authToken: "fresh-token",
          noBrowser: true,
          logWebSocketEvents: undefined,
          host: "127.0.0.1",
          port: 4222,
          devUrl: undefined,
        });

        assert.equal(env.T3CODE_HOME, resolve("/tmp/my-t3"));
        assert.equal(env.PORT, "5733");
        assert.equal(env.ELECTRON_RENDERER_PORT, "5733");
        assert.equal(env.VITE_DEV_SERVER_URL, "http://localhost:5733");
        assert.equal(env.T3CODE_PORT, undefined);
        assert.equal(env.T3CODE_AUTH_TOKEN, undefined);
        assert.equal(env.T3CODE_MODE, undefined);
        assert.equal(env.T3CODE_NO_BROWSER, undefined);
        assert.equal(env.T3CODE_HOST, undefined);
        assert.equal(env.VITE_WS_URL, undefined);
      }),
    );

    it.effect("redirects T3CODE_HOME into a per-worktree dir when in a worktree", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:desktop",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          t3Home: "/tmp/t3-wt",
          authToken: undefined,
          noBrowser: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
          cwd: "/repo/worktree",
          detectWorktree: async () =>
            Promise.resolve({ isWorktree: true, topLevel: "/repo/worktree" } as const),
          seedTemplate: async () => Promise.resolve(false),
          dirExists: async () => Promise.resolve(true),
          makeDir: async () => Promise.resolve(),
        });

        assert.match(env.T3CODE_HOME ?? "", /^\/tmp\/t3-wt\/worktrees\/[0-9a-f]{12}$/);
      }),
    );
  });

  describe("findFirstAvailableOffset", () => {
    it.effect("returns the starting offset when required ports are available", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 0);
      }),
    );

    it.effect("advances until all required ports are available", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733, 3774, 5734]);
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.equal(offset, 2);
      }),
    );

    it.effect("allows offsets where only non-required ports exceed max", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 59_803,
          requireServerPort: true,
          requireWebPort: false,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 59_803);
      }),
    );
  });

  describe("resolveModePortOffsets", () => {
    it.effect("uses a shared fallback offset for dev mode", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("keeps server offset stable for dev:web and only shifts web offset", () =>
      Effect.gen(function* () {
        const taken = new Set([5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:web",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 1 });
      }),
    );

    it.effect("shifts only server offset for dev:server", () =>
      Effect.gen(function* () {
        const taken = new Set([3773]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("respects explicit dev-url override for dev:web", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:web",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: true,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 0 });
      }),
    );

    it.effect("respects explicit server port override for dev:server", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: true,
          hasExplicitDevUrl: false,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 0 });
      }),
    );

    it.effect("keeps requested ports when conflict killing is enabled", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev",
          startOffset: 4,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          preferRequestedPorts: true,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 4, webOffset: 4 });
      }),
    );
  });

  describe("getConflictPortsForMode", () => {
    it.effect("returns both server and web ports for dev mode", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          getConflictPortsForMode("dev", {
            PORT: "5733",
            T3CODE_PORT: "3773",
          }),
          [3773, 5733],
        );
      }),
    );

    it.effect("only targets the backend port for dev:server", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          getConflictPortsForMode("dev:server", {
            PORT: "5733",
            T3CODE_PORT: "3773",
          }),
          [3773],
        );
      }),
    );

    it.effect("only targets the web port for dev:web", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          getConflictPortsForMode("dev:web", {
            PORT: "5733",
            T3CODE_PORT: "3773",
          }),
          [5733],
        );
      }),
    );
  });

  describe("clearConflictingPorts", () => {
    it.effect("deduplicates listeners across ports and escalates stubborn processes", () =>
      Effect.gen(function* () {
        const deliveredSignals: string[] = [];
        const alive = new Set([4101, 4102]);

        const cleared = yield* clearConflictingPorts({
          ports: [3773, 5733, 3773],
          listListeningProcessIdsOnPort: (port) =>
            Effect.succeed(port === 3773 ? [4101, 4102] : [4102]),
          signalProcess: (pid, signal) =>
            Effect.sync(() => {
              deliveredSignals.push(`${signal}:${String(pid)}`);

              if (signal === "SIGTERM" && pid === 4101) {
                alive.delete(pid);
              }

              if (signal === "SIGKILL") {
                alive.delete(pid);
              }
            }),
          waitForProcessExit: (pid) => Effect.succeed(!alive.has(pid)),
        });

        assert.deepStrictEqual(cleared, [4101, 4102]);
        assert.deepStrictEqual(deliveredSignals, ["SIGTERM:4101", "SIGTERM:4102", "SIGKILL:4102"]);
      }),
    );

    it.effect("returns an empty list when no selected ports are occupied", () =>
      Effect.gen(function* () {
        const cleared = yield* clearConflictingPorts({
          ports: [3773, 5733],
          listListeningProcessIdsOnPort: () => Effect.succeed([]),
        });

        assert.deepStrictEqual(cleared, []);
      }),
    );
  });

  describe("resolveWorktreeAwareBaseDir", () => {
    it.effect("returns rootBase unchanged for the primary clone", () =>
      Effect.gen(function* () {
        const result = yield* resolveWorktreeAwareBaseDir({
          rootBase: "/tmp/base",
          cwd: "/repo",
          detectWorktree: async () =>
            Promise.resolve({ isWorktree: false, topLevel: "/repo" } as const),
          seedTemplate: async () => Promise.resolve(false),
          dirExists: async () => Promise.resolve(true),
          makeDir: async () => Promise.resolve(),
        });

        assert.deepStrictEqual(result, {
          baseDir: "/tmp/base",
          isWorktree: false,
          topLevel: "/repo",
          seeded: false,
        });
      }),
    );

    it.effect("returns rootBase when git detection fails", () =>
      Effect.gen(function* () {
        const result = yield* resolveWorktreeAwareBaseDir({
          rootBase: "/tmp/base",
          cwd: "/no-repo",
          detectWorktree: async () => Promise.reject(new Error("not a repo")),
          seedTemplate: async () => Promise.resolve(false),
          dirExists: async () => Promise.resolve(false),
          makeDir: async () => Promise.resolve(),
        });

        assert.equal(result.baseDir, "/tmp/base");
        assert.equal(result.isWorktree, false);
      }),
    );

    it.effect("derives a per-worktree dir and seeds on first run", () =>
      Effect.gen(function* () {
        const seedCalls: Array<{ source: string; target: string }> = [];
        const mkdirCalls: string[] = [];
        const result = yield* resolveWorktreeAwareBaseDir({
          rootBase: "/tmp/base",
          cwd: "/wt-repo",
          detectWorktree: async () =>
            Promise.resolve({ isWorktree: true, topLevel: "/wt-repo" } as const),
          seedTemplate: async (source, target) => {
            seedCalls.push({ source, target });
            return true;
          },
          dirExists: async () => Promise.resolve(false),
          makeDir: async (path) => {
            mkdirCalls.push(path);
          },
        });

        assert.equal(result.isWorktree, true);
        assert.equal(result.topLevel, "/wt-repo");
        assert.equal(result.seeded, true);
        // baseDir is <rootBase>/worktrees/<sha1(topLevel).slice(0,12)>
        assert.match(result.baseDir, /^\/tmp\/base\/worktrees\/[0-9a-f]{12}$/);
        assert.deepStrictEqual(seedCalls, [
          {
            source: "/tmp/base/dev-template",
            target: `${result.baseDir}/dev`,
          },
        ]);
        assert.deepStrictEqual(mkdirCalls, [result.baseDir]);
      }),
    );

    it.effect("skips seeding when the worktree dir is already initialized", () =>
      Effect.gen(function* () {
        const seedCalls: Array<{ source: string; target: string }> = [];
        const result = yield* resolveWorktreeAwareBaseDir({
          rootBase: "/tmp/base",
          cwd: "/wt-repo",
          detectWorktree: async () =>
            Promise.resolve({ isWorktree: true, topLevel: "/wt-repo" } as const),
          seedTemplate: async (source, target) => {
            seedCalls.push({ source, target });
            return true;
          },
          dirExists: async () => Promise.resolve(true),
          makeDir: async () => Promise.resolve(),
        });

        assert.equal(result.isWorktree, true);
        assert.equal(result.seeded, false);
        assert.deepStrictEqual(seedCalls, []);
      }),
    );

    it.effect("is deterministic: same topLevel produces same baseDir", () =>
      Effect.gen(function* () {
        const common = {
          rootBase: "/tmp/base",
          cwd: "/wt-repo",
          detectWorktree: async () =>
            Promise.resolve({ isWorktree: true, topLevel: "/wt-repo" } as const),
          seedTemplate: async () => Promise.resolve(false),
          dirExists: async () => Promise.resolve(true),
          makeDir: async () => Promise.resolve(),
        } as const;
        const a = yield* resolveWorktreeAwareBaseDir(common);
        const b = yield* resolveWorktreeAwareBaseDir(common);
        assert.equal(a.baseDir, b.baseDir);
      }),
    );
  });

  describe("pruneOrphanWorktreeDirs", () => {
    it.effect("removes subdirs whose hash is not in the live worktree list", () =>
      Effect.gen(function* () {
        const live = new Set(["/repo/primary", "/repo/wt-a"]);
        const existing = [shortHash("/repo/primary"), shortHash("/repo/wt-a"), shortHash("/gone")];
        const removed: string[] = [];
        const result = yield* pruneOrphanWorktreeDirs({
          rootBase: "/tmp/base",
          primaryRepoCwd: "/repo/primary",
          listWorktreePaths: async () => Array.from(live),
          listDir: async () => existing,
          removeDir: async (path) => {
            removed.push(path);
          },
        });

        assert.equal(result.skipped, false);
        assert.deepStrictEqual(result.pruned, [`/tmp/base/worktrees/${shortHash("/gone")}`]);
        assert.deepStrictEqual(removed, [`/tmp/base/worktrees/${shortHash("/gone")}`]);
      }),
    );

    it.effect("skips pruning entirely when git returns no worktrees", () =>
      Effect.gen(function* () {
        const removed: string[] = [];
        const result = yield* pruneOrphanWorktreeDirs({
          rootBase: "/tmp/base",
          primaryRepoCwd: "/repo/primary",
          listWorktreePaths: async () => [],
          listDir: async () => ["0123456789ab"],
          removeDir: async (path) => {
            removed.push(path);
          },
        });

        assert.equal(result.skipped, true);
        assert.deepStrictEqual(result.pruned, []);
        assert.deepStrictEqual(removed, []);
      }),
    );

    it.effect("ignores non-hash directory names for safety", () =>
      Effect.gen(function* () {
        const removed: string[] = [];
        const result = yield* pruneOrphanWorktreeDirs({
          rootBase: "/tmp/base",
          primaryRepoCwd: "/repo/primary",
          listWorktreePaths: async () => ["/repo/primary"],
          listDir: async () => ["README", "notes.txt", "not-a-hash"],
          removeDir: async (path) => {
            removed.push(path);
          },
        });

        assert.equal(result.skipped, false);
        assert.deepStrictEqual(result.pruned, []);
        assert.deepStrictEqual(removed, []);
      }),
    );

    it.effect("swallows removeDir failures and reports only successful prunes", () =>
      Effect.gen(function* () {
        const orphanA = shortHash("/gone-a");
        const orphanB = shortHash("/gone-b");
        const result = yield* pruneOrphanWorktreeDirs({
          rootBase: "/tmp/base",
          primaryRepoCwd: "/repo/primary",
          listWorktreePaths: async () => ["/repo/primary"],
          listDir: async () => [orphanA, orphanB],
          removeDir: async (path) => {
            if (path.endsWith(orphanA)) {
              throw new Error("permission denied");
            }
          },
        });

        assert.equal(result.skipped, false);
        assert.deepStrictEqual(result.pruned, [`/tmp/base/worktrees/${orphanB}`]);
      }),
    );
  });
});
