#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ChangelogAssetFile,
  ChangelogBatchProvenance,
  ChangelogCacheFile,
  ChangelogGroup,
  type ChangelogEntry,
  GeneratedChangelogResponse,
  type GitCommitSha,
} from "@t3tools/contracts/changelog";
import { Schema } from "effect";

const PROMPT_VERSION = "2026-04-11.v1";
const CHANGELOG_CACHE_PATH = ".generated/changelog/cache.json";
const CHANGELOG_ASSET_PATH = "apps/web/public/generated/changelog.json";
const DIST_CHANGELOG_ASSET_PATH = "generated/changelog.json";
const DEFAULT_CODEX_MODEL = process.env.T3CODE_CHANGELOG_CODEX_MODEL?.trim() || "gpt-5.4";
const DEFAULT_CODEX_BINARY = process.env.T3CODE_CHANGELOG_CODEX_BINARY?.trim() || "codex";
const DEFAULT_CODEX_HOME =
  process.env.T3CODE_CHANGELOG_CODEX_HOME?.trim() ||
  process.env.CODEX_HOME ||
  path.join(os.homedir(), ".codex");
const REBUILD_COMMIT_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.T3CODE_CHANGELOG_REBUILD_MAX_COMMITS ?? "50", 10) || 50,
);
const MAX_COMMITS_PER_BATCH = 24;
const MAX_COMMIT_BODY_CHARS = 1_600;
const MAX_CHANGED_FILES = 24;
const MAX_CHANGED_FILE_CHARS = 1_200;
const MAX_PROMPT_JSON_CHARS = 120_000;
const CODEX_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

const verbose = process.argv.includes("--verbose");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelogCachePath = path.join(repoRoot, CHANGELOG_CACHE_PATH);
const changelogAssetPath = path.join(repoRoot, CHANGELOG_ASSET_PATH);

interface GitCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface CommitRecord {
  readonly sha: GitCommitSha;
  readonly committedAt: string;
  readonly date: string;
  readonly subject: string;
  readonly body: string;
  readonly files: ReadonlyArray<string>;
}

function log(message: string) {
  if (verbose) {
    console.log(`[generate-changelog] ${message}`);
  }
}

