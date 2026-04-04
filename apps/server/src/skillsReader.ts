/**
 * Discovers skill files (markdown prompt templates) from known project and
 * user directories.
 *
 * Supported sources:
 * - Claude Code: `<cwd>/.claude/commands/` (project), `~/.claude/commands/` (user)
 * - Cursor:      `<cwd>/.cursor/rules/` (project), `<cwd>/.cursorrules` (single file)
 * - GitHub:      `<cwd>/.github/prompts/` (project)
 *
 * Monorepo support: also scans up to 2 levels of subdirectories for skill
 * directories (e.g. `apps/web/.claude/commands/`, `packages/foo/.cursor/rules/`).
 * Skills found in sub-packages are tagged with a `group` field matching the
 * sub-package directory name.
 *
 * The {@link SKILL_SCAN_PATTERNS} array is intentionally easy to extend.
 *
 * @module skillsReader
 */
import { Effect, FileSystem } from "effect";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Scan pattern definition
// ---------------------------------------------------------------------------

interface SkillScanPattern {
  /** Human-readable source label. */
  source: string;
  /** Returns the directory to scan, given a base directory. */
  directory: (base: string) => string;
  /** File extensions to accept (including the leading dot). */
  extensions: readonly string[];
  /** Whether this pattern should be scanned in monorepo sub-packages. */
  scanSubPackages: boolean;
  /**
   * If set, also scan subdirectories for a known entry file.
   * e.g. `.claude/skills/<name>/SKILL.md` where entryFiles = ["SKILL.md"]
   * The skill name is derived from the directory name, not the file name.
   */
  entryFiles?: readonly string[];
}

/** Directories to skip when scanning for monorepo sub-packages. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
]);

const SKILL_SCAN_PATTERNS: readonly SkillScanPattern[] = [
  {
    source: "claude",
    directory: (base) => path.join(base, ".claude", "commands"),
    extensions: [".md"],
    scanSubPackages: true,
  },
  {
    source: "claude",
    directory: (base) => path.join(base, ".claude", "skills"),
    extensions: [".md"],
    scanSubPackages: true,
    entryFiles: ["SKILL.md"],
  },
  {
    source: "claude",
    directory: () => path.join(os.homedir(), ".claude", "commands"),
    extensions: [".md"],
    scanSubPackages: false,
  },
  {
    source: "cursor",
    directory: (base) => path.join(base, ".cursor", "rules"),
    extensions: [".md", ".mdc"],
    scanSubPackages: true,
  },
  {
    source: "github",
    directory: (base) => path.join(base, ".github", "prompts"),
    extensions: [".md"],
    scanSubPackages: true,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DiscoveredSkill {
  id: string;
  name: string;
  source: string;
  absolutePath: string;
  relativePath: string;
  content: string;
  group: string | null;
}

/**
 * Scan all known skill directories and return discovered skill entries.
 *
 * Errors in individual directories or files are swallowed so that a single
 * bad file never prevents the rest of the skills from loading.
 */
