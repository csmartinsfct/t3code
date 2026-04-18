import { describe, expect, it } from "vitest";

import { buildGeminiAcpArgs, buildGeminiAcpEnv } from "./GeminiAcpConnection";

describe("GeminiAcpConnection", () => {
  it("builds full-access ACP launch arguments", () => {
    expect(
      buildGeminiAcpArgs({
        binaryPath: "gemini",
        approvalMode: "yolo",
        sandbox: false,
      }),
    ).toEqual(["--acp", "--approval-mode", "yolo", "--no-sandbox"]);
  });

  it("builds supervised ACP launch arguments", () => {
    expect(
      buildGeminiAcpArgs({
        binaryPath: "gemini",
        approvalMode: "default",
      }),
    ).toEqual(["--acp", "--approval-mode", "default"]);
  });

  it("overrides inherited Gemini sandbox environment when sandbox is disabled", () => {
    expect(
      buildGeminiAcpEnv(
        {
          binaryPath: "gemini",
          homePath: "/tmp/gemini-home",
          sandbox: false,
        },
        { GEMINI_SANDBOX: "true", EXISTING: "1" },
      ),
    ).toMatchObject({
      EXISTING: "1",
      GEMINI_CLI_HOME: "/tmp/gemini-home",
      GEMINI_SANDBOX: "false",
    });
  });
});
