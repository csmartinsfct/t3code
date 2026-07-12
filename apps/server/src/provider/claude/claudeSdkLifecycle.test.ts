import type { TerminalReason } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import {
  classifyClaudeTerminalReason,
  normalizeClaudeBackgroundTasks,
} from "./claudeSdkLifecycle.ts";

describe("claudeSdkLifecycle", () => {
  it("classifies every 0.3.207 terminal reason and normalizes background replacements", () => {
    const expected = [
      ["completed", "completed"],
      ["background_requested", "completed"],
      ["tool_deferred", "completed"],
      ["aborted_streaming", "interrupted"],
      ["aborted_tools", "interrupted"],
      ["hook_stopped", "cancelled"],
      ["blocking_limit", "failed"],
      ["rapid_refill_breaker", "failed"],
      ["prompt_too_long", "failed"],
      ["image_error", "failed"],
      ["model_error", "failed"],
      ["api_error", "failed"],
      ["malformed_tool_use_exhausted", "failed"],
      ["stop_hook_prevented", "failed"],
      ["max_turns", "failed"],
      ["budget_exhausted", "failed"],
      ["structured_output_retry_exhausted", "failed"],
      ["tool_deferred_unavailable", "failed"],
      ["turn_setup_failed", "failed"],
    ] as const satisfies ReadonlyArray<readonly [TerminalReason, string]>;

    const reasons = expected.map(([reason]) => reason);
    expect({ count: reasons.length, uniqueCount: new Set(reasons).size }).toEqual({
      count: 19,
      uniqueCount: 19,
    });
    for (const [reason, status] of expected) {
      expect(classifyClaudeTerminalReason(reason)).toEqual({
        status,
        known: true,
        terminalReason: reason,
      });
    }

    expect(classifyClaudeTerminalReason("future_terminal_reason")).toEqual({
      status: "failed",
      known: false,
      terminalReason: "future_terminal_reason",
    });

    expect(
      normalizeClaudeBackgroundTasks({
        type: "system",
        subtype: "background_tasks_changed",
        uuid: "background-change-1",
        session_id: "session-1",
        tasks: [
          {
            task_id: " task-1 ",
            task_type: " shell ",
            description: " Run checks ",
          },
          {
            task_id: "task-2",
            task_type: "future-provider-task",
            description: "Unknown task type is preserved",
          },
          { task_id: "", task_type: "shell", description: "missing id" },
          { task_id: "task-3", task_type: " ", description: "missing type" },
          { task_id: "task-4", task_type: "shell", description: " " },
          null,
        ],
      } as never),
    ).toEqual({
      tasks: [
        { taskId: "task-1", taskType: "shell", description: "Run checks" },
        {
          taskId: "task-2",
          taskType: "future-provider-task",
          description: "Unknown task type is preserved",
        },
      ],
    });
  });
});
