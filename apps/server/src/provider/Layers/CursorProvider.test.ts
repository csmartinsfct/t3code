import { describe, expect, it } from "vitest";
import { Effect, Layer, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  checkCursorProviderStatus,
  parseCursorAboutJson,
  parseCursorAuthFromStatusOutput,
  parseCursorModelsOutput,
} from "./CursorProvider";
import { ServerSettingsService } from "../../serverSettings";

const encoder = new TextEncoder();

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

describe("parseCursorAboutJson", () => {
  it("parses Cursor about JSON without requiring account secrets", () => {
    expect(
      parseCursorAboutJson(
        JSON.stringify({
          cliVersion: "2026.05.01-eea359f",
          model: "composer-2-fast",
          subscriptionTier: "Pro",
          userEmail: "redacted@example.com",
        }),
      ),
    ).toMatchObject({
      cliVersion: "2026.05.01-eea359f",
      model: "composer-2-fast",
      subscriptionTier: "Pro",
    });
  });

  it("returns null for non-JSON output", () => {
    expect(parseCursorAboutJson("logged in")).toBeNull();
  });
});

describe("parseCursorModelsOutput", () => {
  it("parses Cursor model list rows and strips current/default annotations", () => {
    const models = parseCursorModelsOutput(`
Available models
auto - Auto
composer-2-fast - Composer 2 Fast (current, default)
sonnet-4-thinking - Sonnet 4 Thinking (default)
Tip: use --model <id> to select a model
`);

    expect(models.map((model) => [model.slug, model.name])).toEqual([
      ["auto", "Auto"],
      ["composer-2-fast", "Composer 2 Fast"],
      ["sonnet-4-thinking", "Sonnet 4 Thinking"],
    ]);
  });
});

describe("parseCursorAuthFromStatusOutput", () => {
  it("detects logged-in status output", () => {
    const auth = parseCursorAuthFromStatusOutput({
      stdout: "Logged in as user@example.com\n",
      stderr: "",
      code: 0,
    });

    expect(auth.status).toBe("ready");
    expect(auth.auth.status).toBe("authenticated");
    expect(auth.auth.label).toBe("Cursor login");
  });

  it("detects missing login status output", () => {
    const auth = parseCursorAuthFromStatusOutput({
      stdout: "Not logged in. Run agent login.\n",
      stderr: "",
      code: 1,
    });

    expect(auth.status).toBe("error");
    expect(auth.auth.status).toBe("unauthenticated");
    expect(auth.message).toContain("agent login");
  });

  it("does not mistake not-authenticated output for authenticated status", () => {
    const auth = parseCursorAuthFromStatusOutput({
      stdout: "Cursor CLI is not authenticated.\n",
      stderr: "",
      code: 1,
    });

    expect(auth.status).toBe("error");
    expect(auth.auth.status).toBe("unauthenticated");
  });
});

