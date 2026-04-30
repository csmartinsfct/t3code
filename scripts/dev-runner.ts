#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService } from "@t3tools/shared/Net";
import { Config, Data, Effect, Hash, Layer, Logger, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

const BASE_SERVER_PORT = 3773;
const BASE_WEB_PORT = 5733;
const MAX_HASH_OFFSET = 3000;
const MAX_PORT = 65535;
const PORT_CONFLICT_WAIT_MS = 1500;
const PORT_CONFLICT_POLL_INTERVAL_MS = 100;
const execFile = promisify(execFileCallback);

export const DEFAULT_T3_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(homedir(), ".t3"),
);

const MODE_ARGS = {
  dev: [
    "run",
    "dev",
    "--filter=@t3tools/contracts",
    "--filter=@t3tools/web",
    "--filter=t3",
    "--parallel",
  ],
  "dev:server": ["run", "dev", "--filter=t3"],
  "dev:web": ["run", "dev", "--filter=@t3tools/web"],
  "dev:desktop": ["run", "dev", "--filter=@t3tools/desktop", "--filter=@t3tools/web", "--parallel"],
} as const satisfies Record<string, ReadonlyArray<string>>;

/**
 * Turbo's TUI swallows child stdout, which means logs disappear when the
 * dev runner is launched under a managed run, CI, or any other non-TTY
 * context. Prefer `--ui=stream` whenever stdout isn't a real terminal so
 * child output is forwarded line-by-line. Respect an explicit `TURBO_UI`
 * env var if the user set one.
 */
function resolveTurboUiArgs(env: Record<string, string | undefined>): ReadonlyArray<string> {
  if (env.TURBO_UI && env.TURBO_UI.length > 0) return [];
  return process.stdout.isTTY ? ["--ui=tui"] : ["--ui=stream"];
}

type DevMode = keyof typeof MODE_ARGS;
type PortAvailabilityCheck<R = never> = (port: number) => Effect.Effect<boolean, never, R>;

const DEV_RUNNER_MODES = Object.keys(MODE_ARGS) as Array<DevMode>;

class DevRunnerError extends Data.TaggedError("DevRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalBooleanConfig = (name: string): Config.Config<boolean | undefined> =>
  Config.boolean(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalPortConfig = (name: string): Config.Config<number | undefined> =>
  Config.port(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalIntegerConfig = (name: string): Config.Config<number | undefined> =>
  Config.int(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalUrlConfig = (name: string): Config.Config<URL | undefined> =>
  Config.url(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

const OffsetConfig = Config.all({
  portOffset: optionalIntegerConfig("T3CODE_PORT_OFFSET"),
  devInstance: optionalStringConfig("T3CODE_DEV_INSTANCE"),
});

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
}): { readonly offset: number; readonly source: string } {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      throw new Error(`Invalid T3CODE_PORT_OFFSET: ${config.portOffset}`);
    }
    return {
      offset: config.portOffset,
      source: `T3CODE_PORT_OFFSET=${config.portOffset}`,
    };
  }

  const seed = config.devInstance?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return { offset: Number(seed), source: `numeric T3CODE_DEV_INSTANCE=${seed}` };
  }

  const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
  return { offset, source: `hashed T3CODE_DEV_INSTANCE=${seed}` };
}

function resolveBaseDir(baseDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = baseDir?.trim();

    if (configured) {
      return path.resolve(configured);
    }

    return yield* DEFAULT_T3_HOME;
  });
}

export interface WorktreeDetection {
  readonly isWorktree: boolean;
  readonly topLevel: string | null;
}

export type DetectWorktree = (cwd: string) => Promise<WorktreeDetection>;
export type SeedTemplate = (source: string, target: string) => Promise<boolean>;
export type DirExists = (path: string) => Promise<boolean>;
export type MakeDir = (path: string) => Promise<void>;

