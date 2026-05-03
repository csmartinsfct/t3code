import { describe, expect, it } from "vitest";

import {
  buildCursorMcpActionCommand,
  buildCursorMcpListCommand,
  parseCursorMcpListOutput,
} from "./cursorMcpProbe.ts";

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
      buildCursorMcpListCommand({
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
    const settings = {
      enabled: true,
      binaryPath: "agent",
      launchCommand: [],
      homePath: "",
      configDir: "",
      dataDir: "",
      env: {},
      customModels: [],
    };

    expect(buildCursorMcpActionCommand(settings, "approve", "playwright")).toEqual({
      command: "agent",
      args: ["mcp", "enable", "playwright"],
    });
    expect(buildCursorMcpActionCommand(settings, "login", "linear")).toEqual({
      command: "agent",
      args: ["mcp", "login", "linear"],
    });
  });
});
