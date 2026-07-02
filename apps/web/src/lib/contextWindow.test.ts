import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.makeUnsafe("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("includes categorized context usage when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 65_000,
        maxTokens: 200_000,
        breakdown: {
          totalTokens: 65_000,
          maxTokens: 200_000,
          model: "claude-opus-4-8",
          categories: [
            { name: "Messages", tokens: 45_000, color: "#22c55e" },
            { name: "Tools", tokens: 8_000, color: "#f59e0b" },
          ],
          messageBreakdown: {
            toolCallTokens: 1000,
            toolResultTokens: 7000,
            attachmentTokens: 0,
            assistantMessageTokens: 20_000,
            userMessageTokens: 25_000,
            redirectedContextTokens: 0,
            unattributedTokens: 0,
            toolCallsByType: [{ name: "Bash", callTokens: 1000, resultTokens: 7000 }],
            attachmentsByType: [],
          },
        },
      }),
    ]);

    expect(snapshot?.breakdown?.model).toBe("claude-opus-4-8");
    expect(snapshot?.breakdown?.categories).toEqual([
      { name: "Messages", tokens: 45_000, color: "#22c55e" },
      { name: "Tools", tokens: 8_000, color: "#f59e0b" },
    ]);
    expect(snapshot?.breakdown?.messageBreakdown?.toolResultTokens).toBe(7000);
  });
});
