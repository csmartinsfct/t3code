import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { runProcess } from "../processRunner.ts";

import {
  buildCursorMcpActionCommand,
  buildCursorMcpListCommand,
  cursorMcpApprovalKey,
  cursorProjectSlug,
  parseCursorMcpListOutput,
  runCursorMcpAction,
} from "./cursorMcpProbe.ts";

vi.mock("../processRunner.ts", () => ({
  runProcess: vi.fn(),
}));

const SETTINGS = {
  enabled: true,
  binaryPath: "agent",
  launchCommand: [],
  homePath: "",
  configDir: "",
  dataDir: "",
  env: {},
  customModels: [],
};

function processResult(stdout: string) {
  return {
    stdout,
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
  };
}

const runProcessMock = vi.mocked(runProcess);

beforeEach(() => {
  runProcessMock.mockReset();
});

describe("parseCursorMcpListOutput", () => {
  it("parses Cursor MCP names and approval status", () => {
    expect(
      parseCursorMcpListOutput(`
iant: not loaded (needs approval)
playwright: not loaded (needs approval)
zbd: connected
      `).map((server) => [server.name, server.status]),
    ).toEqual([
      ["iant", "not loaded (needs approval)"],
      ["playwright", "not loaded (needs approval)"],
      ["zbd", "connected"],
    ]);
  });

  it("ignores blank and malformed lines", () => {
    expect(
      parseCursorMcpListOutput(`

not a status line
linear: not loaded (needs approval)
      `),
    ).toEqual([{ name: "linear", status: "not loaded (needs approval)" }]);
  });
});

describe("buildCursorMcpCommand", () => {
  it("uses the configured binary path by default", () => {
    expect(buildCursorMcpListCommand(SETTINGS)).toEqual({
      command: "agent",
      args: ["mcp", "list"],
    });
  });

  it("appends the MCP subcommand to launch-command profiles", () => {
    expect(
      buildCursorMcpListCommand({
        enabled: true,
        binaryPath: "agent",
        launchCommand: ["cursor-metric", "--flag"],
        homePath: "",
        configDir: "",
        dataDir: "",
        env: {},
        customModels: [],
      }),
    ).toEqual({ command: "cursor-metric", args: ["--flag", "mcp", "list"] });
  });

  it("builds Cursor MCP approval and login commands", () => {
    expect(buildCursorMcpActionCommand(SETTINGS, "approve", "playwright")).toEqual({
      command: "agent",
      args: ["mcp", "enable", "playwright"],
    });
    expect(buildCursorMcpActionCommand(SETTINGS, "login", "linear")).toEqual({
      command: "agent",
      args: ["mcp", "login", "linear"],
    });
  });
});

describe("Cursor MCP project approvals", () => {
  it("matches Cursor's project slug shape", () => {
    expect(cursorProjectSlug("/Users/me/Desktop/T3 Code")).toBe("Users-me-Desktop-T3-Code");
  });

  it("builds stable project approval keys from the exact server config", () => {
    expect(
      cursorMcpApprovalKey({
        cwd: "/Users/me/project",
        serverName: "playwright",
        serverConfig: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
      }),
    ).toBe("playwright-1a32ef73f6176982");
  });

  it("adds an approval key to Cursor's project approval file after CLI approval", async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-cursor-mcp-"));
    const cursorConfigDir = path.join(tempDir, ".cursor-home");
    const cwd = path.join(tempDir, "workspace");
    await fs.mkdir(cursorConfigDir, { recursive: true });
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(
      path.join(cursorConfigDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
        },
      }),
    );
    runProcessMock.mockResolvedValueOnce(processResult("MCP server 'playwright' approved"));

    try {
      await runCursorMcpAction({
        settings: { ...SETTINGS, configDir: cursorConfigDir },
        cwd,
        action: "approve",
        identifier: "playwright",
      });

      const approvalPath = path.join(
        cursorConfigDir,
        "projects",
        cursorProjectSlug(cwd),
        "mcp-approvals.json",
      );
      const approvals = JSON.parse(await fs.readFile(approvalPath, "utf8")) as unknown;
      expect(approvals).toEqual([
        cursorMcpApprovalKey({
          cwd,
          serverName: "playwright",
          serverConfig: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
        }),
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
