import type { CursorSettings, ResolvedMcpServer } from "@t3tools/contracts";

import { runProcess } from "../processRunner.ts";
import { buildCursorAcpEnv } from "./cursor/CursorAcpConnection.ts";

const CURSOR_MCP_LIST_TIMEOUT_MS = 10_000;

export function buildCursorMcpCommand(settings: CursorSettings): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  const launchCommand = settings.launchCommand.filter((part) => part.trim().length > 0);
  if (launchCommand.length > 0) {
    return {
      command: launchCommand[0] ?? settings.binaryPath,
      args: [...launchCommand.slice(1), "mcp", "list"],
    };
  }
  return { command: settings.binaryPath, args: ["mcp", "list"] };
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
  const command = buildCursorMcpCommand(input.settings);
  const result = await runProcess(command.command, command.args, {
    cwd: input.cwd,
    env: buildCursorAcpEnv(input.settings),
    timeoutMs: input.timeoutMs ?? CURSOR_MCP_LIST_TIMEOUT_MS,
    maxBufferBytes: 256 * 1024,
  });

  return parseCursorMcpListOutput(result.stdout);
}
