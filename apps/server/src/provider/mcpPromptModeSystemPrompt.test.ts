import { describe, expect, it } from "vitest";

import { buildMcpPromptModeSystemPrompt } from "./mcpPromptModeSystemPrompt";

describe("buildMcpPromptModeSystemPrompt", () => {
  it("includes the ticket-link markdown reminder", () => {
    expect(buildMcpPromptModeSystemPrompt({ port: 3773, token: "token-123" })).toContain(
      "[ZBD-7](t3://ticket/ZBD-7)",
    );
  });
});
