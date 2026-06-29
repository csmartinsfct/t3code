import type { ModelSelection } from "@t3tools/contracts";

const PROPOSE_SCHEDULED_TASK_LANGUAGE = "language-t3:propose-scheduled-task";

export interface ProposeScheduledTaskPayload {
  name: string;
  description: string | null;
  cronExpression: string;
  projectId: string;
  skillIds?: string[];
  prompt?: string;
  autoSend: boolean;
  modelSelection?: ModelSelection;
}

/**
 * Check whether a code block's className indicates a `t3:propose-scheduled-task` block.
 */
export function isProposeScheduledTaskBlock(className: string | undefined): boolean {
  return className?.includes(PROPOSE_SCHEDULED_TASK_LANGUAGE) === true;
}

/**
 * Safely parse a propose-scheduled-task JSON payload from a code block.
 * Returns null for incomplete (streaming), empty, or malformed content.
 */
export function parseProposeScheduledTaskPayload(code: string): ProposeScheduledTaskPayload | null {
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
    // Accept both skillIds (array) and legacy skillId (string → wrap in array)
    let skillIds: string[] | undefined;
    if (Array.isArray(record.skillIds)) {
      const filtered = record.skillIds.filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      if (filtered.length > 0) skillIds = filtered;
    } else if (typeof record.skillId === "string" && record.skillId.trim()) {
      skillIds = [record.skillId.trim()];
    }
    const prompt =
      typeof record.prompt === "string" && record.prompt.trim() ? record.prompt.trim() : undefined;
    const autoSend = typeof record.autoSend === "boolean" ? record.autoSend : false;
    const modelSelection = isModelSelectionRecord(record.modelSelection)
      ? record.modelSelection
      : undefined;

    return {
      name,
      description,
      cronExpression,
      projectId,
      ...(skillIds !== undefined ? { skillIds } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      autoSend,
      ...(modelSelection !== undefined ? { modelSelection } : {}),
    };
  } catch {
    return null;
  }
}

function isModelSelectionRecord(value: unknown): value is ModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ModelSelection>;
  return typeof candidate.provider === "string" && typeof candidate.model === "string";
}
