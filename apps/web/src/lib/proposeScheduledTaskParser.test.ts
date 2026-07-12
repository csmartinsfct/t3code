import { describe, expect, it } from "vitest";

import { parseProposeScheduledTaskPayload } from "./proposeScheduledTaskParser";

describe("parseProposeScheduledTaskPayload", () => {
  it("preserves valid provider capability attachments", () => {
    const payload = parseProposeScheduledTaskPayload(
      JSON.stringify({
        name: "Spotify check",
        description: null,
        cronExpression: "0 9 * * *",
        projectId: "project-1",
        prompt: "Show my recently played songs.",
        autoSend: true,
        providerCapabilities: [
          {
            provider: "codex",
            kind: "plugin",
            id: "spotify@openai-curated-remote",
            displayName: "Spotify",
            iconUrl: "https://files.openai.com/spotify.png",
          },
          { provider: "codex", kind: "plugin", id: "missing-display-name" },
        ],
      }),
    );

    expect(payload?.providerCapabilities).toEqual([
      {
        provider: "codex",
        kind: "plugin",
        id: "spotify@openai-curated-remote",
        displayName: "Spotify",
        iconUrl: "https://files.openai.com/spotify.png",
      },
    ]);
  });
});
