import type { CursorSettings, RuntimeMode } from "@t3tools/contracts";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectStreamAsString } from "../providerSnapshot";
import {
  findCursorResultEvent,
  parseCursorStreamJsonChunks,
  type CursorResultEvent,
  type CursorStreamJsonEvent,
} from "./CursorStreamJson";
import { cleanupCursorProcessTree, type CursorProcessCleanupOptions } from "./CursorProcessTree";

export type CursorHeadlessMode = "plan" | "ask";
export type CursorSandboxMode = "enabled" | "disabled";

export interface CursorTurnCommandInput {
  readonly settings: CursorSettings;
  readonly cwd: string;
  readonly prompt: string;
  readonly runtimeMode: RuntimeMode;
  readonly resumeSessionId?: string;
  readonly model?: string;
  readonly headlessMode?: CursorHeadlessMode;
  readonly sandboxMode?: CursorSandboxMode;
  readonly trustWorkspace?: boolean;
  readonly streamPartialOutput?: boolean;
}

export interface CursorTurnCommandSpec {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly shell: boolean;
  readonly label: string;
}

export interface CursorTurnRunResult {
  readonly events: ReadonlyArray<CursorStreamJsonEvent>;
  readonly result: CursorResultEvent;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly usage?: CursorResultEvent["usage"];
  readonly exitCode: number;
  readonly stderr: string;
}

export interface CursorTurnRunnerOptions extends CursorProcessCleanupOptions {}

export type CursorTurnRunnerErrorKind =
  | "spawn"
  | "parse"
  | "process"
  | "missing-result"
  | "provider-result";

export class CursorTurnRunnerError extends Error {
  readonly kind: CursorTurnRunnerErrorKind;
  readonly exitCode: number | undefined;
  readonly stderr: string | undefined;
  override readonly cause: unknown;

  constructor(
    kind: CursorTurnRunnerErrorKind,
    message: string,
    options?: {
      readonly exitCode?: number;
      readonly stderr?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "CursorTurnRunnerError";
    this.kind = kind;
    this.exitCode = options?.exitCode;
    this.stderr = options?.stderr;
    this.cause = options?.cause;
  }
}

export function buildCursorTurnArgs(input: CursorTurnCommandInput): ReadonlyArray<string> {
  const args: string[] = ["--print", "--output-format", "stream-json", "--workspace", input.cwd];

  if (input.streamPartialOutput) {
    args.push("--stream-partial-output");
  }
  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.headlessMode) {
    args.push("--mode", input.headlessMode);
  }

  const sandboxMode =
    input.sandboxMode ?? (input.runtimeMode === "full-access" ? "disabled" : "enabled");
  if (input.runtimeMode === "full-access") {
    args.push("--force");
  }
  args.push("--sandbox", sandboxMode);

  if (input.trustWorkspace ?? true) {
    args.push("--trust");
  }

  args.push(input.prompt);
  return args;
}

export function buildCursorTurnEnv(
  settings: CursorSettings,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  Object.assign(env, settings.env);
  if (settings.homePath) env.HOME = settings.homePath;
  if (settings.configDir) env.CURSOR_CONFIG_DIR = settings.configDir;
  if (settings.dataDir) env.CURSOR_DATA_DIR = settings.dataDir;
  return env;
}

export function buildCursorTurnCommand(input: CursorTurnCommandInput): CursorTurnCommandSpec {
  const cursorArgs = buildCursorTurnArgs(input);
  const launchCommand = input.settings.launchCommand.filter((part) => part.trim().length > 0);
  const command = launchCommand.at(0) ?? input.settings.binaryPath;
  const args = launchCommand.length > 0 ? [...launchCommand.slice(1), ...cursorArgs] : cursorArgs;

  return {
    command,
    args,
    env: buildCursorTurnEnv(input.settings),
    cwd: input.cwd,
    shell: process.platform === "win32",
    label: command,
  };
}

export function commandFromCursorTurnSpec(spec: CursorTurnCommandSpec): ChildProcess.Command {
  return ChildProcess.make(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    shell: spec.shell,
    detached: process.platform !== "win32",
  });
}

