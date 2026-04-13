import { describe, expect, it } from "vitest";

import { buildRestEndpointSystemPrompt } from "./restEndpointSystemPrompt";

describe("buildRestEndpointSystemPrompt", () => {
  it("includes the ticket-link markdown reminder", () => {
    expect(buildRestEndpointSystemPrompt({ port: 3773, token: "token-123" })).toContain(
      "[ZBD-7](t3://ticket/ZBD-7)",
    );
  });
});
