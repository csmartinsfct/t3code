import { describe, expect, it } from "vitest";

import { buildRestEndpointSystemPrompt } from "./restEndpointSystemPrompt";

describe("buildRestEndpointSystemPrompt", () => {
  it("includes the ticket-link markdown reminder", () => {
    expect(buildRestEndpointSystemPrompt({ port: 3773, token: "token-123" })).toContain(
      "[ZBD-7](t3://ticket/ZBD-7)",
    );
  });

  it("keeps the rest-only guidance by default", () => {
    const prompt = buildRestEndpointSystemPrompt({ port: 3773, token: "token-123" });

    expect(prompt).toContain("no dedicated tools are registered");
    expect(prompt).toContain("curl -s <ENDPOINT_URL>");
  });

  it("describes native internal tools without removing REST fallback details", () => {
    const prompt = buildRestEndpointSystemPrompt({
      port: 3773,
      token: "token-123",
      nativeInternalTools: true,
    });

    expect(prompt).toContain("Dedicated T3 MCP tools may be registered");
    expect(prompt).toContain("REST endpoints below remain available as fallback");
    expect(prompt).not.toContain("no dedicated tools are registered");
    expect(prompt).toContain("curl -s <ENDPOINT_URL>");
  });
});
