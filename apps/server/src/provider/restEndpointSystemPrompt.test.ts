import { describe, expect, it } from "vitest";

import { buildRestEndpointSystemPrompt } from "./restEndpointSystemPrompt";

describe("buildRestEndpointSystemPrompt", () => {
  it("includes the ticket-link markdown reminder", () => {
    expect(buildRestEndpointSystemPrompt({ port: 3773, token: "token-123" })).toContain(
      "[ZBD-7](t3://ticket/ZBD-7)",
    );
  });

  it("gives all providers the same REST-via-curl guidance", () => {
    const prompt = buildRestEndpointSystemPrompt({ port: 3773, token: "token-123" });

    expect(prompt).toContain("no dedicated tools are registered");
    expect(prompt).toContain("curl -s <ENDPOINT_URL>");
    // Legacy native-tools wording must be gone now that the three adapters
    // share a single REST-via-curl injection path.
    expect(prompt).not.toContain("Dedicated T3 MCP tools may be registered");
    expect(prompt).not.toContain("REST endpoints below remain available as fallback");
  });
});
