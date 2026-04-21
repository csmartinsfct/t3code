#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ProcessInfo {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const webRoot = join(repoRoot, "apps", "web");
const rendererPort = Number(process.env.ELECTRON_RENDERER_PORT ?? process.env.PORT ?? 5733);
const dryRun = process.argv.includes("--dry-run");
const supervisorMode = process.argv.includes("--supervisor");
const logPath =
  process.env.T3CODE_RESTART_ELECTRON_LOG ??
  join(process.env.T3CODE_HOME ?? join(homedir(), ".t3"), "logs", "electron-dev-restart.log");
const supervisorDelayMs = 500;

const cwdCache = new Map<number, string | null>();

function log(message: string): void {
  console.log(`[restart-electron-dev] ${message}`);
}

function readProcessTable(): ProcessInfo[] {
  const result = spawnSync("ps", ["-eo", "pid=,ppid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to read process table: ${result.stderr.trim() || "ps exited non-zero"}`,
    );
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!match) return [];
      return [
        {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          command: match[3] ?? "",
        },
      ];
    });
}

function resolveProcessCwd(pid: number): string | null {
  const cached = cwdCache.get(pid);
  if (cached !== undefined) return cached;

  let cwd: string | null = null;
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0) {
      cwd =
        result.stdout
          .split(/\r?\n/)
          .find((line) => line.startsWith("n"))
          ?.slice(1)
          .trim() || null;
    }
  }

  cwdCache.set(pid, cwd);
  return cwd;
}

function isInsidePath(candidate: string | null, parent: string): boolean {
  if (!candidate) return false;
  const diff = relative(parent, candidate);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function isCurrentProcessTree(processes: ProcessInfo[], pid: number): boolean {
  let currentPid = pid;
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  while (currentPid > 0) {
    if (currentPid === process.pid) return true;
    const parent = byPid.get(currentPid)?.ppid;
    if (!parent || parent === currentPid) return false;
    currentPid = parent;
  }
  return false;
}

function matchesElectronDevProcess(processInfo: ProcessInfo, processes: ProcessInfo[]): boolean {
  const command = processInfo.command;
  const hasDevRootMarker = command.includes(`--t3code-dev-root=${desktopRoot}`);
  const mayBeRepoDevProcess =
    /\bbun(?:\s+\S+)*\s+run\s+dev:desktop\b/.test(command) ||
    command.includes("dev-runner.ts dev:desktop") ||
    command.includes("turbo run dev") ||
    command.includes("scripts/dev-electron.mjs") ||
    command.includes("dev-electron.mjs") ||
    command.includes("tsdown") ||
    command.includes("vite");

  if (!hasDevRootMarker && !mayBeRepoDevProcess) {
    return false;
  }
  if (processInfo.pid === process.pid || isCurrentProcessTree(processes, processInfo.pid)) {
    return false;
  }

  if (hasDevRootMarker) {
    return true;
  }

  const cwd = resolveProcessCwd(processInfo.pid);
  const inRepo = isInsidePath(cwd, repoRoot);
  if (!inRepo) return false;

  if (/\bbun(?:\s+\S+)*\s+run\s+dev:desktop\b/.test(command)) return true;
  if (command.includes("dev-runner.ts dev:desktop")) return true;
  if (
    command.includes("turbo run dev") &&
    command.includes("--filter=@t3tools/desktop") &&
    command.includes("--filter=@t3tools/web")
  ) {
    return true;
  }
  if (command.includes("scripts/dev-electron.mjs") || command.includes("dev-electron.mjs")) {
    return true;
  }
  if (command.includes("tsdown") && command.includes("--watch") && isInsidePath(cwd, desktopRoot)) {
    return true;
  }
  if (command.includes("vite") && isInsidePath(cwd, webRoot)) {
    return true;
  }

  return false;
}

function readPortListenerPids(port: number): number[] {
  if (!Number.isInteger(port) || port <= 0) return [];
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function collectDescendants(processes: ProcessInfo[], rootPids: Iterable<number>): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? [];
    children.push(processInfo.pid);
    childrenByParent.set(processInfo.ppid, children);
  }

  const collected = new Set<number>();
  const stack = Array.from(rootPids);
  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || collected.has(pid) || pid === process.pid) continue;
    collected.add(pid);
    for (const childPid of childrenByParent.get(pid) ?? []) {
      stack.push(childPid);
    }
  }

  return collected;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: string }).code : null;
    return code === "EPERM";
  }
}

function signalPids(pids: Iterable<number>, signal: NodeJS.Signals): void {
  for (const pid of Array.from(pids).toSorted((left, right) => right - left)) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null ? (error as { code?: string }).code : null;
      if (code !== "ESRCH") {
        log(`failed to send ${signal} to pid ${pid}: ${String(error)}`);
      }
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopElectronDevProcesses(): Promise<void> {
  const processes = readProcessTable();
  const matchedPids = new Set(
    processes
      .filter((processInfo) => matchesElectronDevProcess(processInfo, processes))
      .map((processInfo) => processInfo.pid),
  );

  for (const pid of readPortListenerPids(rendererPort)) {
    if (isInsidePath(resolveProcessCwd(pid), repoRoot)) {
      matchedPids.add(pid);
    }
  }

  const killPids = collectDescendants(processes, matchedPids);
  if (killPids.size === 0) {
    log("no existing Electron dev processes found");
    return;
  }

  if (dryRun) {
    log(`would stop ${killPids.size} process(es): ${Array.from(killPids).toSorted().join(", ")}`);
    return;
  }

  log(`stopping ${killPids.size} process(es): ${Array.from(killPids).toSorted().join(", ")}`);
  signalPids(killPids, "SIGTERM");
  await sleep(1_500);

  const survivors = Array.from(killPids).filter(isAlive);
  if (survivors.length > 0) {
    log(`force stopping ${survivors.length} process(es): ${survivors.toSorted().join(", ")}`);
    signalPids(survivors, "SIGKILL");
    await sleep(300);
  }
}

function appendLogHeader(message: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `\n[restart-electron-dev] ${message} at ${new Date().toISOString()}\n`);
}

function startDetachedDevStack(): number {
  appendLogHeader("starting bun run dev:desktop");
  const logFd = openSync(logPath, "a");
  const child = spawn("bun", ["run", "dev:desktop"], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      T3CODE_RESTARTED_BY_ACTION: "1",
    },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  return child.pid ?? -1;
}

function startDetachedSupervisor(): number {
  appendLogHeader("restart requested");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [scriptPath, "--supervisor"], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      T3CODE_RESTART_ELECTRON_SUPERVISOR: "1",
    },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  return child.pid ?? -1;
}

async function main(): Promise<void> {
  if (process.platform === "win32") {
    throw new Error("restart-electron-dev currently supports POSIX platforms only.");
  }

  if (dryRun) {
    await stopElectronDevProcesses();
    log("dry run complete; not starting Electron dev stack");
    return;
  }

  if (!supervisorMode) {
    const pid = startDetachedSupervisor();
    log(`spawned detached restart supervisor with pid ${pid}`);
    log(`logs: ${logPath}`);
    return;
  }

  log(`supervisor waiting ${supervisorDelayMs}ms before restart`);
  await sleep(supervisorDelayMs);
  await stopElectronDevProcesses();
  const pid = startDetachedDevStack();
  log(`started detached Electron dev stack with pid ${pid}`);
  log(`logs: ${logPath}`);
}

main().catch((error) => {
  console.error(`[restart-electron-dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