export const resolveSkills = Effect.fn("resolveSkills")(function* (cwd: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const skills: DiscoveredSkill[] = [];

  // Scan a single directory for skill files matching the given pattern.
  const scanDir = (pattern: SkillScanPattern, dir: string, group: string | null) =>
    Effect.gen(function* () {
      const dirExists = yield* fileSystem.exists(dir).pipe(Effect.orElseSucceed(() => false));
      if (!dirExists) return;

      const stat = yield* fileSystem.stat(dir).pipe(Effect.orElseSucceed(() => undefined));
      if (!stat || stat.type !== "Directory") return;

      const entries = yield* fileSystem
        .readDirectory(dir)
        .pipe(Effect.orElseSucceed(() => [] as string[]));

      const groupPrefix = group ? `${group}/` : "";

      for (const entry of entries) {
        const entryPath = path.join(dir, entry);

        // Check direct file matches (e.g. commands/review.md)
        const matchesExt = pattern.extensions.some((ext) => entry.endsWith(ext));
        if (matchesExt) {
          const content = yield* fileSystem
            .readFileString(entryPath)
            .pipe(Effect.orElseSucceed(() => undefined));

          if (content === undefined) continue;

          // Strip any known extension to derive the name.
          let name = entry;
          for (const ext of pattern.extensions) {
            if (name.endsWith(ext)) {
              name = name.slice(0, -ext.length);
              break;
            }
          }

          skills.push({
            id: `${pattern.source}:${groupPrefix}${entry}`,
            name,
            source: pattern.source,
            absolutePath: entryPath,
            relativePath: entry,
            content,
            group,
          });
          continue;
        }

        // Check folder skills with known entry files (e.g. skills/create-mr/SKILL.md)
        if (pattern.entryFiles && pattern.entryFiles.length > 0) {
          const entryStat = yield* fileSystem
            .stat(entryPath)
            .pipe(Effect.orElseSucceed(() => undefined));
          if (!entryStat || entryStat.type !== "Directory") continue;

          for (const entryFile of pattern.entryFiles) {
            const entryFilePath = path.join(entryPath, entryFile);
            const content = yield* fileSystem
              .readFileString(entryFilePath)
              .pipe(Effect.orElseSucceed(() => undefined));

            if (content === undefined) continue;

            // Name is the directory name, not the entry file name.
            skills.push({
              id: `${pattern.source}:${groupPrefix}${entry}/${entryFile}`,
              name: entry,
              source: pattern.source,
              absolutePath: entryFilePath,
              relativePath: `${entry}/${entryFile}`,
              content,
              group,
            });
            break; // Only one entry file per folder
          }
        }
      }
    });

  // ── Root-level scan ──────────────────────────────────────────────────────
  for (const pattern of SKILL_SCAN_PATTERNS) {
    const dir = pattern.directory(cwd);
    yield* scanDir(pattern, dir, null);
  }

  // ── Monorepo sub-package scan (depth 1–2) ────────────────────────────────
  // Looks for patterns like: <cwd>/apps/web/.claude/commands/
  //                      or: <cwd>/mobile-wallet/.cursor/rules/
  const subPackagePatterns = SKILL_SCAN_PATTERNS.filter((p) => p.scanSubPackages);
  if (subPackagePatterns.length > 0) {
    const rootEntries = yield* fileSystem
      .readDirectory(cwd)
      .pipe(Effect.orElseSucceed(() => [] as string[]));

    for (const childName of rootEntries) {
      if (IGNORED_DIRS.has(childName) || childName.startsWith(".")) continue;

      const childPath = path.join(cwd, childName);
      const childStat = yield* fileSystem
        .stat(childPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (!childStat || childStat.type !== "Directory") continue;

      // Depth 1: check if this child itself has skill dirs
      for (const pattern of subPackagePatterns) {
        const dir = pattern.directory(childPath);
        yield* scanDir(pattern, dir, childName);
      }

      // Depth 2: check children of this child (e.g. apps/web/, packages/foo/)
      const grandchildEntries = yield* fileSystem
        .readDirectory(childPath)
        .pipe(Effect.orElseSucceed(() => [] as string[]));

      for (const grandchildName of grandchildEntries) {
        if (IGNORED_DIRS.has(grandchildName) || grandchildName.startsWith(".")) continue;

        const grandchildPath = path.join(childPath, grandchildName);
        const grandchildStat = yield* fileSystem
          .stat(grandchildPath)
          .pipe(Effect.orElseSucceed(() => undefined));
        if (!grandchildStat || grandchildStat.type !== "Directory") continue;

        for (const pattern of subPackagePatterns) {
          const dir = pattern.directory(grandchildPath);
          yield* scanDir(pattern, dir, `${childName}/${grandchildName}`);
        }
      }
    }
  }

  // ── .cursorrules single-file check (root only) ───────────────────────────
  const cursorrulePath = path.join(cwd, ".cursorrules");
  const cursorruleExists = yield* fileSystem
    .exists(cursorrulePath)
    .pipe(Effect.orElseSucceed(() => false));

  if (cursorruleExists) {
    const content = yield* fileSystem
      .readFileString(cursorrulePath)
      .pipe(Effect.orElseSucceed(() => undefined));

    if (content !== undefined) {
      skills.push({
        id: "cursor:.cursorrules",
        name: ".cursorrules",
        source: "cursor",
        absolutePath: cursorrulePath,
        relativePath: ".cursorrules",
        content,
        group: null,
      });
    }
  }

  return skills;
});
