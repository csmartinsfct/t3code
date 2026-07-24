import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  consumeCodexRateLimitResetCreditWithAppServer,
  requestCodexAppServer,
} from "./codexAppServer";

const tempDirs: string[] = [];

function makeFakeCodexAppServer(source: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "t3-codex-app-server-"));
  tempDirs.push(dir);
  const binaryPath = path.join(dir, "codex.cjs");
  writeFileSync(binaryPath, `#!/usr/bin/env node\n${source}`);
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("one-shot Codex app-server requests", () => {
  it("times out and force-terminates an app-server that ignores SIGTERM", async () => {
    const processDir = mkdtempSync(path.join(os.tmpdir(), "t3-codex-process-"));
    tempDirs.push(processDir);
    const pidPath = path.join(processDir, "pid");
    const termPath = path.join(processDir, "sigterm");
    const binaryPath = makeFakeCodexAppServer(`
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.on("SIGTERM", () => {
  writeFileSync(${JSON.stringify(termPath)}, "received");
});
setInterval(() => {}, 1000);
`);

    await expect(
      requestCodexAppServer({
        binaryPath,
        method: "account/rateLimits/read",
        params: null,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("Timed out waiting for account/rateLimits/read.");

    const pid = Number(readFileSync(pidPath, "utf8"));
    if (process.platform !== "win32") {
      expect(readFileSync(termPath, "utf8")).toBe("received");
    }
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("keeps a successful consume result when the follow-up refresh times out", async () => {
    const binaryPath = makeFakeCodexAppServer(`
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 1) {
    process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  } else if (message.method === "account/rateLimitResetCredit/consume") {
    process.stdout.write(JSON.stringify({ id: 2, result: { outcome: "reset" } }) + "\\n");
  }
});
`);

    const result = await consumeCodexRateLimitResetCreditWithAppServer({
      binaryPath,
      idempotencyKey: "attempt-1",
      // Leave enough room for process startup when the suite runs in parallel;
      // the second one-shot process intentionally never answers.
      timeoutMs: 1_000,
    });

    expect(result.outcome).toBe("reset");
    expect(result.refreshError).toContain("Timed out waiting for account/rateLimits/read.");
  });
});