const defaultDetectWorktree: DetectWorktree = async (cwd) => {
  try {
    const [topLevelResult, gitCommonDirResult] = await Promise.all([
      execFile("git", ["rev-parse", "--show-toplevel"], { cwd }),
      execFile("git", ["rev-parse", "--git-common-dir"], { cwd }),
    ]);
    const topLevelStdout = topLevelResult.stdout.trim();
    const gitCommonDirStdout = gitCommonDirResult.stdout.trim();
    if (!topLevelStdout || !gitCommonDirStdout) {
      return { isWorktree: false, topLevel: null };
    }
    const path = await import("node:path");
    const topLevel = path.resolve(topLevelStdout);
    const gitCommonDir = path.isAbsolute(gitCommonDirStdout)
      ? gitCommonDirStdout
      : path.resolve(cwd, gitCommonDirStdout);
    const primaryRoot = path.resolve(path.dirname(gitCommonDir));
    return { isWorktree: primaryRoot !== topLevel, topLevel };
  } catch {
    return { isWorktree: false, topLevel: null };
  }
};

const defaultDirExists: DirExists = async (path) => {
  try {
    const stats = await nodeFs.stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const defaultMakeDir: MakeDir = async (path) => {
  await nodeFs.mkdir(path, { recursive: true });
};

const defaultSeedTemplate: SeedTemplate = async (source, target) => {
  try {
    const stats = await nodeFs.stat(source);
    if (!stats.isDirectory()) return false;
  } catch {
    return false;
  }
  await nodeFs.mkdir(target, { recursive: true });
  // `node:fs/promises.cp` is available on Node ≥16.7.
  // Copy everything that lives next to the state DB (sqlite files, attachments,
  // settings, keybindings) and skip logs so fresh logs accumulate per worktree.
  const entries = await nodeFs.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== "logs")
      .map((entry) =>
        nodeFs.cp(`${source}/${entry.name}`, `${target}/${entry.name}`, { recursive: true }),
      ),
  );
  return true;
};

// Best-effort garbage collection for orphaned per-worktree data dirs.
// When a user runs `git worktree remove <path>` (or deletes the checkout some
// other way), the corresponding `<rootBase>/worktrees/<hash>/` dir would
// otherwise linger forever. There is no `post-worktree-remove` git hook, so we
// reconcile on every dev launch: list the currently-known worktree paths, hash
// each one, and delete any subdir under `<rootBase>/worktrees/` whose name is
// not in that allow-list. Any failure (git missing, not a repo, permissions)
// skips pruning entirely — we never want to nuke data because of a transient
// problem.
export type ListWorktreePaths = (cwd: string) => Promise<readonly string[]>;
export type ListDir = (path: string) => Promise<readonly string[]>;
export type RemoveDir = (path: string) => Promise<void>;

const defaultListWorktreePaths: ListWorktreePaths = async (cwd) => {
  try {
    const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], { cwd });
    const paths: string[] = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length).trim());
      }
    }
    return paths;
  } catch {
    return [];
  }
};

const defaultListDir: ListDir = async (path) => {
  try {
    const entries = await nodeFs.readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
};

const defaultRemoveDir: RemoveDir = async (path) => {
  await nodeFs.rm(path, { recursive: true, force: true });
};

export interface PruneOrphanWorktreeDirsInput {
  readonly rootBase: string;
  readonly primaryRepoCwd: string;
  readonly listWorktreePaths?: ListWorktreePaths | undefined;
  readonly listDir?: ListDir | undefined;
  readonly removeDir?: RemoveDir | undefined;
}

export interface PruneOrphanWorktreeDirsResult {
  readonly pruned: readonly string[];
  readonly skipped: boolean;
}

export function pruneOrphanWorktreeDirs({
  rootBase,
  primaryRepoCwd,
  listWorktreePaths = defaultListWorktreePaths,
  listDir = defaultListDir,
  removeDir = defaultRemoveDir,
}: PruneOrphanWorktreeDirsInput): Effect.Effect<PruneOrphanWorktreeDirsResult, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const worktreeRoot = path.join(rootBase, "worktrees");

    const livePaths = yield* Effect.tryPromise({
      try: () => listWorktreePaths(primaryRepoCwd),
      catch: () => [] as readonly string[],
    }).pipe(Effect.catch(() => Effect.succeed([] as readonly string[])));

    // If git gave us nothing, conservatively skip pruning. Prevents wiping data
    // when git is missing or the cwd isn't a repo.
    if (livePaths.length === 0) {
      return { pruned: [], skipped: true };
    }

    const liveHashes = new Set(
      livePaths.map((p) => createHash("sha1").update(path.resolve(p)).digest("hex").slice(0, 12)),
    );

    const existingHashes = yield* Effect.tryPromise({
      try: () => listDir(worktreeRoot),
      catch: () => [] as readonly string[],
    }).pipe(Effect.catch(() => Effect.succeed([] as readonly string[])));

    const orphans = existingHashes.filter(
      (name) => /^[0-9a-f]{12}$/.test(name) && !liveHashes.has(name),
    );

    const pruned: string[] = [];
    for (const name of orphans) {
      const target = path.join(worktreeRoot, name);
      const removed = yield* Effect.tryPromise({
        try: () => removeDir(target).then(() => true),
        catch: () => false,
      }).pipe(Effect.catch(() => Effect.succeed(false)));
      if (removed) pruned.push(target);
    }

    return { pruned, skipped: false };
  });
}