describe("checkCursorProviderStatus", () => {
  it("reports ready when Cursor CLI version, account, and models are available", async () => {
    const provider = await Effect.runPromise(
      checkCursorProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettingsService.layerTest({
              providers: {
                cursor: {
                  enabled: true,
                  customModels: ["custom-cursor-model"],
                },
              },
            }),
            mockCursorSpawnerLayer((_command, args) => {
              const joined = args.join(" ");
              if (joined === "--version") {
                return { stdout: "2026.05.01-eea359f\n", stderr: "", code: 0 };
              }
              if (joined === "models") {
                return {
                  stdout:
                    "Available models\nauto - Auto\ncomposer-2-fast - Composer 2 Fast (current, default)\n",
                  stderr: "",
                  code: 0,
                };
              }
              if (joined === "about --format json") {
                return {
                  stdout: JSON.stringify({
                    cliVersion: "2026.05.01-eea359f",
                    subscriptionTier: "Pro",
                  }),
                  stderr: "",
                  code: 0,
                };
              }
              throw new Error(`Unexpected Cursor args: ${joined}`);
            }),
          ),
        ),
      ),
    );

    expect(provider.provider).toBe("cursor");
    expect(provider.status).toBe("ready");
    expect(provider.installed).toBe(true);
    expect(provider.version).toBe("2026.05.01-eea359f");
    expect(provider.auth.status).toBe("authenticated");
    expect(provider.auth.label).toBe("Cursor Pro");
    expect(provider.models.some((model) => model.slug === "custom-cursor-model")).toBe(true);
  });

  it("keeps Cursor usable with a warning when model listing fails", async () => {
    const provider = await Effect.runPromise(
      checkCursorProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettingsService.layerTest({ providers: { cursor: { enabled: true } } }),
            mockCursorSpawnerLayer((_command, args) => {
              const joined = args.join(" ");
              if (joined === "--version") {
                return { stdout: "2026.05.01-eea359f\n", stderr: "", code: 0 };
              }
              if (joined === "models") {
                return { stdout: "", stderr: "models unavailable", code: 1 };
              }
              if (joined === "about --format json") {
                return {
                  stdout: JSON.stringify({ subscriptionTier: "Pro" }),
                  stderr: "",
                  code: 0,
                };
              }
              throw new Error(`Unexpected Cursor args: ${joined}`);
            }),
          ),
        ),
      ),
    );

    expect(provider.installed).toBe(true);
    expect(provider.status).toBe("warning");
    expect(provider.auth.status).toBe("authenticated");
    expect(provider.message).toContain("models unavailable");
    expect(provider.models.some((model) => model.slug === "composer-2-fast")).toBe(true);
  });

  it("falls back to status when about JSON cannot verify auth", async () => {
    const provider = await Effect.runPromise(
      checkCursorProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettingsService.layerTest({ providers: { cursor: { enabled: true } } }),
            mockCursorSpawnerLayer((_command, args) => {
              const joined = args.join(" ");
              if (joined === "--version") {
                return { stdout: "2026.05.01-eea359f\n", stderr: "", code: 0 };
              }
              if (joined === "models") {
                return { stdout: "auto - Auto\n", stderr: "", code: 0 };
              }
              if (joined === "about --format json") {
                return { stdout: "not json", stderr: "", code: 0 };
              }
              if (joined === "status") {
                return { stdout: "Logged in as user@example.com\n", stderr: "", code: 0 };
              }
              throw new Error(`Unexpected Cursor args: ${joined}`);
            }),
          ),
        ),
      ),
    );

    expect(provider.status).toBe("ready");
    expect(provider.auth.status).toBe("authenticated");
    expect(provider.auth.label).toBe("Cursor login");
  });

  it("reports missing Cursor CLI without crashing discovery", async () => {
    const provider = await Effect.runPromise(
      checkCursorProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettingsService.layerTest({ providers: { cursor: { enabled: true } } }),
            missingBinarySpawnerLayer(),
          ),
        ),
      ),
    );

    expect(provider.status).toBe("error");
    expect(provider.installed).toBe(false);
    expect(provider.auth.status).toBe("unknown");
    expect(provider.message).toContain("Cursor CLI not found");
  });

  it("passes configured launch commands through a profile wrapper", async () => {
    const seenCommands: string[] = [];
    const provider = await Effect.runPromise(
      checkCursorProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettingsService.layerTest({
              providers: {
                cursor: {
                  enabled: true,
                  launchCommand: ["bash", "-lc", 'cursor-metric "$@"', "cursor-metric"],
                },
              },
            }),
            mockCursorSpawnerLayer((command, args) => {
              seenCommands.push(`${command} ${args.join(" ")}`);
              const cursorArgs = args.slice(3).join(" ");
              if (cursorArgs === "--version") {
                return { stdout: "2026.05.01-eea359f\n", stderr: "", code: 0 };
              }
              if (cursorArgs === "models") {
                return { stdout: "auto - Auto\n", stderr: "", code: 0 };
              }
              if (cursorArgs === "about --format json") {
                return {
                  stdout: JSON.stringify({ subscriptionTier: "Pro" }),
                  stderr: "",
                  code: 0,
                };
              }
              throw new Error(`Unexpected Cursor wrapper args: ${args.join(" ")}`);
            }),
          ),
        ),
      ),
    );

    expect(provider.status).toBe("ready");
    expect(seenCommands[0]).toBe('bash -lc cursor-metric "$@" cursor-metric --version');
  });
});
