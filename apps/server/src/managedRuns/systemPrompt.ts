import { ADMIN_PROMPT_SHIPPED_DEFAULTS } from "@t3tools/contracts";

/**
 * System prompt appended to provider sessions when managed runs REST API is available.
 * @deprecated Prompts are now stored in settings. Use `settings.prompts.admin.managedRuns` instead.
 */
export const MANAGED_RUNS_SYSTEM_PROMPT = ADMIN_PROMPT_SHIPPED_DEFAULTS.managedRuns.blocks
  .map((b) => b.text)
  .join("");