export interface WorktreeAwareBaseDirInput {
  readonly rootBase: string;
  readonly cwd: string;
  readonly detectWorktree?: DetectWorktree | undefined;
  readonly seedTemplate?: SeedTemplate | undefined;
  readonly dirExists?: DirExists | undefined;
  readonly makeDir?: MakeDir | undefined;
}

export interface WorktreeAwareBaseDirResult {
  readonly baseDir: string;
  readonly isWorktree: boolean;
  readonly topLevel: string | null;
  readonly seeded: boolean;
}

export function resolveWorktreeAwareBaseDir({
  rootBase,
  cwd,
  detectWorktree = defaultDetectWorktree,
  seedTemplate = defaultSeedTemplate,
  dirExists = defaultDirExists,
  makeDir = defaultMakeDir,
}: WorktreeAwareBaseDirInput): Effect.Effect<WorktreeAwareBaseDirResult, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const detection = yield* Effect.tryPromise({
      try: () => detectWorktree(cwd),
      catch: () => ({ isWorktree: false, topLevel: null }) satisfies WorktreeDetection,
    }).pipe(
      Effect.catch(
        () =>
          Effect.succeed({ isWorktree: false, topLevel: null }) as Effect.Effect<
            WorktreeDetection,
            never
          >,
      ),
    );

    if (!detection.isWorktree || !detection.topLevel) {
      return {
        baseDir: rootBase,
        isWorktree: false,
        topLevel: detection.topLevel,
        seeded: false,
      };
    }

    const hash = createHash("sha1").update(detection.topLevel).digest("hex").slice(0, 12);
    const worktreeBase = path.join(rootBase, "worktrees", hash);
    const alreadyInitialized = yield* Effect.tryPromise({
      try: () => dirExists(worktreeBase),
      catch: () => false,
    }).pipe(Effect.catch(() => Effect.succeed(false)));

    let seeded = false;
    if (!alreadyInitialized) {
      const template = path.join(rootBase, "dev-template");
      const seedState = path.join(worktreeBase, "dev");
      seeded = yield* Effect.tryPromise({
        try: () => seedTemplate(template, seedState),
        catch: () => false,
      }).pipe(Effect.catch(() => Effect.succeed(false)));
      yield* Effect.tryPromise({
        try: () => makeDir(worktreeBase),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void));
    }

    return {
      baseDir: worktreeBase,
      isWorktree: true,
      topLevel: detection.topLevel,
      seeded,
    };
  });
}

interface CreateDevRunnerEnvInput {
  readonly mode: DevMode;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly serverOffset: number;
  readonly webOffset: number;
  readonly t3Home: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly cwd?: string;
  readonly detectWorktree?: DetectWorktree;
  readonly seedTemplate?: SeedTemplate;
  readonly dirExists?: DirExists;
  readonly makeDir?: MakeDir;
  readonly listWorktreePaths?: ListWorktreePaths;
  readonly listDir?: ListDir;
  readonly removeDir?: RemoveDir;
}

