import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import { settleClaudeMcpServers } from "./claudeMcpSettling.ts";

const status = (name: string, value: McpServerStatus["status"]): McpServerStatus => ({
  name,
  status: value,
});

describe("settleClaudeMcpServers", () => {
  it("polls through empty and pending inventories until every server is terminal", async () => {
    const inventories = [
      [],
      [status("github", "pending")],
      [status("github", "connected"), status("tickets", "needs-auth")],
    ];
    let readIndex = 0;
    let now = 0;

    const result = await settleClaudeMcpServers({
      readStatus: async () => inventories[readIndex++] ?? inventories.at(-1)!,
      signal: new AbortController().signal,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(result).toEqual(inventories.at(-1));
    expect(readIndex).toBe(3);
  });

  it("treats every non-pending Claude MCP status as terminal", async () => {
    const terminalStatuses = ["connected", "needs-auth", "failed", "disabled"] as const;

    for (const terminalStatus of terminalStatuses) {
      let reads = 0;
      const inventory = [status("server", terminalStatus)];
      const result = await settleClaudeMcpServers({
        readStatus: async () => {
          reads += 1;
          return inventory;
        },
        signal: new AbortController().signal,
      });

      expect(result, terminalStatus).toEqual(inventory);
      expect(reads, terminalStatus).toBe(1);
    }
  });

  it("returns the latest inventory at the deadline", async () => {
    const inventory = [status("github", "pending")];
    let hungReads = 0;
    const startedAt = Date.now();

    const hungResult = await settleClaudeMcpServers({
      readStatus: async () => {
        hungReads += 1;
        if (hungReads === 1) return inventory;
        return new Promise<McpServerStatus[]>(() => undefined);
      },
      signal: new AbortController().signal,
      deadlineMs: 20,
      pollIntervalMs: 1,
    });

    expect(hungResult).toEqual(inventory);
    expect(hungReads).toBe(2);
    expect(Date.now() - startedAt).toBeLessThan(500);

    let now = 0;
    let jumpedReads = 0;
    const jumpedResult = await settleClaudeMcpServers({
      readStatus: async () => {
        jumpedReads += 1;
        return jumpedReads === 1 ? inventory : [status("github", "connected")];
      },
      signal: new AbortController().signal,
      deadlineMs: 10,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms + 100;
      },
    });

    expect(jumpedResult).toEqual(inventory);
    expect(jumpedReads).toBe(1);
  }, 1_000);

  it("aborts promptly while waiting between polls", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const settling = settleClaudeMcpServers({
      readStatus: async () => [status("github", "pending")],
      signal: controller.signal,
      pollIntervalMs: 60_000,
    });

    controller.abort();

    await expect(settling).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
