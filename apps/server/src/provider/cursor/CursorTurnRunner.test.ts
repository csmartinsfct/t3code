import type { CursorSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { Effect, Fiber, Layer, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  buildCursorTurnArgs,
  buildCursorTurnCommand,
  buildCursorTurnEnv,
  commandFromCursorTurnSpec,
  CursorTurnRunnerError,
  resolveCursorTurnRunResult,
  runCursorTurn,
} from "./CursorTurnRunner";

const encoder = new TextEncoder();

const baseSettings: CursorSettings = {
  enabled: true,
  binaryPath: "agent",
  launchCommand: [],
  homePath: "",
  configDir: "",
  dataDir: "",
  env: {},
  customModels: [],
};

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockRunningHandle(pid = 1) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(pid),
    exitCode: Effect.never,
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockCursorSpawnerLayer(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout: string; stderr: string; code: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { command: string; args: ReadonlyArray<string> };
      return Effect.succeed(mockHandle(handler(cmd.command, cmd.args)));
    }),
  );
}

function missingBinarySpawnerLayer() {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description: "spawn agent ENOENT",
        }),
      ),
    ),
  );
}

function successStdout(sessionId = "session-1") {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
      cwd: "/repo",
      model: "Auto",
      permissionMode: "default",
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      session_id: sessionId,
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      session_id: sessionId,
      request_id: "request-1",
      usage: { inputTokens: 10, outputTokens: 2 },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
}

describe("buildCursorTurnArgs", () => {
  it("builds default approval-required args without force", () => {
    expect(
      buildCursorTurnArgs({
        settings: baseSettings,
        cwd: "/repo",
        prompt: "hello",
        runtimeMode: "approval-required",
      }),
    ).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--workspace",
      "/repo",
      "--sandbox",
      "enabled",
      "--trust",
      "hello",
    ]);
  });

  it("builds full-access resume/model/plan args with partial output", () => {
    expect(
      buildCursorTurnArgs({
        settings: baseSettings,
        cwd: "/repo",
        prompt: "plan this",
        runtimeMode: "full-access",
        resumeSessionId: "session-1",
        model: "sonnet-4-thinking",
        headlessMode: "plan",
        streamPartialOutput: true,
      }),
    ).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--workspace",
      "/repo",
      "--stream-partial-output",
      "--resume",
      "session-1",
      "--model",
      "sonnet-4-thinking",
      "--mode",
      "plan",
      "--force",
      "--sandbox",
      "disabled",
      "--trust",
      "plan this",
    ]);
  });

  it("supports ask mode and explicit sandbox/trust choices", () => {
    expect(
      buildCursorTurnArgs({
        settings: baseSettings,
        cwd: "/repo",
        prompt: "explain",
        runtimeMode: "full-access",
        headlessMode: "ask",
        sandboxMode: "enabled",
        trustWorkspace: false,
      }),
    ).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--workspace",
      "/repo",
      "--mode",
      "ask",
      "--force",
      "--sandbox",
      "enabled",
      "explain",
    ]);
  });
});

describe("buildCursorTurnCommand", () => {
  it("builds env with profile paths and Cursor-specific env", () => {
    const env = buildCursorTurnEnv(
      {
        ...baseSettings,
        homePath: "/profiles/metric",
        configDir: "/profiles/metric/.cursor",
        dataDir: "/profiles/metric/.cursor-data",
        env: { CURSOR_API_KEY: "redacted", KEEP: "profile" },
      },
      { KEEP: "base", PATH: "/bin", OMIT: undefined },
    );

    expect(env).toMatchObject({
      PATH: "/bin",
      KEEP: "profile",
      CURSOR_API_KEY: "redacted",
      HOME: "/profiles/metric",
      CURSOR_CONFIG_DIR: "/profiles/metric/.cursor",
      CURSOR_DATA_DIR: "/profiles/metric/.cursor-data",
    });
    expect(env).not.toHaveProperty("OMIT");
  });

  it("wraps args in launchCommand for shell-function profiles", () => {
    const command = buildCursorTurnCommand({
      settings: {
        ...baseSettings,
        launchCommand: ["bash", "-lc", 'cursor-metric "$@"', "cursor-metric"],
      },
      cwd: "/repo",
      prompt: "hello",
      runtimeMode: "approval-required",
    });

    expect(command.command).toBe("bash");
    expect(command.args).toEqual([
      "-lc",
      'cursor-metric "$@"',
      "cursor-metric",
      "--print",
      "--output-format",
      "stream-json",
      "--workspace",
      "/repo",
      "--sandbox",
      "enabled",
      "--trust",
      "hello",
    ]);
  });

  it("builds a detached process command on POSIX so cleanup can signal the process group", () => {
    const spec = buildCursorTurnCommand({
      settings: baseSettings,
      cwd: "/repo",
      prompt: "hello",
      runtimeMode: "approval-required",
    });
    const command = commandFromCursorTurnSpec(spec) as unknown as {
      options: { detached?: boolean };
    };

    expect(command.options.detached).toBe(process.platform !== "win32");
  });
});

