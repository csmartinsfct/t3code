import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
  cleanupCursorProcessTree,
  collectCursorDescendantProcesses,
  parseCursorProcessTable,
  type CursorProcessCleanupStage,
} from "./CursorProcessTree";

describe("parseCursorProcessTable", () => {
  it("parses ps pid/ppid/pgid output and skips malformed lines", () => {
    expect(
      parseCursorProcessTable(`
        10     1    10
        nope
        11    10    10
        12    11    12
      `),
    ).toEqual([
      { pid: 10, ppid: 1, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 10 },
      { pid: 12, ppid: 11, pgid: 12 },
    ]);
  });
});

describe("collectCursorDescendantProcesses", () => {
  it("collects descendants depth-first without including siblings", () => {
    const entries = [
      { pid: 10, ppid: 1, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 10 },
      { pid: 12, ppid: 11, pgid: 12 },
      { pid: 20, ppid: 1, pgid: 20 },
    ];

    expect(collectCursorDescendantProcesses(10, entries).map((entry) => entry.pid)).toEqual([
      11, 12,
    ]);
  });
});

describe("cleanupCursorProcessTree", () => {
  it("escalates from SIGINT to SIGTERM to SIGKILL while the root stays alive", async () => {
    const signals: string[] = [];
    const stages: CursorProcessCleanupStage[] = [];
    const terminator = vi.fn((pid: number, signal: "SIGINT" | "SIGTERM" | "SIGKILL") =>
      Effect.sync(() => {
        signals.push(`${pid}:${signal}`);
      }),
    );

    await Effect.runPromise(
      cleanupCursorProcessTree(123, {
        graceMs: 0,
        processTreeTerminator: terminator,
        isProcessRunning: () => true,
        onCleanupEvent: (event) =>
          Effect.sync(() => {
            stages.push(event.stage);
          }),
      }),
    );

    expect(signals).toEqual(["123:SIGINT", "123:SIGTERM", "123:SIGKILL"]);
    expect(stages).toEqual(["signal", "escalating", "force_kill", "complete"]);
  });

  it("stops escalation when the root exits after SIGINT", async () => {
    const signals: string[] = [];
    const stages: CursorProcessCleanupStage[] = [];
    const terminator = vi.fn((pid: number, signal: "SIGINT" | "SIGTERM" | "SIGKILL") =>
      Effect.sync(() => {
        signals.push(`${pid}:${signal}`);
      }),
    );

    await Effect.runPromise(
      cleanupCursorProcessTree(123, {
        graceMs: 0,
        processTreeTerminator: terminator,
        isProcessRunning: () => false,
        onCleanupEvent: (event) =>
          Effect.sync(() => {
            stages.push(event.stage);
          }),
      }),
    );

    expect(signals).toEqual(["123:SIGINT"]);
    expect(stages).toEqual(["signal", "exit_observed"]);
  });
});