export function createDevRunnerEnv({
  mode,
  baseEnv,
  serverOffset,
  webOffset,
  t3Home,
  authToken,
  noBrowser,
  logWebSocketEvents,
  host,
  port,
  devUrl,
  cwd,
  detectWorktree,
  seedTemplate,
  dirExists,
  makeDir,
  listWorktreePaths,
  listDir,
  removeDir,
}: CreateDevRunnerEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const serverPort = port ?? BASE_SERVER_PORT + serverOffset;
    const webPort = BASE_WEB_PORT + webOffset;
    const resolvedCwd = cwd ?? process.cwd();
    const rootBaseDir = yield* resolveBaseDir(t3Home);
    const pruneResult = yield* pruneOrphanWorktreeDirs({
      rootBase: rootBaseDir,
      primaryRepoCwd: resolvedCwd,
      listWorktreePaths,
      listDir,
      removeDir,
    });
    if (pruneResult.pruned.length > 0) {
      yield* Effect.logInfo(
        `[dev-runner] pruned ${pruneResult.pruned.length} orphan worktree dir(s): ${pruneResult.pruned.join(", ")}`,
      );
    }
    const worktreeResult = yield* resolveWorktreeAwareBaseDir({
      rootBase: rootBaseDir,
      cwd: resolvedCwd,
      detectWorktree,
      seedTemplate,
      dirExists,
      makeDir,
    });
    if (worktreeResult.isWorktree) {
      yield* Effect.logInfo(
        `[dev-runner] worktree isolation active topLevel=${String(
          worktreeResult.topLevel,
        )} baseDir=${worktreeResult.baseDir}${worktreeResult.seeded ? " seeded=dev-template" : ""}`,
      );
    }
    const resolvedBaseDir = worktreeResult.baseDir;
    const isDesktopMode = mode === "dev:desktop";

    const output: NodeJS.ProcessEnv = {
      ...baseEnv,
      PORT: String(webPort),
      ELECTRON_RENDERER_PORT: String(webPort),
      VITE_DEV_SERVER_URL: devUrl?.toString() ?? `http://localhost:${webPort}`,
      T3CODE_HOME: resolvedBaseDir,
    };

    if (!isDesktopMode) {
      output.T3CODE_PORT = String(serverPort);
      output.VITE_WS_URL = `ws://localhost:${serverPort}`;
    } else {
      delete output.T3CODE_PORT;
      delete output.VITE_WS_URL;
      delete output.T3CODE_AUTH_TOKEN;
      delete output.T3CODE_MODE;
      delete output.T3CODE_NO_BROWSER;
      delete output.T3CODE_HOST;
    }

    if (!isDesktopMode && host !== undefined) {
      output.T3CODE_HOST = host;
    }

    if (!isDesktopMode && authToken !== undefined) {
      output.T3CODE_AUTH_TOKEN = authToken;
    } else if (!isDesktopMode) {
      delete output.T3CODE_AUTH_TOKEN;
    }

    if (!isDesktopMode && noBrowser !== undefined) {
      output.T3CODE_NO_BROWSER = noBrowser ? "1" : "0";
    } else if (!isDesktopMode) {
      delete output.T3CODE_NO_BROWSER;
    }

    if (logWebSocketEvents !== undefined) {
      output.T3CODE_LOG_WS_EVENTS = logWebSocketEvents ? "1" : "0";
    } else {
      delete output.T3CODE_LOG_WS_EVENTS;
    }

    if (mode === "dev") {
      output.T3CODE_MODE = "web";
      delete output.T3CODE_DESKTOP_WS_URL;
    }

    if (mode === "dev:server" || mode === "dev:web") {
      output.T3CODE_MODE = "web";
      delete output.T3CODE_DESKTOP_WS_URL;
    }

    if (isDesktopMode) {
      delete output.T3CODE_DESKTOP_WS_URL;
    }

    return output;
  });
}

function portPairForOffset(offset: number): {
  readonly serverPort: number;
  readonly webPort: number;
} {
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + offset,
  };
}

