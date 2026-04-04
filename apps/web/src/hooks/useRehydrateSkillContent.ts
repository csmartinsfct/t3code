import { useEffect, useRef } from "react";

import type { ThreadId } from "@t3tools/contracts";
import { useComposerDraftStore, type ComposerSkillAttachment } from "../composerDraftStore";
import { readNativeApi } from "../nativeApi";

const EMPTY_SKILLS: readonly ComposerSkillAttachment[] = [];

/**
 * After store rehydration from localStorage, skill attachments have
 * `content: null`.  This hook re-reads the file content from the server
 * and silently drops any skills whose files no longer exist.
 */
export function useRehydrateSkillContent(
  threadId: ThreadId | undefined,
  cwd: string | undefined,
): void {
  const rehydratedRef = useRef<Set<string>>(new Set());

  const skills = useComposerDraftStore((s) => {
    if (!threadId) return EMPTY_SKILLS;
    return s.draftsByThreadId[threadId]?.skills ?? EMPTY_SKILLS;
  });

  useEffect(() => {
    if (!threadId || !cwd) return;

    const pendingSkills = skills.filter(
      (s) => s.content === null && !rehydratedRef.current.has(s.id),
    );
    if (pendingSkills.length === 0) return;

    const api = readNativeApi();
    if (!api) return;

    // Mark as in-flight to avoid duplicate requests.
    for (const s of pendingSkills) {
      rehydratedRef.current.add(s.id);
    }

    api.server
      .resolveSkills({ cwd })
      .then((result) => {
        const store = useComposerDraftStore.getState();
        const resolved = new Map(result.skills.map((s) => [s.id, s.content]));

        for (const skill of pendingSkills) {
          const content = resolved.get(skill.id);
          if (content !== undefined) {
            // File still exists — update content.
            store.addSkill(threadId, { ...skill, content });
          } else {
            // File was deleted — drop silently.
            store.removeSkill(threadId, skill.id);
          }
        }
      })
      .catch(() => {
        // On error, remove all pending skills — we can't verify them.
        const store = useComposerDraftStore.getState();
        for (const skill of pendingSkills) {
          store.removeSkill(threadId, skill.id);
        }
      });
  }, [threadId, cwd, skills]);
}
