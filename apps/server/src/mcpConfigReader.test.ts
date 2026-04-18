import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  resolveCodexMcpServerNames,
  resolveCodexProjectTrusted,
  resolveGeminiMcpServerNames,
  trustCodexProject,
} from "./mcpConfigReader.ts";

it.layer(NodeServices.layer)("mcpConfigReader", (it) => {
  it.effect("merges global and project-scoped Codex MCP server names", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-home-" });
      const projectRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codex-project-",
      });
      const nestedCwd = path.join(projectRoot, "apps", "web");

      yield* fileSystem.makeDirectory(path.join(projectRoot, ".codex"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(nestedCwd, ".codex"), { recursive: true });

      yield* fileSystem.writeFileString(
        path.join(codexHome, "config.toml"),
        `
[mcp_servers.global-docs]
url = "https://developers.openai.com/mcp"

[mcp_servers.shared-server]
url = "https://example.com/shared"
        `.trim(),
      );

      yield* fileSystem.writeFileString(
        path.join(projectRoot, ".codex", "config.toml"),
        `
[mcp_servers.notion-zbd]
url = "https://mcp.notion.com/mcp"

[mcp_servers.notion-zbd.env]
NOTION_API_KEY = "ignored-for-name-resolution"
        `.trim(),
      );

      yield* fileSystem.writeFileString(
        path.join(nestedCwd, ".codex", "config.toml"),
        `
[mcp_servers.local-devtools]
url = "http://127.0.0.1:3333/mcp"

[mcp_servers.shared-server]
url = "https://example.com/overridden"
        `.trim(),
      );

      const serverNames = yield* resolveCodexMcpServerNames(codexHome, nestedCwd);

      assert.deepEqual(serverNames, [
        "global-docs",
        "local-devtools",
        "notion-zbd",
        "shared-server",
      ]);
    }),
  );

  it.effect("falls back to the global Codex config when no project cwd is provided", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-home-" });

      yield* fileSystem.writeFileString(
        path.join(codexHome, "config.toml"),
        `
[mcp_servers.global-only]
url = "https://example.com/global"
        `.trim(),
      );

      const serverNames = yield* resolveCodexMcpServerNames(codexHome);

      assert.deepEqual(serverNames, ["global-only"]);
    }),
  );

  it.effect("merges user and project-scoped Gemini MCP server names", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const geminiHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-gemini-home-" });
      const projectRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-gemini-project-",
      });
      const projectGeminiDir = path.join(projectRoot, ".gemini");

      yield* fileSystem.makeDirectory(projectGeminiDir, { recursive: true });

      yield* fileSystem.writeFileString(
        path.join(geminiHome, "settings.json"),
        JSON.stringify({
          mcpServers: {
            "global-docs": { url: "https://example.com/docs" },
            "shared-server": { command: "node", args: ["global.js"] },
          },
        }),
      );

      yield* fileSystem.writeFileString(
        path.join(projectGeminiDir, "settings.json"),
        JSON.stringify({
          mcpServers: {
            "local-devtools": { command: "npx", args: ["chrome-devtools-mcp"] },
            "shared-server": { command: "node", args: ["local.js"] },
          },
        }),
      );

      const serverNames = yield* resolveGeminiMcpServerNames(geminiHome, projectRoot);

      assert.deepEqual(serverNames, ["global-docs", "local-devtools", "shared-server"]);
    }),
  );

  it.effect("applies Gemini MCP allow and exclude filters", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const geminiHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-gemini-home-" });
      const projectRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-gemini-project-",
      });
      const projectGeminiDir = path.join(projectRoot, ".gemini");

      yield* fileSystem.makeDirectory(projectGeminiDir, { recursive: true });

      yield* fileSystem.writeFileString(
        path.join(geminiHome, "settings.json"),
        JSON.stringify({
          mcp: { allowed: ["global-docs", "local-devtools", "shared-server"] },
          mcpServers: {
            "global-docs": { url: "https://example.com/docs" },
            "hidden-global": { command: "node", args: ["hidden.js"] },
          },
        }),
      );

      yield* fileSystem.writeFileString(
        path.join(projectGeminiDir, "settings.json"),
        JSON.stringify({
          mcp: { excluded: ["shared-server"] },
          mcpServers: {
            "local-devtools": { command: "npx", args: ["chrome-devtools-mcp"] },
            "shared-server": { command: "node", args: ["shared.js"] },
          },
        }),
      );

      const serverNames = yield* resolveGeminiMcpServerNames(geminiHome, projectRoot);

      assert.deepEqual(serverNames, ["global-docs", "local-devtools"]);
    }),
  );

  it.effect("resolves trust for the exact Codex project path", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-home-" });
      const trustedProject = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codex-trusted-project-",
      });
      const otherProject = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codex-other-project-",
      });

      yield* fileSystem.writeFileString(
        path.join(codexHome, "config.toml"),
        `
[projects.${JSON.stringify(trustedProject)}]
trust_level = "trusted"

[projects.${JSON.stringify(otherProject)}]
trust_level = "untrusted"
        `.trim(),
      );

      assert.isTrue(yield* resolveCodexProjectTrusted(codexHome, trustedProject));
      assert.isFalse(yield* resolveCodexProjectTrusted(codexHome, otherProject));
    }),
  );

  it.effect("writes trusted Codex project entries into the global config", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-home-" });
      const projectRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codex-project-",
      });
      const configPath = path.join(codexHome, "config.toml");

      yield* fileSystem.writeFileString(
        configPath,
        `
[mcp_servers.global-docs]
url = "https://developers.openai.com/mcp"

[projects.${JSON.stringify(projectRoot)}]
trust_level = "untrusted"
        `.trim(),
      );

      const result = yield* trustCodexProject(codexHome, projectRoot);
      const nextConfig = yield* fileSystem.readFileString(configPath);

      assert.deepEqual(result, { trusted: true });
      assert.isTrue(yield* resolveCodexProjectTrusted(codexHome, projectRoot));
      assert.include(nextConfig, `[projects.${JSON.stringify(projectRoot)}]`);
      assert.include(nextConfig, 'trust_level = "trusted"');
      assert.include(nextConfig, "[mcp_servers.global-docs]");
    }),
  );
});
