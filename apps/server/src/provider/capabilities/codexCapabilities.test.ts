import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

import {
  canonicalizeCodexSelectedCapabilities,
  clearCodexProviderCapabilitiesCache,
  normalizeCodexCapabilities,
  resolveCodexProviderCapabilities,
  type CodexPluginListResponse,
  type CodexSkillsListResponse,
} from "./codexCapabilities";

beforeEach(() => {
  clearCodexProviderCapabilitiesCache();
});

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

  it("normalizes app-backed plugin roots for Codex thread capability selection", () => {
    const plugins: CodexPluginListResponse = {
      marketplaces: [
        {
          name: "openai-curated-remote",
          plugins: [
            {
              id: "gmail@openai-curated-remote",
              name: "gmail",
              installed: true,
              enabled: true,
              source: {
                source: "local",
                path: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
              },
              appIds: ["connector_2128aebfecb84f64a069897515042a44"],
              interface: {
                displayName: "Gmail",
                shortDescription: "Read and manage Gmail",
              },
            },
          ],
        },
      ],
    };

    const result = normalizeCodexCapabilities({
      provider: "codex",
      plugins,
      skills: { data: [] },
    });

    expect(result[0]).toMatchObject({
      id: "gmail@openai-curated-remote",
      kind: "plugin",
      displayName: "Gmail",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
      appIds: ["connector_2128aebfecb84f64a069897515042a44"],
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
  it("enriches installed app plugins from the local Codex cache when plugin/list omits source paths", async () => {
    spawnMock.mockReset();
    const codexHome = await mkdtemp(join(tmpdir(), "t3-code-codex-home-"));
    const pluginRoot = join(
      codexHome,
      "plugins",
      "cache",
      "openai-curated-remote",
      "gmail",
      "0.1.5",
    );
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "{}", "utf8");
    await writeFile(
      join(pluginRoot, ".app.json"),
      JSON.stringify({
        apps: {
          gmail: {
            id: "connector_2128aebfecb84f64a069897515042a44",
            required: true,
          },
        },
      }),
      "utf8",
    );
    const catalogRoot = join(codexHome, "cache", "remote_plugin_catalog");
    await mkdir(catalogRoot, { recursive: true });
    await writeFile(
      join(catalogRoot, "catalog.json"),
      JSON.stringify({
        plugins: [
          {
            name: "gmail",
            release: {
              interface: {
                composer_icon_url: null,
                logo_url: "https://files.openai.com/gmail-logo.png",
              },
            },
          },
        ],
      }),
      "utf8",
    );
    const child = makeChild();
    const stdinWrites: string[] = [];
    child.stdin.on("data", (chunk) => {
      stdinWrites.push(String(chunk));
    });
    spawnMock.mockReturnValueOnce(child);

    const result = Effect.runPromise(
      resolveCodexProviderCapabilities({
        provider: "codex",
        cwd: "/repo",
        binaryPath: "codex",
        homePath: codexHome,
      }),
    );

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    (child.stdout as PassThrough).write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    await vi.waitFor(() => expect(stdinWrites.join("")).toContain('"plugin/list"'));
    (child.stdout as PassThrough).write(
      `${JSON.stringify({
        id: 2,
        result: {
          marketplaces: [
            {
              name: "openai-curated-remote",
              plugins: [
                {
                  id: "gmail@openai-curated-remote",
                  name: "gmail",
                  installed: true,
                  enabled: true,
                  interface: {
                    displayName: "Gmail",
                    shortDescription: "Read and manage Gmail",
                  },
                },
              ],
            },
          ],
        },
      })}\n`,
    );
    (child.stdout as PassThrough).write(`${JSON.stringify({ id: 3, result: { data: [] } })}\n`);

    await expect(result).resolves.toEqual({
      capabilities: [
        {
          id: "gmail@openai-curated-remote",
          provider: "codex",
          kind: "plugin",
          name: "gmail",
          displayName: "Gmail",
          description: "Read and manage Gmail",
          source: "openai-curated-remote",
          enabled: true,
          installed: true,
          capabilityRootPath: pluginRoot,
          appIds: ["connector_2128aebfecb84f64a069897515042a44"],
          iconUrl: "https://files.openai.com/gmail-logo.png",
        },
      ],
    });

    await expect(
      Effect.runPromise(
        resolveCodexProviderCapabilities({
          provider: "codex",
          cwd: "/repo",
          binaryPath: "codex",
          homePath: codexHome,
        }),
      ),
    ).resolves.toEqual({
      capabilities: [
        expect.objectContaining({
          id: "gmail@openai-curated-remote",
          capabilityRootPath: pluginRoot,
        }),
      ],
    });
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent capability discovery for the same Codex environment", async () => {
    spawnMock.mockReset();
    const child = makeChild();
    const stdinWrites: string[] = [];
    child.stdin.on("data", (chunk) => stdinWrites.push(String(chunk)));
    spawnMock.mockReturnValueOnce(child);

    const input = {
      provider: "codex" as const,
      cwd: "/repo/concurrent",
      binaryPath: "codex",
    };
    const first = Effect.runPromise(resolveCodexProviderCapabilities(input));
    const second = Effect.runPromise(resolveCodexProviderCapabilities(input));

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    (child.stdout as PassThrough).write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    await vi.waitFor(() => expect(stdinWrites.join("")).toContain('"plugin/list"'));
    (child.stdout as PassThrough).write(
      `${JSON.stringify({ id: 2, result: { marketplaces: [] } })}\n`,
    );
    (child.stdout as PassThrough).write(`${JSON.stringify({ id: 3, result: { data: [] } })}\n`);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { capabilities: [] },
      { capabilities: [] },
    ]);
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("launches Codex capability discovery from the target project cwd", async () => {
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

    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd: "/repo" });

    const error = new Error("stop after assertion");
    child.emit("error", error);
    await expect(result).rejects.toMatchObject({ cause: error });
  });

  it("replaces client capability metadata with canonical discovered values", () => {
    expect(
      canonicalizeCodexSelectedCapabilities({
        discovered: [
          {
            id: "spotify@openai-curated-remote",
            provider: "codex",
            kind: "plugin",
            name: "spotify",
            displayName: "Spotify",
            enabled: true,
            installed: true,
            capabilityRootPath: "/canonical/spotify/1.0.0",
            appIds: ["spotify-app"],
            iconUrl: "https://example.com/spotify.png",
          },
        ],
        requested: [
          {
            id: "spotify@openai-curated-remote",
            provider: "codex",
            kind: "plugin",
            displayName: "Forged Spotify",
            capabilityRootPath: "/tmp/attacker-controlled",
            appIds: ["forged-app"],
          },
        ],
      }),
    ).toEqual([
      {
        id: "spotify@openai-curated-remote",
        provider: "codex",
        kind: "plugin",
        name: "spotify",
        displayName: "Spotify",
        capabilityRootPath: "/canonical/spotify/1.0.0",
        appIds: ["spotify-app"],
        iconUrl: "https://example.com/spotify.png",
      },
    ]);
  });

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
