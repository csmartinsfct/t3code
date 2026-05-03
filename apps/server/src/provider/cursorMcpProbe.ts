import type { CursorSettings, ResolvedMcpServer } from "@t3tools/contracts";

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { runProcess } from "../processRunner.ts";
import { buildCursorAcpEnv } from "./cursor/CursorAcpConnection.ts";

const CURSOR_MCP_LIST_TIMEOUT_MS = 10_000;
const CURSOR_MCP_ACTION_TIMEOUT_MS = 180_000;
const CURSOR_MCP_ACTION_BY_T3_ACTION = {
  approve: "enable",
  login: "login",
  disable: "disable",
} as const;

export type CursorMcpAction = keyof typeof CURSOR_MCP_ACTION_BY_T3_ACTION;

function buildCursorMcpCommand(
  settings: CursorSettings,
  args: ReadonlyArray<string>,
): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  const launchCommand = settings.launchCommand.filter((part) => part.trim().length > 0);
  if (launchCommand.length > 0) {
    return {
      command: launchCommand[0] ?? settings.binaryPath,
      args: [...launchCommand.slice(1), "mcp", ...args],
    };
  }
  return { command: settings.binaryPath, args: ["mcp", ...args] };
}

export function buildCursorMcpListCommand(settings: CursorSettings): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  return buildCursorMcpCommand(settings, ["list"]);
}

export function buildCursorMcpActionCommand(
  settings: CursorSettings,
  action: CursorMcpAction,
  identifier: string,
): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  return buildCursorMcpCommand(settings, [CURSOR_MCP_ACTION_BY_T3_ACTION[action], identifier]);
}

export function parseCursorMcpListOutput(output: string): ReadonlyArray<ResolvedMcpServer> {
  const servers: ResolvedMcpServer[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) continue;

    const name = trimmed.slice(0, separatorIndex).trim();
    const status = trimmed.slice(separatorIndex + 1).trim();
    if (!name || seen.has(name)) continue;

    seen.add(name);
    servers.push({
      name,
      ...(status ? { status } : {}),
    });
  }

  return servers.toSorted((left, right) => left.name.localeCompare(right.name));
}

export async function probeCursorMcpServers(input: {
  readonly settings: CursorSettings;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}): Promise<ReadonlyArray<ResolvedMcpServer>> {
  const command = buildCursorMcpListCommand(input.settings);
  const result = await runProcess(command.command, command.args, {
    cwd: input.cwd,
    env: buildCursorAcpEnv(input.settings),
    timeoutMs: input.timeoutMs ?? CURSOR_MCP_LIST_TIMEOUT_MS,
    maxBufferBytes: 256 * 1024,
  });

  return parseCursorMcpListOutput(result.stdout);
}

export async function runCursorMcpAction(input: {
  readonly settings: CursorSettings;
  readonly cwd?: string;
  readonly action: CursorMcpAction;
  readonly identifier: string;
  readonly timeoutMs?: number;
}): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const command = buildCursorMcpActionCommand(input.settings, input.action, input.identifier);
  const result = await runProcess(command.command, command.args, {
    cwd: input.cwd,
    env: buildCursorAcpEnv(input.settings),
    timeoutMs: input.timeoutMs ?? CURSOR_MCP_ACTION_TIMEOUT_MS,
    maxBufferBytes: 512 * 1024,
  });

  if (input.action === "approve" && input.cwd) {
    await approveCursorMcpServerForProject(input.settings, input.cwd, input.identifier);
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

export function cursorProjectSlug(cwd: string): string {
  return path
    .resolve(cwd)
    .replace(/[^a-zA-Z0-9]/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function cursorMcpApprovalKey(input: {
  readonly cwd: string;
  readonly serverName: string;
  readonly serverConfig: unknown;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ path: path.resolve(input.cwd), server: input.serverConfig }))
    .digest("hex")
    .slice(0, 16);
  return `${input.serverName}-${digest}`;
}

async function approveCursorMcpServerForProject(
  settings: CursorSettings,
  cwd: string,
  serverName: string,
): Promise<void> {
  const cursorConfigDir = settings.configDir.trim() || path.join(os.homedir(), ".cursor");
  const serverConfig = await readCursorMcpServerConfig(cursorConfigDir, cwd, serverName);
  if (serverConfig === undefined) {
    return;
  }

  const projectDir = path.join(cursorConfigDir, "projects", cursorProjectSlug(cwd));
  const approvalPath = path.join(projectDir, "mcp-approvals.json");
  const approvalKey = cursorMcpApprovalKey({ cwd, serverName, serverConfig });
  const approvals = await readApprovalList(approvalPath);
  if (approvals.includes(approvalKey)) {
    return;
  }

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(approvalPath, `${JSON.stringify([...approvals, approvalKey], null, 2)}\n`);
}

async function readCursorMcpServerConfig(
  cursorConfigDir: string,
  cwd: string,
  serverName: string,
): Promise<unknown> {
  const configPaths = [
    path.join(path.resolve(cwd), ".cursor", "mcp.json"),
    path.join(cursorConfigDir, "mcp.json"),
  ];

  for (const configPath of configPaths) {
    const config = await readJsonObject(configPath);
    const servers = isRecord(config?.mcpServers) ? config.mcpServers : undefined;
    if (servers && serverName in servers) {
      return servers[serverName];
    }
  }

  return undefined;
}

async function readApprovalList(filePath: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
