/**
 * MCP config file reader.
 *
 * Reads MCP server names from Claude, Codex, and Gemini configuration files on disk.
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
 * Codex supports both a global config (`<codexHome>/config.toml`) and
 * project-scoped config files (`.codex/config.toml`). This resolver mirrors
 * that by merging the global config with any project configs discovered while
 * walking from the filesystem root down to `cwd`.
 *
 * Uses the same manual line-by-line TOML parsing pattern as
 * `readCodexConfigModelProvider` in `CodexProvider.ts`.
 */
export const resolveCodexMcpServerNames = Effect.fn("resolveCodexMcpServerNames")(function* (
  codexHome: string,
  cwd?: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const names = new Set<string>();

  for (const configPath of resolveCodexConfigPaths(codexHome, cwd)) {
    const content = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (content === undefined) continue;

    collectCodexMcpServerNames(content, names);
  }

  return [...names].toSorted();
});

// ---------------------------------------------------------------------------
// Gemini MCP resolution
// ---------------------------------------------------------------------------

/**
 * Resolve MCP server names from Gemini CLI settings.
 *
 * Gemini CLI supports user-level `settings.json` at `<geminiHome>/settings.json`
 * and project-local settings at `<cwd>/.gemini/settings.json`. MCP servers live
 * under top-level `mcpServers`, with optional global filters in `mcp.allowed`
 * and `mcp.excluded`.
 */
export const resolveGeminiMcpServerNames = Effect.fn("resolveGeminiMcpServerNames")(function* (
  geminiHome: string,
  cwd?: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const names = new Set<string>();
  let allowedNames: Set<string> | undefined;
  let excludedNames = new Set<string>();

  for (const configPath of resolveGeminiSettingsPaths(geminiHome, cwd)) {
    const settings = yield* readJsonFile(fileSystem, configPath);
    if (settings === undefined) continue;

    collectMcpServerKeys(settings, "mcpServers", names);

    const mcp = settings.mcp;
    if (!isRecord(mcp)) continue;

    const allowed = readStringArray(mcp.allowed);
    if (allowed !== undefined) {
      allowedNames = new Set(allowed);
    }

    const excluded = readStringArray(mcp.excluded);
    if (excluded !== undefined) {
      excludedNames = new Set(excluded);
    }
  }

  return [...names]
    .filter((name) => allowedNames === undefined || allowedNames.has(name))
    .filter((name) => !excludedNames.has(name))
    .toSorted();
});

/**
 * Resolve whether Codex trusts the exact project cwd.
 *
 * Codex stores project trust in the global config file under sections like:
 *
 * `[projects."/absolute/path"]`
 * `trust_level = "trusted"`
 */
export const resolveCodexProjectTrusted = Effect.fn("resolveCodexProjectTrusted")(function* (
  codexHome: string,
  cwd: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const configPath = path.join(codexHome, "config.toml");
  const content = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => undefined));

  if (content === undefined) {
    return false;
  }

  return readCodexProjectTrustLevel(content, cwd) === "trusted";
});

/** Ensure the exact project cwd is marked as `trusted` in Codex global config. */
export const trustCodexProject = Effect.fn("trustCodexProject")(function* (
  codexHome: string,
  cwd: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const configPath = path.join(codexHome, "config.toml");
  const existingContent = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => ""));
  if (readCodexProjectTrustLevel(existingContent, cwd) === "trusted") {
    return { trusted: true as const };
  }
  const nextContent = upsertCodexProjectTrustLevel(existingContent, cwd, "trusted");

  yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
  yield* fileSystem.writeFileString(configPath, nextContent);

  return { trusted: true as const };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveCodexProjectConfigPaths(cwd: string): readonly string[] {
  const directories: string[] = [];
  let current = path.resolve(cwd);

  while (true) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  directories.reverse();
  return directories.map((dir) => path.join(dir, ".codex", "config.toml"));
}

export function resolveGeminiSettingsPaths(geminiHome: string, cwd?: string): readonly string[] {
  const configPaths = new Set<string>([path.join(geminiHome, "settings.json")]);

  if (cwd) {
    configPaths.add(path.join(cwd, ".gemini", "settings.json"));
  }

  return [...configPaths];
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

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function resolveCodexConfigPaths(codexHome: string, cwd?: string): readonly string[] {
  const configPaths = new Set<string>([path.join(codexHome, "config.toml")]);

  if (cwd) {
    for (const configPath of resolveCodexProjectConfigPaths(cwd)) {
      configPaths.add(configPath);
    }
  }

  return [...configPaths];
}

function collectCodexMcpServerNames(content: string, out: Set<string>): void {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Match [mcp_servers.name] but skip sub-sections like [mcp_servers.name.env]
    const match = trimmed.match(/^\[mcp_servers\.([^\].]+)\]$/);
    if (match?.[1]) {
      out.add(match[1].trim());
    }
  }
}

function readCodexProjectTrustLevel(content: string, cwd: string): string | undefined {
  const sectionHeader = formatCodexProjectSectionHeader(cwd);
  let inProjectSection = false;

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (trimmed === sectionHeader) {
        inProjectSection = true;
        continue;
      }
      if (inProjectSection) {
        break;
      }
    }

    if (!inProjectSection) continue;

    const trustLevelMatch = trimmed.match(/^trust_level\s*=\s*"([^"]+)"$/u);
    if (trustLevelMatch?.[1]) {
      return trustLevelMatch[1];
    }
  }

  return undefined;
}

function upsertCodexProjectTrustLevel(content: string, cwd: string, trustLevel: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const sectionHeader = formatCodexProjectSectionHeader(cwd);
  const trustLevelLine = `trust_level = ${JSON.stringify(trustLevel)}`;
  const lines = content.length > 0 ? content.split(/\r?\n/u) : [];
  const sectionStartIndex = lines.findIndex((line) => line.trim() === sectionHeader);

  if (sectionStartIndex === -1) {
    const baseLines = trimTrailingBlankLines(lines);
    const nextLines =
      baseLines.length === 0
        ? [sectionHeader, trustLevelLine]
        : [...baseLines, "", sectionHeader, trustLevelLine];
    return `${nextLines.join(newline)}${newline}`;
  }

  let sectionEndIndex = lines.length;
  for (let index = sectionStartIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim();
    if (trimmed?.startsWith("[") && trimmed.endsWith("]")) {
      sectionEndIndex = index;
      break;
    }
  }

  const trustLevelIndex = lines.findIndex(
    (line, index) =>
      index > sectionStartIndex && index < sectionEndIndex && /^trust_level\s*=/.test(line.trim()),
  );

  const nextLines = [...lines];
  if (trustLevelIndex >= 0) {
    nextLines[trustLevelIndex] = trustLevelLine;
  } else {
    nextLines.splice(sectionEndIndex, 0, trustLevelLine);
  }

  return `${nextLines.join(newline).replace(/(?:\r?\n)*$/u, "")}${newline}`;
}

function trimTrailingBlankLines(lines: readonly string[]): readonly string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

function formatCodexProjectSectionHeader(cwd: string): string {
  return `[projects.${JSON.stringify(path.resolve(cwd))}]`;
}
