import { ADMIN_PROMPT_SHIPPED_DEFAULTS } from "@t3tools/contracts";

/**
 * System prompt appended to provider sessions when scheduled tasks REST API is available.
 * @deprecated Prompts are now stored in settings. Use `settings.prompts.admin.scheduledTasks` instead.
 */
export const SCHEDULED_TASKS_SYSTEM_PROMPT = ADMIN_PROMPT_SHIPPED_DEFAULTS.scheduledTasks.blocks
  .map((b) => b.text)
  .join("");
