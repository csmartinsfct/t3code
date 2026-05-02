import { Effect } from "effect";

import { runProcess } from "../../processRunner";

export type CursorProcessSignal = "SIGINT" | "SIGTERM" | "SIGKILL";
export type CursorProcessCleanupStage =
  | "signal"
  | "signal_failed"
  | "exit_observed"
  | "escalating"
  | "force_kill"
  | "complete";

export class CursorProcessTreeError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "CursorProcessTreeError";
    this.cause = cause;
  }
}

export interface CursorProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

export type CursorProcessTreeTerminator = (
  pid: number,
  signal: CursorProcessSignal,
) => Effect.Effect<void, CursorProcessTreeError>;

export interface CursorProcessCleanupEvent {
  readonly stage: CursorProcessCleanupStage;
  readonly pid: number;
  readonly signal?: CursorProcessSignal;
  readonly graceMs?: number;
  readonly message?: string;
}

export interface CursorProcessCleanupOptions {
  readonly graceMs?: number;
  readonly processTreeTerminator?: CursorProcessTreeTerminator;
  readonly isProcessRunning?: (pid: number) => boolean;
  readonly onCleanupEvent?: (event: CursorProcessCleanupEvent) => Effect.Effect<void>;
}

export function parseCursorProcessTable(output: string): ReadonlyArray<CursorProcessEntry> {
  const entries: CursorProcessEntry[] = [];
  for (const line of output.split("\n")) {
    const [pidRaw, ppidRaw, pgidRaw] = line.trim().split(/\s+/);
    const pid = Number(pidRaw);
    const ppid = Number(ppidRaw);
    const pgid = Number(pgidRaw);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) {
      continue;
    }
    entries.push({ pid, ppid, pgid });
  }
  return entries;
}

export function collectCursorDescendantProcesses(
  rootPid: number,
  entries: ReadonlyArray<CursorProcessEntry>,
): ReadonlyArray<CursorProcessEntry> {
  const byParent = new Map<number, CursorProcessEntry[]>();
  for (const entry of entries) {
    const existing = byParent.get(entry.ppid);
    if (existing) {
      existing.push(entry);
    } else {
      byParent.set(entry.ppid, [entry]);
    }
  }

  const descendants: CursorProcessEntry[] = [];
  const stack = [...(byParent.get(rootPid) ?? [])];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || seen.has(next.pid)) continue;
    seen.add(next.pid);
    descendants.push(next);
    stack.push(...(byParent.get(next.pid) ?? []));
  }
  return descendants;
}

function shouldSignalPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 1 && pid !== process.pid;
}

const signalProcessId = Effect.fn("cursor.signalProcessId")(function* (
  pid: number,
  signal: CursorProcessSignal,
) {
  if (!shouldSignalPid(pid)) return;
  yield* Effect.try({
    try: () => process.kill(pid, signal),
    catch: (cause) =>
      new CursorProcessTreeError(`Failed to send ${signal} to process ${pid}.`, cause),
  }).pipe(
    Effect.catch((error) => {
      const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
      return code === "ESRCH" ? Effect.void : Effect.fail(error);
    }),
  );
});

const signalProcessGroup = Effect.fn("cursor.signalProcessGroup")(function* (
  pgid: number,
  signal: CursorProcessSignal,
) {
  if (!shouldSignalPid(pgid)) return;
  yield* Effect.try({
    try: () => process.kill(-pgid, signal),
    catch: (cause) =>
      new CursorProcessTreeError(`Failed to send ${signal} to process group ${pgid}.`, cause),
  }).pipe(
    Effect.catch((error) => {
      const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
      return code === "ESRCH" ? Effect.void : Effect.fail(error);
    }),
  );
});

const terminateWindowsProcessTree = Effect.fn("cursor.terminateWindowsProcessTree")(function* (
  pid: number,
  signal: CursorProcessSignal,
) {
  const args = ["/pid", String(pid), "/T"];
  if (signal === "SIGKILL") {
    args.push("/F");
  }
  yield* Effect.tryPromise({
    try: () =>
      runProcess("taskkill", args, {
        timeoutMs: 1_500,
        allowNonZeroExit: true,
        maxBufferBytes: 32_768,
        outputMode: "truncate",
      }),
    catch: (cause) =>
      new CursorProcessTreeError(`Failed to terminate Cursor process tree ${pid}.`, cause),
  }).pipe(Effect.asVoid);
});

