import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveGeminiAuthFromEnvironment } from "./GeminiProvider.ts";

const baseSettings = {
  enabled: true,
  binaryPath: "gemini",
  homePath: "",
  customModels: [],
};

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

    const auth = resolveGeminiAuthFromEnvironment({ ...baseSettings, homePath });
    expect(auth.status).toBe("authenticated");
    expect(auth.type).toBe("google-login");
    expect(auth.label).toBe("user@test");
  });
});
