import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildCursorAcpCommand,
  buildCursorAcpEnv,
  createCursorAcpConnection,
  type CursorAcpIncomingRequest,
} from "./CursorAcpConnection";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const harnessPath = path.join(repoRoot, "scripts/cursor-acp-harness.mjs");

describe("CursorAcpConnection", () => {
  it("launches the configured Cursor binary in ACP mode", () => {
    expect(
      buildCursorAcpCommand({
        enabled: true,
        binaryPath: "agent",
        launchCommand: [],
        homePath: "",
        configDir: "",
        dataDir: "",
        env: {},
        customModels: [],
      }),
    ).toEqual({ command: "agent", args: ["acp"] });
  });

  it("passes ACP mode through configured launch wrappers", () => {
    expect(
      buildCursorAcpCommand({
        enabled: true,
        binaryPath: "agent",
        launchCommand: ["/opt/bin/cursor-wrapper", "--profile", "metric"],
        homePath: "",
        configDir: "",
        dataDir: "",
        env: {},
        customModels: [],
      }),
    ).toEqual({
      command: "/opt/bin/cursor-wrapper",
      args: ["--profile", "metric", "acp"],
    });
  });

  it("builds explicit Cursor profile environment without touching ambient keychains", () => {
    expect(
      buildCursorAcpEnv(
        {
          enabled: true,
          binaryPath: "agent",
          launchCommand: [],
          homePath: "/tmp/cursor-home",
          configDir: "/tmp/cursor-home/.cursor",
          dataDir: "/tmp/cursor-home/.cursor-data",
          env: { CURSOR_AUTH_TOKEN: "token" },
          customModels: [],
        },
        { PATH: "/bin" },
      ),
    ).toMatchObject({
      PATH: "/bin",
      HOME: "/tmp/cursor-home",
      CURSOR_CONFIG_DIR: "/tmp/cursor-home/.cursor",
      CURSOR_DATA_DIR: "/tmp/cursor-home/.cursor-data",
      CURSOR_AUTH_TOKEN: "token",
    });
  });

  it.each([
    {
      scenario: "ask-question",
      prompt: "T3_CURSOR_HARNESS_ASK_QUESTION",
      method: "cursor/ask_question",
      response: {
        outcome: {
          outcome: "answered",
          answers: [{ questionId: "next_step", selectedOptionIds: ["continue"] }],
        },
      },
    },
    {
      scenario: "file-approval",
      prompt: "T3_CURSOR_HARNESS_FILE_APPROVAL",
      method: "session/request_permission",
      response: { outcome: { outcome: "selected", optionId: "allow-once" } },
    },
  ])("round-trips deterministic Cursor ACP $scenario harness requests", async (fixture) => {
    const requests: CursorAcpIncomingRequest[] = [];
    const stderr: string[] = [];
    const connection = createCursorAcpConnection({
      cwd: repoRoot,
      requestTimeoutMs: 5_000,
      promptRequestTimeoutMs: 5_000,
      settings: {
        enabled: true,
        binaryPath: "agent",
        launchCommand: [process.execPath, harnessPath],
        homePath: "",
        configDir: "",
        dataDir: "",
        env: {},
        customModels: [],
      },
      onRequest: (request) => {
        requests.push(request);
        connection.respond({ id: request.id, result: fixture.response });
      },
      onStderr: (line) => {
        stderr.push(line);
      },
    });

    try {
      await connection.initialize();
      await connection.authenticate();
      const session = await connection.newSession({ cwd: repoRoot });
      const result = await connection.prompt({
        sessionId: session.sessionId,
        text: fixture.prompt,
      });

      expect(result).toEqual({ stopReason: "end_turn" });
      expect(stderr).toEqual([]);
      expect(requests.map((request) => request.method)).toContain(fixture.method);
    } finally {
      connection.close();
    }
  });
});