const defaultCheckPortAvailability: PortAvailabilityCheck<NetService> = (port) =>
  Effect.gen(function* () {
    const net = yield* NetService;
    return yield* net.isPortAvailableOnLoopback(port);
  });

interface FindFirstAvailableOffsetInput<R = NetService> {
  readonly startOffset: number;
  readonly requireServerPort: boolean;
  readonly requireWebPort: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function findFirstAvailableOffset<R = NetService>({
  startOffset,
  requireServerPort,
  requireWebPort,
  checkPortAvailability,
}: FindFirstAvailableOffsetInput<R>): Effect.Effect<number, DevRunnerError, R> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    for (let candidate = startOffset; ; candidate += 1) {
      const { serverPort, webPort } = portPairForOffset(candidate);
      const serverPortOutOfRange = serverPort > MAX_PORT;
      const webPortOutOfRange = webPort > MAX_PORT;

      if (
        (requireServerPort && serverPortOutOfRange) ||
        (requireWebPort && webPortOutOfRange) ||
        (!requireServerPort && !requireWebPort && (serverPortOutOfRange || webPortOutOfRange))
      ) {
        break;
      }

      const checks: Array<Effect.Effect<boolean, never, R>> = [];
      if (requireServerPort) {
        checks.push(checkPort(serverPort));
      }
      if (requireWebPort) {
        checks.push(checkPort(webPort));
      }

      if (checks.length === 0) {
        return candidate;
      }

      const availability = yield* Effect.all(checks);
      if (availability.every(Boolean)) {
        return candidate;
      }
    }

    return yield* new DevRunnerError({
      message: `No available dev ports found from offset ${startOffset}. Tried server=${BASE_SERVER_PORT}+n web=${BASE_WEB_PORT}+n up to port ${MAX_PORT}.`,
    });
  });
}

interface ResolveModePortOffsetsInput<R = NetService> {
  readonly mode: DevMode;
  readonly startOffset: number;
  readonly hasExplicitServerPort: boolean;
  readonly hasExplicitDevUrl: boolean;
  readonly preferRequestedPorts?: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function resolveModePortOffsets<R = NetService>({
  mode,
  startOffset,
  hasExplicitServerPort,
  hasExplicitDevUrl,
  preferRequestedPorts = false,
  checkPortAvailability,
}: ResolveModePortOffsetsInput<R>): Effect.Effect<
  { readonly serverOffset: number; readonly webOffset: number },
  DevRunnerError,
  R
> {
  return Effect.gen(function* () {
    if (preferRequestedPorts) {
      return { serverOffset: startOffset, webOffset: startOffset };
    }

    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    if (mode === "dev:web") {
      if (hasExplicitDevUrl) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const webOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: false,
        requireWebPort: true,
        checkPortAvailability: checkPort,
      });
      return { serverOffset: startOffset, webOffset };
    }

    if (mode === "dev:server") {
      if (hasExplicitServerPort) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const serverOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: true,
        requireWebPort: false,
        checkPortAvailability: checkPort,
      });
      return { serverOffset, webOffset: serverOffset };
    }

    const sharedOffset = yield* findFirstAvailableOffset({
      startOffset,
      requireServerPort: !hasExplicitServerPort,
      requireWebPort: !hasExplicitDevUrl,
      checkPortAvailability: checkPort,
    });

    return { serverOffset: sharedOffset, webOffset: sharedOffset };
  });
}

interface DevRunnerCliInput {
  readonly mode: DevMode;
  readonly t3Home: string | undefined;
  readonly authToken: string | undefined;
  readonly killPortConflicts: boolean | undefined;
  readonly noBrowser: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly dryRun: boolean;
  readonly turboArgs: ReadonlyArray<string>;
}

const readOptionalBooleanEnv = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return undefined;
};

const resolveOptionalBooleanOverride = (
  explicitValue: boolean | undefined,
  envValue: boolean | undefined,
): boolean | undefined => {
  if (explicitValue === true) {
    return true;
  }

  if (explicitValue === false) {
    return envValue;
  }

  return envValue;
};

