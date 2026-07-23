import type {
  SDKBackgroundTasksChangedMessage,
  TerminalReason,
} from "@anthropic-ai/claude-agent-sdk";
import {
  RuntimeTaskId,
  type ProviderRuntimeTurnStatus,
  type TaskBackgroundChangedPayload,
} from "@t3tools/contracts";

const CLAUDE_TERMINAL_STATUS = {
  completed: "completed",
  background_requested: "completed",
  tool_deferred: "completed",
  aborted_streaming: "interrupted",
  aborted_tools: "interrupted",
  hook_stopped: "cancelled",
  blocking_limit: "failed",
  rapid_refill_breaker: "failed",
  prompt_too_long: "failed",
  image_error: "failed",
  model_error: "failed",
  api_error: "failed",
  malformed_tool_use_exhausted: "failed",
  stop_hook_prevented: "failed",
  max_turns: "failed",
  budget_exhausted: "failed",
  structured_output_retry_exhausted: "failed",
  tool_deferred_unavailable: "failed",
  turn_setup_failed: "failed",
} satisfies Record<TerminalReason, ProviderRuntimeTurnStatus>;

export function classifyClaudeTerminalReason(reason: string): {
  status: ProviderRuntimeTurnStatus;
  known: boolean;
  terminalReason: string;
} {
  if (Object.prototype.hasOwnProperty.call(CLAUDE_TERMINAL_STATUS, reason)) {
    return {
      status: CLAUDE_TERMINAL_STATUS[reason as TerminalReason],
      known: true,
      terminalReason: reason,
    };
  }

  return {
    status: "failed",
    known: false,
    terminalReason: reason,
  };
}

export function normalizeClaudeBackgroundTasks(
  message: SDKBackgroundTasksChangedMessage,
): TaskBackgroundChangedPayload {
  const tasks = Array.isArray(message.tasks) ? message.tasks : [];

  return {
    tasks: tasks.flatMap((task) => {
      if (!task || typeof task !== "object") {
        return [];
      }

      const taskId = typeof task.task_id === "string" ? task.task_id.trim() : "";
      const taskType = typeof task.task_type === "string" ? task.task_type.trim() : "";
      const description = typeof task.description === "string" ? task.description.trim() : "";
      if (!taskId || !taskType || !description) {
        return [];
      }

      return [
        {
          taskId: RuntimeTaskId.makeUnsafe(taskId),
          taskType,
          description,
        },
      ];
    }),
  };
}
