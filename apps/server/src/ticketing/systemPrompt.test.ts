import { describe, expect, it } from "vitest";

import { TICKETING_SYSTEM_PROMPT } from "./systemPrompt";

describe("TICKETING_SYSTEM_PROMPT", () => {
  it("instructs agents to emit clickable ticket markdown", () => {
    expect(TICKETING_SYSTEM_PROMPT).toContain("[ZBD-7](t3://ticket/ZBD-7)");
  });
});
