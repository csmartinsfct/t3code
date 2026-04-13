import { ADMIN_PROMPT_SHIPPED_DEFAULTS } from "@t3tools/contracts";

/**
 * System prompt appended to provider sessions when ticketing REST API is available.
 * @deprecated Prompts are now stored in settings. Use `settings.prompts.admin.ticketing` instead.
 */
export const TICKETING_SYSTEM_PROMPT = ADMIN_PROMPT_SHIPPED_DEFAULTS.ticketing.blocks
  .map((b) => b.text)
  .join("");