function ensureParentDir(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseArgs() {
  return {
    syncDistDir:
      process.argv.includes("--sync-dist") ||
      process.env.T3CODE_CHANGELOG_SYNC_DIST === "1" ||
      process.env.T3CODE_CHANGELOG_SYNC_DIST === "true",
    distClientDir:
      process.env.T3CODE_CHANGELOG_DIST_CLIENT_DIR?.trim() ||
      path.join(repoRoot, "apps/server/dist/client"),
  };
}

function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly timeout?: number;
    readonly maxBuffer?: number;
  },
): GitCommandResult {
  const result = spawnSync(command, args, {
    cwd: options?.cwd ?? repoRoot,
    env: options?.env,
    input: options?.input,
    encoding: "utf8",
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runGit(args: ReadonlyArray<string>, input?: string): string {
  const result = runCommand("git", args, input === undefined ? undefined : { input });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      detail ? `git ${args.join(" ")} failed: ${detail}` : `git ${args.join(" ")} failed.`,
    );
  }
  return result.stdout.trimEnd();
}

function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

function readChangelogCacheFile(filePath: string): typeof ChangelogCacheFile.Type | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return Schema.decodeUnknownSync(ChangelogCacheFile)(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    log(`Ignoring invalid JSON file at ${path.relative(repoRoot, filePath)}: ${String(error)}`);
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveHeadSha(): GitCommitSha {
  return runGit(["rev-parse", "HEAD"]) as GitCommitSha;
}

function commitExists(sha: GitCommitSha): boolean {
  const result = runCommand("git", ["cat-file", "-e", `${sha}^{commit}`]);
  return result.status === 0;
}

function isAncestor(ancestorSha: GitCommitSha, headSha: GitCommitSha): boolean {
  const result = runCommand("git", ["merge-base", "--is-ancestor", ancestorSha, headSha]);
  return result.status === 0;
}

function listCommitShas(rangeArgs: ReadonlyArray<string>): ReadonlyArray<GitCommitSha> {
  const output = runGit(["rev-list", "--reverse", ...rangeArgs]);
  if (!output.trim()) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line): line is GitCommitSha => line.length > 0) as ReadonlyArray<GitCommitSha>;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n[truncated]`;
}

function readCommitRecord(sha: GitCommitSha): CommitRecord {
  const metadata = runGit([
    "show",
    "--format=%H%x00%aI%x00%s%x00%b%x00",
    "--name-only",
    "--no-renames",
    sha,
  ]);
  const firstSeparator = metadata.indexOf("\0");
  const secondSeparator = metadata.indexOf("\0", firstSeparator + 1);
  const thirdSeparator = metadata.indexOf("\0", secondSeparator + 1);
  const fourthSeparator = metadata.indexOf("\0", thirdSeparator + 1);

  const commitSha = metadata.slice(0, firstSeparator).trim() as GitCommitSha | undefined;
  const committedAt = metadata.slice(firstSeparator + 1, secondSeparator).trim();
  const subject = metadata.slice(secondSeparator + 1, thirdSeparator).trim();
  const body = metadata.slice(thirdSeparator + 1, fourthSeparator).trim();
  const filesBlock = metadata.slice(fourthSeparator + 1).trim();

  if (!commitSha || !committedAt || !subject) {
    throw new Error(`Could not parse commit metadata for ${sha}.`);
  }

  return {
    sha: commitSha,
    committedAt,
    date: committedAt.slice(0, 10),
    subject,
    body: truncate(body, MAX_COMMIT_BODY_CHARS),
    files: filesBlock.length > 0 ? filesBlock.split("\n").slice(0, MAX_CHANGED_FILES) : [],
  };
}

function chunkCommits(
  commits: ReadonlyArray<CommitRecord>,
): ReadonlyArray<ReadonlyArray<CommitRecord>> {
  const batches: Array<ReadonlyArray<CommitRecord>> = [];
  let index = 0;
  while (index < commits.length) {
    const next = commits.slice(index, index + MAX_COMMITS_PER_BATCH);
    batches.push(next);
    index += MAX_COMMITS_PER_BATCH;
  }
  return batches;
}

function buildPrompt(commits: ReadonlyArray<CommitRecord>): string {
  const commitPayload = commits.map((commit) => ({
    sha: commit.sha,
    committedAt: commit.committedAt,
    date: commit.date,
    subject: commit.subject,
    body: commit.body,
    files: truncate(commit.files.join("\n"), MAX_CHANGED_FILE_CHARS),
  }));
  let serializedPayload = JSON.stringify(commitPayload, null, 2);
  if (serializedPayload.length > MAX_PROMPT_JSON_CHARS) {
    serializedPayload = `${serializedPayload.slice(0, MAX_PROMPT_JSON_CHARS)}\n[truncated]`;
  }

  return [
    "You write polished, user-facing release notes for T3 Code.",
    "Return only structured JSON matching the provided schema.",
    "Use only the supplied commit history.",
    "Do not mention file paths, pull requests, tests, prompts, or internal maintenance unless it directly affects user-visible behavior.",
    "You may merge multiple related commits into a single changelog entry.",
    "Every entry must cite one or more commit SHAs taken exactly from the supplied commits.",
    "Group entries by the supplied YYYY-MM-DD date strings.",
    "Prefer concise, professional language focused on what changed for users.",
    "",
    "Commit history:",
    serializedPayload,
  ].join("\n");
}

function createIsolatedCodexHome(): string {
  const isolatedHomePath = path.join(os.tmpdir(), `t3code-codex-home-${randomUUID()}`);
  mkdirSync(isolatedHomePath, { recursive: true });

  const authPath = path.join(DEFAULT_CODEX_HOME, "auth.json");
  if (existsSync(authPath)) {
    writeFileSync(path.join(isolatedHomePath, "auth.json"), readFileSync(authPath));
  }

  return isolatedHomePath;
}

function generateBatch(
  commits: ReadonlyArray<CommitRecord>,
  fromExclusiveCommit: GitCommitSha | null,
): {
  readonly groups: ReadonlyArray<ChangelogGroup>;
  readonly provenance: typeof ChangelogBatchProvenance.Type;
} {
  const schemaPath = path.join(os.tmpdir(), `t3code-changelog-schema-${randomUUID()}.json`);
  const outputPath = path.join(os.tmpdir(), `t3code-changelog-output-${randomUUID()}.json`);
  const codexHomePath = createIsolatedCodexHome();

  try {
    writeJsonFile(schemaPath, toJsonSchemaObject(GeneratedChangelogResponse));

    const prompt = buildPrompt(commits);
    const result = runCommand(
      DEFAULT_CODEX_BINARY,
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "--model",
        DEFAULT_CODEX_MODEL,
        "--config",
        'model_reasoning_effort="low"',
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CODEX_HOME: codexHomePath,
        },
        input: prompt,
        timeout: CODEX_TIMEOUT_MS,
      },
    );

    if (result.status !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(detail || `Codex exited with status ${result.status ?? "null"}.`);
    }

    const rawOutput = JSON.parse(readFileSync(outputPath, "utf8"));
    const decoded = Schema.decodeUnknownSync(GeneratedChangelogResponse)(rawOutput);
    const groups = Schema.decodeUnknownSync(Schema.Array(ChangelogGroup))(
      decoded.groups.map((group) => ({
        date: group.date,
        entries: group.entries.map((entry) => ({
          id: createHash("sha256")
            .update(`${group.date}:${entry.title}:${entry.commitShas.join(",")}`)
            .digest("hex")
            .slice(0, 16),
          title: entry.title,
          summary: entry.summary,
          category: entry.category,
          commitShas: [...new Set(entry.commitShas)].toSorted(),
        })),
      })),
    );

    return {
      groups,
      provenance: Schema.decodeUnknownSync(ChangelogBatchProvenance)({
        generatedAt: new Date().toISOString(),
        promptVersion: PROMPT_VERSION,
        fromExclusiveCommit,
        toInclusiveCommit: commits[commits.length - 1]!.sha,
        commitShas: commits.map((commit) => commit.sha),
        commitCount: commits.length,
        model: DEFAULT_CODEX_MODEL,
        mcpDisabled: true,
      }),
    };
  } finally {
    rmSync(schemaPath, { force: true });
    rmSync(outputPath, { force: true });
    rmSync(codexHomePath, { recursive: true, force: true });
  }
}

interface GeneratedBatch {
  readonly provenance: typeof ChangelogBatchProvenance.Type;
  readonly groups: ReadonlyArray<ChangelogGroup>;
}

function mergeGroups(batches: ReadonlyArray<GeneratedBatch>): ReadonlyArray<ChangelogGroup> {
  const merged = new Map<string, ChangelogEntry[]>();
  const commitOrder = new Map<GitCommitSha, number>();

  batches.forEach((batch, batchIndex) => {
    batch.provenance.commitShas.forEach((sha, commitIndex) => {
      commitOrder.set(sha, batchIndex * MAX_COMMITS_PER_BATCH + commitIndex);
    });
  });

  for (const batch of batches) {
    for (const group of batch.groups) {
      const entries = merged.get(group.date) ?? [];
      entries.push(...group.entries);
      merged.set(group.date, entries);
    }
  }

  return [...merged.entries()]
    .toSorted(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
    .map(([date, entries]) => ({
      date,
      entries: entries.toSorted((left, right) => {
        const leftOrder = Math.max(...left.commitShas.map((sha) => commitOrder.get(sha) ?? -1));
        const rightOrder = Math.max(...right.commitShas.map((sha) => commitOrder.get(sha) ?? -1));
        return rightOrder - leftOrder;
      }),
    }));
}

function buildAsset(cache: typeof ChangelogCacheFile.Type): typeof ChangelogAssetFile.Type {
  return Schema.decodeUnknownSync(ChangelogAssetFile)({
    version: 1,
    generatedAt: cache.generatedAt,
    lastProcessedCommit: cache.lastProcessedCommit,
    groups: cache.groups,
    provenance: {
      rebuiltFromScratch: cache.rebuiltFromScratch,
      rebuildCommitLimit: cache.rebuildCommitLimit,
      promptVersion: cache.promptVersion,
      batches: cache.batches.map((batch) => batch.provenance),
    },
  });
}

function syncDistAsset(distClientDir: string) {
  if (!existsSync(changelogAssetPath)) {
    throw new Error(`Expected generated changelog asset at ${changelogAssetPath}.`);
  }

  const distAssetPath = path.join(distClientDir, DIST_CHANGELOG_ASSET_PATH);
  ensureParentDir(distAssetPath);
  writeFileSync(distAssetPath, readFileSync(changelogAssetPath));
  log(`Synced ${path.relative(repoRoot, changelogAssetPath)} -> ${distAssetPath}`);
}

function main() {
  const args = parseArgs();
  const headSha = resolveHeadSha();
  const existingCache = readChangelogCacheFile(changelogCachePath);

  const shouldRebuild =
    !existingCache?.lastProcessedCommit ||
    !commitExists(existingCache.lastProcessedCommit) ||
    !isAncestor(existingCache.lastProcessedCommit, headSha);

  const rangeCommitShas = shouldRebuild
    ? listCommitShas([`--max-count=${String(REBUILD_COMMIT_LIMIT)}`, "HEAD"])
    : listCommitShas([`${existingCache.lastProcessedCommit}..${headSha}`]);

  if (rangeCommitShas.length === 0 && existingCache) {
    log("No new commits detected; reusing existing changelog artifacts.");
    writeJsonFile(changelogCachePath, existingCache);
    writeJsonFile(changelogAssetPath, buildAsset(existingCache));
    if (args.syncDistDir) {
      syncDistAsset(args.distClientDir);
    }
    return;
  }

  const commits = rangeCommitShas.map(readCommitRecord);
  const batches = chunkCommits(commits);
  const previousBatches = shouldRebuild ? [] : (existingCache?.batches ?? []);
  const generatedBatches: ReadonlyArray<GeneratedBatch> = batches.map((batch, index) =>
    generateBatch(
      batch,
      index === 0
        ? shouldRebuild
          ? null
          : (existingCache?.lastProcessedCommit ?? null)
        : batches[index - 1]!.at(-1)!.sha,
    ),
  );

  const cache = Schema.decodeUnknownSync(ChangelogCacheFile)({
    version: 1,
    generatedAt: new Date().toISOString(),
    lastProcessedCommit: headSha,
    rebuiltFromScratch: shouldRebuild,
    rebuildCommitLimit: REBUILD_COMMIT_LIMIT,
    promptVersion: PROMPT_VERSION,
    uiOutputPath: CHANGELOG_ASSET_PATH,
    groups: mergeGroups([...previousBatches, ...generatedBatches]),
    batches: [
      ...previousBatches,
      ...generatedBatches.map((batch) => ({
        provenance: batch.provenance,
        groups: batch.groups,
      })),
    ],
  });

  writeJsonFile(changelogCachePath, cache);
  writeJsonFile(changelogAssetPath, buildAsset(cache));

  if (args.syncDistDir) {
    syncDistAsset(args.distClientDir);
  }

  log(
    `${shouldRebuild ? "Rebuilt" : "Updated"} changelog through ${headSha.slice(0, 12)} (${commits.length} commits).`,
  );
}

main();