function isErrnoExceptionWithCode(cause: unknown): cause is {
  readonly code: string;
} {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { readonly code: unknown }).code === "string"
  );
}

function isExitCodeError(
  cause: unknown,
  expectedCode: number,
): cause is {
  readonly code: number;
} {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code: unknown }).code === expectedCode
  );
}

type ProcessSignal = "SIGTERM" | "SIGKILL";
type PortProcessLookup<R = never> = (
  port: number,
) => Effect.Effect<ReadonlyArray<number>, DevRunnerError, R>;
type ProcessSignalSender = (
  pid: number,
  signal: ProcessSignal,
) => Effect.Effect<void, DevRunnerError>;
type ProcessExitWaiter<R = never> = (pid: number) => Effect.Effect<boolean, DevRunnerError, R>;

const defaultListListeningProcessIdsOnPort: PortProcessLookup = (port) =>
  Effect.tryPromise({
    try: async () => {
      if (process.platform === "win32") {
        return [];
      }

      try {
        const { stdout } = await execFile("lsof", [
          "-nP",
          `-iTCP:${String(port)}`,
          "-sTCP:LISTEN",
          "-t",
        ]);

        return [...new Set(stdout.split(/\s+/u))]
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isInteger(value) && value > 0);
      } catch (cause) {
        if (isExitCodeError(cause, 1)) {
          return [];
        }

        if (isErrnoExceptionWithCode(cause) && cause.code === "ENOENT") {
          return [];
        }

        throw cause;
      }
    },
    catch: (cause) =>
      new DevRunnerError({
        message: `Failed to inspect port ${port} listeners.`,
        cause,
      }),
  });

const defaultSignalProcess: ProcessSignalSender = (pid, signal) =>
  Effect.try({
    try: () => {
      try {
        process.kill(pid, signal);
      } catch (cause) {
        if (isErrnoExceptionWithCode(cause) && cause.code === "ESRCH") {
          return;
        }
        throw cause;
      }
    },
    catch: (cause) =>
      new DevRunnerError({
        message: `Failed to send ${signal} to process ${pid}.`,
        cause,
      }),
  });

const defaultWaitForProcessExit: ProcessExitWaiter = (pid) =>
  Effect.gen(function* () {
    const attempts = Math.max(1, Math.ceil(PORT_CONFLICT_WAIT_MS / PORT_CONFLICT_POLL_INTERVAL_MS));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const alive = yield* Effect.try({
        try: () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (cause) {
            if (isErrnoExceptionWithCode(cause)) {
              if (cause.code === "ESRCH") {
                return false;
              }

              if (cause.code === "EPERM") {
                return true;
              }
            }

            throw cause;
          }
        },
        catch: (cause) =>
          new DevRunnerError({
            message: `Failed to verify whether process ${pid} is still running.`,
            cause,
          }),
      });

      if (!alive) {
        return true;
      }

      yield* Effect.sleep(PORT_CONFLICT_POLL_INTERVAL_MS);
    }

    return false;
  });

const parseEnvPort = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    return undefined;
  }

  return port;
};

export function getConflictPortsForMode(
  mode: DevMode,
  env: {
    readonly [key: string]: string | undefined;
    readonly PORT?: string;
    readonly T3CODE_PORT?: string;
  },
): ReadonlyArray<number> {
  switch (mode) {
    case "dev":
      return [parseEnvPort(env.T3CODE_PORT), parseEnvPort(env.PORT)].filter(
        (value): value is number => value !== undefined,
      );
    case "dev:server": {
      const port = parseEnvPort(env.T3CODE_PORT);
      return port === undefined ? [] : [port];
    }
    case "dev:web":
    case "dev:desktop": {
      const port = parseEnvPort(env.PORT);
      return port === undefined ? [] : [port];
    }
  }
}

interface ClearConflictingPortsInput<R = never> {
  readonly ports: ReadonlyArray<number>;
  readonly listListeningProcessIdsOnPort?: PortProcessLookup<R>;
  readonly signalProcess?: ProcessSignalSender;
  readonly waitForProcessExit?: ProcessExitWaiter<R>;
}

