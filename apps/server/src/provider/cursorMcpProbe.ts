import type { CursorSettings, ResolvedMcpServer } from "@t3tools/contracts";

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

  return { stdout: result.stdout, stderr: result.stderr };
}