const terminatePosixProcessTree = Effect.fn("cursor.terminatePosixProcessTree")(function* (
  pid: number,
  signal: CursorProcessSignal,
) {
  const psResult = yield* Effect.tryPromise({
    try: () =>
      runProcess("ps", ["-eo", "pid=,ppid=,pgid="], {
        timeoutMs: 1_000,
        maxBufferBytes: 262_144,
        outputMode: "truncate",
      }),
    catch: (cause) =>
      new CursorProcessTreeError(`Failed to inspect Cursor process tree ${pid}.`, cause),
  });
  const entries = parseCursorProcessTable(psResult.stdout);
  const root = entries.find((entry) => entry.pid === pid);
  const descendants = collectCursorDescendantProcesses(pid, entries);
  const descendantPids = new Set(descendants.map((entry) => entry.pid));
  const processGroups = [
    ...new Set(
      [
        pid,
        ...(root && root.pgid === pid ? [root.pgid] : []),
        ...descendants
          .map((entry) => entry.pgid)
          .filter((pgid) => Number.isInteger(pgid) && pgid > 1 && descendantPids.has(pgid)),
      ].filter((pgid) => shouldSignalPid(pgid)),
    ),
  ];

  yield* Effect.forEach(processGroups, (pgid) => signalProcessGroup(pgid, signal), {
    discard: true,
  });
  yield* Effect.forEach(descendants.toReversed(), (entry) => signalProcessId(entry.pid, signal), {
    discard: true,
  });
  yield* signalProcessId(pid, signal);
});

export const terminateCursorProcessTree: CursorProcessTreeTerminator = (pid, signal) => {
  if (!shouldSignalPid(pid)) {
    return Effect.void;
  }
  return process.platform === "win32"
    ? terminateWindowsProcessTree(pid, signal)
    : terminatePosixProcessTree(pid, signal);
};

function isProcessRunning(pid: number): boolean {
  if (!shouldSignalPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return code !== "ESRCH";
  }
}

function isProcessGroupRunning(pgid: number): boolean {
  if (!shouldSignalPid(pgid) || process.platform === "win32") return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return code !== "ESRCH";
  }
}

function isCleanupTargetRunning(pid: number): boolean {
  return isProcessRunning(pid) || isProcessGroupRunning(pid);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : String(cause);
}

export const cleanupCursorProcessTree = Effect.fn("cursor.cleanupCursorProcessTree")(function* (
  pid: number,
  options: CursorProcessCleanupOptions = {},
) {
  const terminator = options.processTreeTerminator ?? terminateCursorProcessTree;
  const graceMs = options.graceMs ?? 2_000;
  const processRunning = options.isProcessRunning ?? isCleanupTargetRunning;
  const emitCleanupEvent = (event: CursorProcessCleanupEvent) =>
    options.onCleanupEvent
      ? options.onCleanupEvent(event).pipe(Effect.ignoreCause({ log: true }))
      : Effect.void;

  yield* emitCleanupEvent({ stage: "signal", pid, signal: "SIGINT", graceMs });
  yield* Effect.logDebug("terminating Cursor process tree", { pid, signal: "SIGINT" });
  yield* terminator(pid, "SIGINT").pipe(
    Effect.catch((cause) =>
      emitCleanupEvent({
        stage: "signal_failed",
        pid,
        signal: "SIGINT",
        message: errorMessage(cause),
      }).pipe(
        Effect.andThen(
          Effect.logWarning("failed to send SIGINT to Cursor process tree", { pid, cause }),
        ),
      ),
    ),
  );

  yield* Effect.sleep(`${graceMs} millis`);
  if (!processRunning(pid)) {
    yield* emitCleanupEvent({ stage: "exit_observed", pid, signal: "SIGINT" });
    return;
  }

  yield* emitCleanupEvent({ stage: "escalating", pid, signal: "SIGTERM", graceMs });
  yield* Effect.logDebug("escalating Cursor process tree termination", { pid, signal: "SIGTERM" });
  yield* terminator(pid, "SIGTERM").pipe(
    Effect.catch((cause) =>
      emitCleanupEvent({
        stage: "signal_failed",
        pid,
        signal: "SIGTERM",
        message: errorMessage(cause),
      }).pipe(
        Effect.andThen(
          Effect.logWarning("failed to send SIGTERM to Cursor process tree", { pid, cause }),
        ),
      ),
    ),
  );

  yield* Effect.sleep(`${graceMs} millis`);
  if (!processRunning(pid)) {
    yield* emitCleanupEvent({ stage: "exit_observed", pid, signal: "SIGTERM" });
    return;
  }

  yield* emitCleanupEvent({ stage: "force_kill", pid, signal: "SIGKILL" });
  yield* Effect.logWarning("force killing Cursor process tree after cleanup timeout", { pid });
  yield* terminator(pid, "SIGKILL").pipe(
    Effect.catch((cause) =>
      emitCleanupEvent({
        stage: "signal_failed",
        pid,
        signal: "SIGKILL",
        message: errorMessage(cause),
      }).pipe(
        Effect.andThen(
          Effect.logWarning("failed to send SIGKILL to Cursor process tree", { pid, cause }),
        ),
      ),
    ),
  );
  yield* emitCleanupEvent({ stage: "complete", pid, signal: "SIGKILL" });
});