export function clearConflictingPorts<R = never>({
  ports,
  listListeningProcessIdsOnPort,
  signalProcess,
  waitForProcessExit,
}: ClearConflictingPortsInput<R>): Effect.Effect<ReadonlyArray<number>, DevRunnerError, R> {
  return Effect.gen(function* () {
    const uniquePorts = [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0))];
    if (uniquePorts.length === 0) {
      return [];
    }

    const lookup = (listListeningProcessIdsOnPort ??
      defaultListListeningProcessIdsOnPort) as PortProcessLookup<R>;
    const sendSignal = signalProcess ?? defaultSignalProcess;
    const waitForExit = (waitForProcessExit ?? defaultWaitForProcessExit) as ProcessExitWaiter<R>;

    const seenPids = new Set<number>();
    const pids: number[] = [];

    for (const port of uniquePorts) {
      const listeners = yield* lookup(port);
      for (const pid of listeners) {
        if (pid === process.pid || seenPids.has(pid)) {
          continue;
        }

        seenPids.add(pid);
        pids.push(pid);
      }
    }

    if (pids.length === 0) {
      return [];
    }

    yield* Effect.logInfo(
      `[dev-runner] clearing port conflicts ports=${uniquePorts.join(",")} pids=${pids.join(",")}`,
    );

    for (const pid of pids) {
      yield* sendSignal(pid, "SIGTERM");
    }

    const stubbornPids: number[] = [];
    for (const pid of pids) {
      const exited = yield* waitForExit(pid);
      if (!exited) {
        stubbornPids.push(pid);
      }
    }

    if (stubbornPids.length === 0) {
      return pids;
    }

    yield* Effect.logWarning(
      `[dev-runner] force-killing stubborn port conflicts pids=${stubbornPids.join(",")}`,
    );

    for (const pid of stubbornPids) {
      yield* sendSignal(pid, "SIGKILL");
    }

    for (const pid of stubbornPids) {
      const exited = yield* waitForExit(pid);
      if (!exited) {
        return yield* new DevRunnerError({
          message: `Failed to stop port-conflicting process ${pid}.`,
        });
      }
    }

    return pids;
  });
}