function messageFromUnknown(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

function boundedStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= 2_000) return trimmed;
  return `${trimmed.slice(0, 2_000)}...`;
}

function resultFailureMessage(result: CursorResultEvent, stderr: string): string {
  if (result.result && result.result.trim()) return result.result.trim();
  const stderrDetail = boundedStderr(stderr);
  return stderrDetail || "Cursor returned an error result.";
}

function resolveCursorRunResult(input: {
  readonly events: ReadonlyArray<CursorStreamJsonEvent>;
  readonly exitCode: number;
  readonly stderr: string;
}): CursorTurnRunResult {
  const result = findCursorResultEvent(input.events);
  if (input.exitCode !== 0) {
    throw new CursorTurnRunnerError(
      "process",
      boundedStderr(input.stderr) || `Cursor exited with code ${input.exitCode}.`,
      { exitCode: input.exitCode, stderr: input.stderr },
    );
  }
  if (!result) {
    throw new CursorTurnRunnerError(
      "missing-result",
      boundedStderr(input.stderr) || "Cursor stream ended without a terminal result event.",
      { exitCode: input.exitCode, stderr: input.stderr },
    );
  }
  if (result.isError || (result.subtype !== undefined && result.subtype !== "success")) {
    throw new CursorTurnRunnerError("provider-result", resultFailureMessage(result, input.stderr), {
      exitCode: input.exitCode,
      stderr: input.stderr,
    });
  }
  if (!result.sessionId) {
    throw new CursorTurnRunnerError(
      "missing-result",
      "Cursor result event did not include a session_id.",
      { exitCode: input.exitCode, stderr: input.stderr },
    );
  }

  return {
    events: input.events,
    result,
    sessionId: result.sessionId,
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    exitCode: input.exitCode,
    stderr: input.stderr,
  };
}

export function resolveCursorTurnRunResult(input: {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}): CursorTurnRunResult {
  let events: ReadonlyArray<CursorStreamJsonEvent>;
  try {
    events = parseCursorStreamJsonChunks([input.stdout]);
  } catch (cause) {
    throw new CursorTurnRunnerError(
      "parse",
      messageFromUnknown(cause, "Failed to parse Cursor stream-json output."),
      { exitCode: input.exitCode, stderr: input.stderr, cause },
    );
  }

  return resolveCursorRunResult({
    events,
    exitCode: input.exitCode,
    stderr: input.stderr,
  });
}

export const runCursorTurn = (
  input: CursorTurnCommandInput,
  options: CursorTurnRunnerOptions = {},
) =>
  Effect.gen(function* () {
    const spec = buildCursorTurnCommand(input);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner
      .spawn(commandFromCursorTurnSpec(spec))
      .pipe(
        Effect.mapError(
          (cause) =>
            new CursorTurnRunnerError(
              "spawn",
              messageFromUnknown(cause, `Failed to spawn Cursor command ${spec.label}.`),
              { cause },
            ),
        ),
      );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.onInterrupt(() =>
        cleanupCursorProcessTree(Number(child.pid), {
          ...(options.graceMs !== undefined ? { graceMs: options.graceMs } : {}),
          ...(options.processTreeTerminator
            ? { processTreeTerminator: options.processTreeTerminator }
            : {}),
          ...(options.isProcessRunning ? { isProcessRunning: options.isProcessRunning } : {}),
          ...(options.onCleanupEvent ? { onCleanupEvent: options.onCleanupEvent } : {}),
        }),
      ),
    );

    return yield* Effect.try({
      try: () => resolveCursorTurnRunResult({ stdout, stderr, exitCode }),
      catch: (cause) =>
        cause instanceof CursorTurnRunnerError
          ? cause
          : new CursorTurnRunnerError(
              "parse",
              messageFromUnknown(cause, "Failed to parse Cursor stream-json output."),
              { cause },
            ),
    });
  }).pipe(Effect.scoped);

export const streamCursorTurnEvents = (input: CursorTurnCommandInput) =>
  Stream.fromEffect(runCursorTurn(input)).pipe(
    Stream.flatMap((result) => Stream.fromIterable(result.events)),
  );
