/**
 * MCP config file reader.
 *
 * Reads MCP server names from Claude and Codex configuration files on disk.
 * Pure file-system reads — no runtime sessions required.
 *
 * @module mcpConfigReader
 */
import { Effect, FileSystem } from "effect";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Claude MCP resolution
// ---------------------------------------------------------------------------

/**
 * Resolve MCP server names available for a Claude session by merging:
 *
 * 1. Global servers from `<configDir>/.claude.json` root `mcpServers`
 * 2. Per-project servers from `<configDir>/.claude.json` → `projects.<cwd>.mcpServers`
 * 3. Project-local servers from `<cwd>/.mcp.json` → `mcpServers`
 */
export const resolveClaudeMcpServerNames = Effect.fn("resolveClaudeMcpServerNames")(function* (
  configDir: string,
  cwd: string | undefined,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const names = new Set<string>();

  // 1 + 2: Read the profile/global .claude.json
  const claudeJsonPath = path.join(configDir, ".claude.json");
  const claudeJson = yield* readJsonFile(fileSystem, claudeJsonPath);

  if (claudeJson !== undefined) {
    // 1. Global servers (root-level mcpServers)
    collectMcpServerKeys(claudeJson, "mcpServers", names);

    // 2. Per-project servers (projects.<cwd>.mcpServers)
    if (cwd) {
      const projects = claudeJson.projects;
      if (isRecord(projects)) {
        const projectEntry = projects[cwd];
        if (isRecord(projectEntry)) {
          collectMcpServerKeys(projectEntry, "mcpServers", names);
        }
      }
    }
  }

  // 3. Project-local .mcp.json
  if (cwd) {
    const mcpJsonPath = path.join(cwd, ".mcp.json");
    const mcpJson = yield* readJsonFile(fileSystem, mcpJsonPath);
    if (mcpJson !== undefined) {
      collectMcpServerKeys(mcpJson, "mcpServers", names);
    }
  }

  return [...names].toSorted();
});

// ---------------------------------------------------------------------------
// Codex MCP resolution
// ---------------------------------------------------------------------------

/**
 * Resolve MCP server names from `<codexHome>/config.toml`.
 *
 * Uses the same manual line-by-line TOML parsing pattern as
 * `readCodexConfigModelProvider` in `CodexProvider.ts`.
 */
export const resolveCodexMcpServerNames = Effect.fn("resolveCodexMcpServerNames")(function* (
  codexHome: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const configPath = path.join(codexHome, "config.toml");

  const content = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (content === undefined) {
    return [] as string[];
  }

  const names = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Match [mcp_servers.name] but skip sub-sections like [mcp_servers.name.env]
    const match = trimmed.match(/^\[mcp_servers\.([^\].]+)\]$/);
    if (match?.[1]) {
      names.add(match[1].trim());
    }
  }
  return [...names].toSorted();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract the keys of a nested `mcpServers` record and add them to `out`. */
function collectMcpServerKeys(obj: Record<string, unknown>, key: string, out: Set<string>): void {
  const servers = obj[key];
  if (!isRecord(servers)) return;
  for (const name of Object.keys(servers)) {
    if (name.length > 0) {
      out.add(name);
    }
  }
}

/** Read and JSON-parse a file, returning `undefined` on any error. */
function readJsonFile(
  fileSystem: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<Record<string, unknown> | undefined> {
  return fileSystem.readFileString(filePath).pipe(
    Effect.map((raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        return isRecord(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }),
    Effect.orElseSucceed(() => undefined),
  );
}