export function runDevRunnerWithInput(input: DevRunnerCliInput) {
  return Effect.gen(function* () {
    const { portOffset, devInstance } = yield* OffsetConfig.asEffect().pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerError({
            message: "Failed to read T3CODE_PORT_OFFSET/T3CODE_DEV_INSTANCE configuration.",
            cause,
          }),
      ),
    );

    const { offset, source } = yield* Effect.try({
      try: () => resolveOffset({ portOffset, devInstance }),
      catch: (cause) =>
        new DevRunnerError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const envOverrides = {
      killPortConflicts: readOptionalBooleanEnv("T3CODE_KILL_PORT_CONFLICTS"),
      noBrowser: readOptionalBooleanEnv("T3CODE_NO_BROWSER"),
      logWebSocketEvents: readOptionalBooleanEnv("T3CODE_LOG_WS_EVENTS"),
    };

    const killPortConflicts =
      resolveOptionalBooleanOverride(input.killPortConflicts, envOverrides.killPortConflicts) ===
      true;

    const { serverOffset, webOffset } = yield* resolveModePortOffsets({
      mode: input.mode,
      startOffset: offset,
      hasExplicitServerPort: input.port !== undefined,
      hasExplicitDevUrl: input.devUrl !== undefined,
      preferRequestedPorts: killPortConflicts,
    });

    const env = yield* createDevRunnerEnv({
      mode: input.mode,
      baseEnv: process.env,
      serverOffset,
      webOffset,
      t3Home: input.t3Home,
      authToken: input.authToken,
      noBrowser: resolveOptionalBooleanOverride(input.noBrowser, envOverrides.noBrowser),
      logWebSocketEvents: resolveOptionalBooleanOverride(
        input.logWebSocketEvents,
        envOverrides.logWebSocketEvents,
      ),
      host: input.host,
      port: input.port,
      devUrl: input.devUrl,
    });

    const selectionSuffix =
      serverOffset !== offset || webOffset !== offset
        ? ` selectedOffset(server=${serverOffset},web=${webOffset})`
        : "";

    yield* Effect.logInfo(
      `[dev-runner] mode=${input.mode} source=${source}${selectionSuffix} serverPort=${String(env.T3CODE_PORT)} webPort=${String(env.PORT)} baseDir=${String(env.T3CODE_HOME)}`,
    );

    if (input.dryRun) {
      return;
    }

    if (killPortConflicts) {
      yield* clearConflictingPorts({
        ports: getConflictPortsForMode(input.mode, env),
      });
    }

    const child = yield* ChildProcess.make(
      "turbo",
      [...MODE_ARGS[input.mode], ...resolveTurboUiArgs(env), ...input.turboArgs],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
        extendEnv: false,
        // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
        shell: process.platform === "win32",
        // Keep turbo in the same process group so terminal signals (Ctrl+C)
        // reach it directly. Effect defaults to detached: true on non-Windows,
        // which would put turbo in a new group and require manual forwarding.
        detached: false,
        forceKillAfter: "1500 millis",
      },
    );

    const exitCode = yield* child.exitCode;
    if (exitCode !== 0) {
      return yield* new DevRunnerError({
        message: `turbo exited with code ${exitCode}`,
      });
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DevRunnerError
        ? cause
        : new DevRunnerError({
            message: cause instanceof Error ? cause.message : "dev-runner failed",
            cause,
          }),
    ),
  );
}

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.choice("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  t3Home: Flag.string("home-dir").pipe(
    Flag.withDescription("Base directory for all T3 Code data (equivalent to T3CODE_HOME)."),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_HOME")),
  ),
  authToken: Flag.string("auth-token").pipe(
    Flag.withDescription("Auth token (forwards to T3CODE_AUTH_TOKEN)."),
    Flag.withAlias("token"),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_AUTH_TOKEN")),
  ),
  killPortConflicts: Flag.boolean("kill-port-conflicts").pipe(
    Flag.withDescription(
      "Stop any listeners already bound to the selected dev ports before starting.",
    ),
    Flag.withFallbackConfig(optionalBooleanConfig("T3CODE_KILL_PORT_CONFLICTS")),
  ),
  noBrowser: Flag.boolean("no-browser").pipe(
    Flag.withDescription("Browser auto-open toggle (equivalent to T3CODE_NO_BROWSER)."),
    Flag.withFallbackConfig(optionalBooleanConfig("T3CODE_NO_BROWSER")),
  ),
  logWebSocketEvents: Flag.boolean("log-websocket-events").pipe(
    Flag.withDescription("WebSocket event logging toggle (equivalent to T3CODE_LOG_WS_EVENTS)."),
    Flag.withAlias("log-ws-events"),
    Flag.withFallbackConfig(optionalBooleanConfig("T3CODE_LOG_WS_EVENTS")),
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription("Server host/interface override (forwards to T3CODE_HOST)."),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_HOST")),
  ),
  port: Flag.integer("port").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    Flag.withDescription("Server port override (forwards to T3CODE_PORT)."),
    Flag.withFallbackConfig(optionalPortConfig("T3CODE_PORT")),
  ),
  devUrl: Flag.string("dev-url").pipe(
    Flag.withSchema(Schema.URLFromString),
    Flag.withDescription("Web dev URL override (forwards to VITE_DEV_SERVER_URL)."),
    Flag.withFallbackConfig(optionalUrlConfig("VITE_DEV_SERVER_URL")),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve mode/ports/env and print, but do not spawn turbo."),
    Flag.withDefault(false),
  ),
  turboArgs: Argument.string("turbo-arg").pipe(
    Argument.withDescription("Additional turbo args (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo development modes with deterministic port/env wiring."),
  Command.withHandler((input) => runDevRunnerWithInput(input)),
);

const cliRuntimeLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  NodeServices.layer,
  NetService.layer,
);

const runtimeProgram = Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
);

if (import.meta.main) {
  NodeRuntime.runMain(runtimeProgram);
}
