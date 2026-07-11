import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

import {
  normalizeCodexCapabilities,
  resolveCodexProviderCapabilities,
  type CodexPluginListResponse,
  type CodexSkillsListResponse,
} from "./codexCapabilities";

function makeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => true);
  return child as unknown as ChildProcessWithoutNullStreams;
}

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
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
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

  it("includes only explicitly enabled plugin skills", () => {
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
              interface: { displayName: "Superpowers" },
            },
          ],
        },
      ],
    };
    const skills: CodexSkillsListResponse = {
      data: [
        {
          skills: [
            { name: "superpowers:enabled", enabled: true },
            { name: "superpowers:disabled", enabled: false },
            { name: "superpowers:unspecified" },
          ],
        },
      ],
    };

    const result = normalizeCodexCapabilities({ provider: "codex", plugins, skills });

    expect(result.map((entry) => entry.id)).toEqual([
      "superpowers@openai-curated-remote",
      "superpowers:enabled",
    ]);
  });
});

describe("resolveCodexProviderCapabilities", () => {
  it.each(["error", "stdin", "stdout"] as const)(
    "rejects and cleans up when Codex %s emits an error",
    async (source) => {
      spawnMock.mockReset();
      const child = makeChild();
      spawnMock.mockReturnValueOnce(child);

      const result = Effect.runPromise(
        resolveCodexProviderCapabilities({
          provider: "codex",
          cwd: "/repo",
          binaryPath: "codex",
        }),
      );

      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
      const error = new Error(`${source} failed`);
      if (source === "error") {
        child.emit("error", error);
      } else {
        child[source].emit("error", error);
      }

      await expect(result).rejects.toMatchObject({ cause: error });
      expect(child.kill).toHaveBeenCalledOnce();
    },
  );
});
