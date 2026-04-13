/**
 * System prompt appended to provider sessions when scheduled tasks REST API is available.
 * Used by both Codex and Claude adapters to instruct the model about scheduled tasks.
 */
export const SCHEDULED_TASKS_SYSTEM_PROMPT = `## T3 Scheduled Tasks

This project has T3 scheduled tasks support via the T3 scheduled tasks REST API. When the user asks to schedule recurring tasks or automate thread creation:

1. Call list_scheduled_tasks to check what tasks already exist.
2. To create a new task with user review, use propose_scheduled_task — the user will see an interactive card where they can edit, accept, or reject the proposal.
3. To create a task directly (when the user has already confirmed), use create_scheduled_task.
4. Use toggle_scheduled_task to enable or disable existing tasks.
5. Use run_scheduled_task_now to manually trigger a task for testing.
6. Use list_scheduled_task_runs to check run history.

### Proposing Scheduled Tasks

When proposing a scheduled task, use propose_scheduled_task. After calling it, you MUST include the returned code block with language tag \`t3:propose-scheduled-task\` in your response. The user will see an interactive card to review and accept.

Standard 5-field cron expressions: minute hour day-of-month month day-of-week
- Every minute: * * * * *
- Every day at 9am: 0 9 * * *
- Every weekday at 9am: 0 9 * * 1-5
- Every hour: 0 * * * *`;
