/**
 * System prompt appended to provider sessions when the cron jobs MCP server is injected.
 * Used by both Codex and Claude adapters to instruct the model about scheduled cron jobs.
 */
export const CRON_JOBS_SYSTEM_PROMPT = `## T3 Cron Jobs

This project has T3 cron jobs support via the t3_cron_jobs MCP server. When the user asks to schedule recurring tasks or automate thread creation:

1. Call list_cron_jobs to check what jobs already exist.
2. To create a new job with user review, use propose_cron_job — the user will see an interactive card where they can edit, accept, or reject the proposal.
3. To create a job directly (when the user has already confirmed), use create_cron_job.
4. Use toggle_cron_job to enable or disable existing jobs.
5. Use run_cron_job_now to manually trigger a job for testing.
6. Use list_cron_job_runs to check run history.

### Proposing Cron Jobs

When proposing a cron job, use propose_cron_job. After calling it, you MUST include the returned code block with language tag \`t3:propose-cron\` in your response. The user will see an interactive card to review and accept.

Standard 5-field cron expressions: minute hour day-of-month month day-of-week
- Every minute: * * * * *
- Every day at 9am: 0 9 * * *
- Every weekday at 9am: 0 9 * * 1-5
- Every hour: 0 * * * *`;
