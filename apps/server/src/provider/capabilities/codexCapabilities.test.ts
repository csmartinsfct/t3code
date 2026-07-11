import { describe, expect, it } from "vitest";
import {
  normalizeCodexCapabilities,
  type CodexPluginListResponse,
  type CodexSkillsListResponse,
} from "./codexCapabilities";

describe("normalizeCodexCapabilities", () => {
  it("normalizes installed plugins and plugin skills", () => {
    const plugins: CodexPluginListResponse = {
      marketplaces: [
        {
          name: "openai-curated-remote",
          plugins: [
            {
              id: "superpowers@openai-curated-remote",
              name: "superpowers",
              installed: true,
              enabled: true,
              source: { type: "remote" },
              interface: {
                displayName: "Superpowers",
                shortDescription:
                  "Planning, TDD, debugging, and delivery workflows for coding agents",
                composerIcon: null,
                composerIconUrl: null,
              },
            },
          ],
        },
      ],
    };
    const skills: CodexSkillsListResponse = {
      data: [
        {
          cwd: "/repo",
          skills: [
            {
              name: "superpowers:brainstorming",
              description: "Explore intent before implementation",
              path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
              scope: "user",
              enabled: true,
              interface: {
                displayName: "Brainstorming",
                shortDescription: "Explore intent",
              },
            },
          ],
        },
      ],
    };

    const result = normalizeCodexCapabilities({ provider: "codex", plugins, skills });

    expect(result.map((entry) => entry.id)).toEqual([
      "superpowers@openai-curated-remote",
      "superpowers:brainstorming",
    ]);
    expect(result[1]).toMatchObject({
      kind: "skill",
      parentDisplayName: "Superpowers",
      displayName: "Brainstorming",
    });
  });

  it("dedupes duplicate provider skills by parent and display name", () => {
    const plugins: CodexPluginListResponse = {
      marketplaces: [
        {
          name: "openai-curated-remote",
          plugins: [
            {
              id: "superpowers@openai-curated-remote",
              name: "superpowers",
              installed: true,
              enabled: true,
              source: { type: "remote" },
              interface: { displayName: "Superpowers", shortDescription: "Workflows" },
            },
          ],
        },
      ],
    };
    const skills: CodexSkillsListResponse = {
      data: [
        {
          cwd: "/repo",
          skills: [
            {
              name: "superpowers:brainstorming",
              description: "Old",
              path: "/Users/me/.codex/plugins/cache/openai-curated/superpowers/hash/skills/brainstorming/SKILL.md",
              scope: "user",
              enabled: true,
              interface: { displayName: "Brainstorming" },
            },
            {
              name: "superpowers:brainstorming",
              description: "Current",
              path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
              scope: "user",
              enabled: true,
              interface: { displayName: "Brainstorming" },
            },
          ],
        },
      ],
    };

    const result = normalizeCodexCapabilities({ provider: "codex", plugins, skills });
    const brainstorming = result.filter((entry) => entry.id === "superpowers:brainstorming");

    expect(brainstorming).toHaveLength(1);
    expect(brainstorming[0]?.description).toBe("Current");
  });
});
