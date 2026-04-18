import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  checkGeminiProviderStatus,
  resolveGeminiAuthFromEnvironment,
  resolveGeminiProviderProbeStatus,
} from "./GeminiProvider.ts";
import { ServerSettingsService } from "../../serverSettings";

const baseSettings = {
  enabled: true,
  binaryPath: "gemini",
  homePath: "",
  customModels: [],
};

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

function mockGeminiVersionSpawnerLayer() {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { args: ReadonlyArray<string> };
      const joined = cmd.args.join(" ");
      if (joined !== "--version") {
        return Effect.die(new Error(`Unexpected Gemini args: ${joined}`));
      }
      return Effect.succeed(mockHandle({ stdout: "0.38.0\n", stderr: "", code: 0 }));
    }),
  );
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withEnvAsync<T>(
  patch: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const clearGeminiAuthEnv = {
  CLOUD_SHELL: undefined,
  GEMINI_API_KEY: undefined,
  GEMINI_CLI_HOME: undefined,
  GEMINI_CLI_USE_COMPUTE_ADC: undefined,
  GOOGLE_API_KEY: undefined,
  GOOGLE_APPLICATION_CREDENTIALS: undefined,
  GOOGLE_CLOUD_LOCATION: undefined,
  GOOGLE_CLOUD_PROJECT: undefined,
  GOOGLE_CLOUD_PROJECT_ID: undefined,
} satisfies Record<string, string | undefined>;

describe("resolveGeminiAuthFromEnvironment", () => {
  it("detects configured Gemini API key auth", () =>
    withEnv(
      {
        GEMINI_API_KEY: "test",
        GOOGLE_API_KEY: undefined,
        GOOGLE_CLOUD_PROJECT: undefined,
      },
      () => {
        const auth = resolveGeminiAuthFromEnvironment(baseSettings);
        expect(auth.status).toBe("authenticated");
        expect(auth.type).toBe("api-key");
      },
    ));

  it("detects missing API key when Gemini API auth is selected", () => {
    const homePath = mkdtempSync(join(tmpdir(), "t3code-gemini-auth-"));
    writeFileSync(
      join(homePath, "settings.json"),
      JSON.stringify({ security: { auth: { selectedType: "USE_GEMINI" } } }),
    );

    return withEnv(
      {
        GEMINI_API_KEY: undefined,
        GOOGLE_API_KEY: undefined,
      },
      () => {
        const auth = resolveGeminiAuthFromEnvironment({ ...baseSettings, homePath });
        expect(auth.status).toBe("unauthenticated");
        expect(auth.label).toContain("GEMINI_API_KEY");
      },
    );
  });

  it("detects cached Google login auth", () => {
    const homePath = mkdtempSync(join(tmpdir(), "t3code-gemini-auth-"));
    writeFileSync(
      join(homePath, "settings.json"),
      JSON.stringify({ security: { auth: { selectedType: "LOGIN_WITH_GOOGLE" } } }),
    );
    writeFileSync(join(homePath, "oauth_creds.json"), JSON.stringify({ token: "redacted" }));
    writeFileSync(join(homePath, "google_accounts.json"), JSON.stringify({ email: "user@test" }));

    return withEnv(clearGeminiAuthEnv, () => {
      const auth = resolveGeminiAuthFromEnvironment({ ...baseSettings, homePath });
      expect(auth.status).toBe("authenticated");
      expect(auth.type).toBe("google-login");
      expect(auth.label).toBe("user@test");
    });
  });

  it("treats cached Google login credentials as authenticated even without selected auth settings", () => {
    const homePath = mkdtempSync(join(tmpdir(), "t3code-gemini-auth-"));
    writeFileSync(join(homePath, "oauth_creds.json"), JSON.stringify({ token: "redacted" }));
    writeFileSync(join(homePath, "google_accounts.json"), JSON.stringify({ email: "user@test" }));

    return withEnv(clearGeminiAuthEnv, () => {
      const auth = resolveGeminiAuthFromEnvironment({ ...baseSettings, homePath });
      expect(auth.status).toBe("authenticated");
      expect(auth.type).toBe("google-login");
      expect(auth.label).toBe("user@test");
    });
  });
});

describe("resolveGeminiProviderProbeStatus", () => {
  it("keeps authenticated Gemini ready", () => {
    const probe = resolveGeminiProviderProbeStatus({
      status: "authenticated",
      type: "api-key",
      label: "GEMINI_API_KEY",
    });

    expect(probe.status).toBe("ready");
    expect(probe.message).toBeUndefined();
  });

  it("downgrades missing Gemini auth from ready", () => {
    const probe = resolveGeminiProviderProbeStatus({
      status: "unauthenticated",
      type: "api-key",
      label: "Missing GEMINI_API_KEY",
    });

    expect(probe.status).toBe("error");
    expect(probe.message).toContain("Missing GEMINI_API_KEY");
  });

  it("keeps ambiguous Gemini auth as a warning with diagnostics", () => {
    const probe = resolveGeminiProviderProbeStatus({
      status: "unknown",
      type: "compute-adc",
      label: "Compute ADC",
    });

    expect(probe.status).toBe("warning");
    expect(probe.message).toContain("Compute ADC");
  });
});

describe("checkGeminiProviderStatus", () => {
  it("does not report installed Gemini as ready when auth is missing", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "t3code-gemini-auth-"));

    await withEnvAsync(clearGeminiAuthEnv, async () => {
      const provider = await Effect.runPromise(
        checkGeminiProviderStatus().pipe(
          Effect.provide(
            Layer.mergeAll(
              ServerSettingsService.layerTest({ providers: { gemini: { homePath } } }),
              mockGeminiVersionSpawnerLayer(),
            ),
          ),
        ),
      );

      expect(provider.installed).toBe(true);
      expect(provider.status).toBe("error");
      expect(provider.auth.status).toBe("unauthenticated");
      expect(provider.message).toContain("authentication is missing");
    });
  });

  it("reports cached Gemini OAuth credentials as ready with the auth source", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "t3code-gemini-auth-"));
    writeFileSync(join(homePath, "oauth_creds.json"), JSON.stringify({ token: "redacted" }));
    writeFileSync(join(homePath, "google_accounts.json"), JSON.stringify({ email: "user@test" }));

    await withEnvAsync(clearGeminiAuthEnv, async () => {
      const provider = await Effect.runPromise(
        checkGeminiProviderStatus().pipe(
          Effect.provide(
            Layer.mergeAll(
              ServerSettingsService.layerTest({ providers: { gemini: { homePath } } }),
              mockGeminiVersionSpawnerLayer(),
            ),
          ),
        ),
      );

      expect(provider.installed).toBe(true);
      expect(provider.status).toBe("ready");
      expect(provider.auth.status).toBe("authenticated");
      expect(provider.auth.type).toBe("google-login");
      expect(provider.auth.label).toBe("user@test");
      expect(provider.message).toBeUndefined();
    });
  });
});
