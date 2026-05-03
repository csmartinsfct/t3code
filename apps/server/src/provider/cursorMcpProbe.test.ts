import { describe, expect, it } from "vitest";

import { buildCursorMcpCommand, parseCursorMcpListOutput } from "./cursorMcpProbe.ts";

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
    expect(
      buildCursorMcpCommand({
        enabled: true,
        binaryPath: "agent",
        launchCommand: [],
        homePath: "",
        configDir: "",
        dataDir: "",
        env: {},
        customModels: [],
      }),
    ).toEqual({ command: "agent", args: ["mcp", "list"] });
  });

  it("appends the MCP subcommand to launch-command profiles", () => {
    expect(
      buildCursorMcpCommand({
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
});
