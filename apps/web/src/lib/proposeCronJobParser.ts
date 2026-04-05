const PROPOSE_CRON_JOB_LANGUAGE = "language-t3:propose-cron";

export interface ProposeCronJobPayload {
  name: string;
  description: string | null;
  cronExpression: string;
  projectId: string;
  skillId?: string;
  prompt?: string;
  autoSend: boolean;
}

/**
 * Check whether a code block's className indicates a `t3:propose-cron` block.
 */
export function isProposeCronJobBlock(className: string | undefined): boolean {
  return className?.includes(PROPOSE_CRON_JOB_LANGUAGE) === true;
}

/**
 * Safely parse a propose-cron JSON payload from a code block.
 * Returns null for incomplete (streaming), empty, or malformed content.
 */
export function parseProposeCronJobPayload(code: string): ProposeCronJobPayload | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const cronExpression =
      typeof record.cronExpression === "string" ? record.cronExpression.trim() : "";
    const projectId = typeof record.projectId === "string" ? record.projectId.trim() : "";

    if (name.length === 0 || cronExpression.length === 0 || projectId.length === 0) {
      return null;
    }

    const description =
      typeof record.description === "string" ? record.description.trim() || null : null;
    const skillId =
      typeof record.skillId === "string" && record.skillId.trim()
        ? record.skillId.trim()
        : undefined;
    const prompt =
      typeof record.prompt === "string" && record.prompt.trim() ? record.prompt.trim() : undefined;
    const autoSend = typeof record.autoSend === "boolean" ? record.autoSend : false;

    return {
      name,
      description,
      cronExpression,
      projectId,
      ...(skillId !== undefined ? { skillId } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      autoSend,
    };
  } catch {
    return null;
  }
}