describe("resolveCursorTurnRunResult", () => {
  it("returns session, request, usage, stderr, and parsed events", () => {
    const result = resolveCursorTurnRunResult({
      stdout: successStdout("session-123"),
      stderr: "minor warning\n",
      exitCode: 0,
    });

    expect(result.sessionId).toBe("session-123");
    expect(result.requestId).toBe("request-1");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(result.stderr).toBe("minor warning\n");
    expect(result.events).toHaveLength(3);
  });

  it("throws a parse error for malformed stream-json", () => {
    expect(() =>
      resolveCursorTurnRunResult({
        stdout: "not-json\n",
        stderr: "",
        exitCode: 0,
      }),
    ).toThrow(CursorTurnRunnerError);
  });

  it("throws when Cursor exits non-zero before terminal result", () => {
    expect(() =>
      resolveCursorTurnRunResult({
        stdout: "",
        stderr: "quota exhausted",
        exitCode: 1,
      }),
    ).toThrow(/quota exhausted/);
  });

  it("throws when terminal result is missing", () => {
    expect(() =>
      resolveCursorTurnRunResult({
        stdout: JSON.stringify({ type: "assistant", session_id: "session-1" }),
        stderr: "",
        exitCode: 0,
      }),
    ).toThrow(/terminal result/);
  });

  it("throws when Cursor result reports an error", () => {
    expect(() =>
      resolveCursorTurnRunResult({
        stdout: JSON.stringify({
          type: "result",
          subtype: "error",
          is_error: true,
          result: "provider failed",
          session_id: "session-1",
        }),
        stderr: "",
        exitCode: 0,
      }),
    ).toThrow(/provider failed/);
  });
});

describe("runCursorTurn", () => {
  it("spawns Cursor and returns parsed final metadata", async () => {
    const result = await Effect.runPromise(
      runCursorTurn({
        settings: baseSettings,
        cwd: "/repo",
        prompt: "hello",
        runtimeMode: "approval-required",
      }).pipe(
        Effect.provide(
          mockCursorSpawnerLayer((command, args) => {
            expect(command).toBe("agent");
            expect(args.at(-1)).toBe("hello");
            return { stdout: successStdout("session-runner"), stderr: "", code: 0 };
          }),
        ),
      ),
    );

    expect(result.sessionId).toBe("session-runner");
    expect(result.result.result).toBe("done");
  });

  it("reports spawn failures as CursorTurnRunnerError", async () => {
    const exit = await Effect.runPromiseExit(
      runCursorTurn({
        settings: baseSettings,
        cwd: "/repo",
        prompt: "hello",
        runtimeMode: "approval-required",
      }).pipe(Effect.provide(missingBinarySpawnerLayer())),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("CursorTurnRunnerError");
    }
  });

  it("cleans up the Cursor process tree when interrupted", async () => {
    const signals: Array<{ pid: number; signal: "SIGINT" | "SIGTERM" | "SIGKILL" }> = [];
    const cleanupStages: string[] = [];
    const layer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.succeed(mockRunningHandle(123))),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(
          runCursorTurn(
            {
              settings: baseSettings,
              cwd: "/repo",
              prompt: "sleep please",
              runtimeMode: "full-access",
            },
            {
              graceMs: 0,
              processTreeTerminator: (pid, signal) =>
                Effect.sync(() => {
                  signals.push({ pid, signal });
                }),
              isProcessRunning: () => true,
              onCleanupEvent: (event) =>
                Effect.sync(() => {
                  cleanupStages.push(event.stage);
                }),
            },
          ).pipe(Effect.provide(layer)),
          { startImmediately: true },
        );
        yield* Effect.sleep("10 millis");
        yield* Fiber.interrupt(fiber);
      }),
    );

    expect(signals).toEqual([
      { pid: 123, signal: "SIGINT" },
      { pid: 123, signal: "SIGTERM" },
      { pid: 123, signal: "SIGKILL" },
    ]);
    expect(cleanupStages).toEqual(["signal", "escalating", "force_kill", "complete"]);
  });
});
