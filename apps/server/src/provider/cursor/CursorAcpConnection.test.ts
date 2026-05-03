import { describe, expect, it } from "vitest";

import { buildCursorAcpCommand, buildCursorAcpEnv } from "./CursorAcpConnection";

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
});
