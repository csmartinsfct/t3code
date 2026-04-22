#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as nodePath from "node:path";

const SEED_ENTRIES = [
  "state.sqlite",
  "state.sqlite-wal",
  "state.sqlite-shm",
  "attachments",
  "settings.json",
  "keybindings.json",
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function countProjects(dbPath: string): Promise<number | null> {
  if (!(await pathExists(dbPath))) return null;
  try {
    const out = execFileSync(
      "sqlite3",
      [dbPath, "SELECT COUNT(*) FROM projection_projects WHERE deleted_at IS NULL"],
      { encoding: "utf8" },
    );
    const parsed = Number.parseInt(out.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const rootBase = process.env.T3CODE_HOME?.trim() || nodePath.join(homedir(), ".t3");
  const source = nodePath.join(rootBase, "dev");
  const target = nodePath.join(rootBase, "dev-template");

  if (!(await pathExists(source))) {
    console.error(
      `snapshot-dev: no dev dir to snapshot at ${source}. Start the dev server once to create it.`,
    );
    process.exit(1);
  }

  if (await pathExists(target)) {
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.mkdir(target, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });
  const copied: string[] = [];
  for (const entry of entries) {
    if (!(SEED_ENTRIES as readonly string[]).includes(entry.name)) continue;
    const src = nodePath.join(source, entry.name);
    const dst = nodePath.join(target, entry.name);
    await fs.cp(src, dst, { recursive: true });
    copied.push(entry.name);
  }

  const projectCount = await countProjects(nodePath.join(target, "state.sqlite"));
  console.log(
    `snapshot-dev: captured ${copied.length} entries from ${source} → ${target}` +
      (projectCount !== null ? ` (${projectCount} active projects)` : ""),
  );
  if (copied.length === 0) {
    console.warn("snapshot-dev: source dir contained none of the seed entries; template is empty.");
  }
}

void main().catch((error: unknown) => {
  console.error("snapshot-dev: failed", error);
  process.exit(1);
});
