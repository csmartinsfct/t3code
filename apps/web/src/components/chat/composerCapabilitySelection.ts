import type {
  ProviderCapabilityEntry,
  SelectedProviderCapability,
  SkillEntry,
} from "@t3tools/contracts";

import type { ComposerTrigger } from "../../composer-logic";

type ProviderCapabilityAttachmentItem = {
  id: string;
  type: "provider-capability";
  capability: ProviderCapabilityEntry;
  label: string;
  description: string;
};

type LocalSkillAttachmentItem = {
  id: string;
  type: "local-skill";
  skillId: string;
  label: string;
  description: string;
};

type ComposerAttachmentItem = ProviderCapabilityAttachmentItem | LocalSkillAttachmentItem;

type ApplyPromptReplacement = (
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
  options: { expectedText: string },
) => boolean;

function extendReplacementRangeForTrailingSpace(
  text: string,
  rangeEnd: number,
  replacement: string,
): number {
  return replacement.endsWith(" ") && text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
}

export function toSelectedProviderCapability(
  capability: ProviderCapabilityEntry,
): SelectedProviderCapability {
  return {
    provider: capability.provider,
    kind: capability.kind,
    id: capability.id,
    ...(capability.name ? { name: capability.name } : {}),
    ...(capability.path ? { path: capability.path } : {}),
    displayName: capability.displayName,
    ...(capability.parentId ? { parentId: capability.parentId } : {}),
    ...(capability.parentDisplayName ? { parentDisplayName: capability.parentDisplayName } : {}),
  };
}

export function selectComposerAttachment(input: {
  item: ComposerAttachmentItem;
  availableSkills: ReadonlyArray<SkillEntry>;
  snapshot: { value: string };
  trigger: ComposerTrigger;
  applyPromptReplacement: ApplyPromptReplacement;
  onAttachProviderCapability: (capability: ProviderCapabilityEntry) => void;
  onAttachSkill: (skill: SkillEntry) => void;
}): boolean {
  if (input.item.type === "provider-capability") {
    const replacement = "";
    const applied = replaceActiveTrigger(input, replacement);
    if (applied) {
      input.onAttachProviderCapability(input.item.capability);
    }
    return applied;
  }

  const localSkillItem = input.item as LocalSkillAttachmentItem;
  const skill = input.availableSkills.find((candidate) => candidate.id === localSkillItem.skillId);
  if (!skill) return false;
  const replacement = "";
  const applied = replaceActiveTrigger(input, replacement);
  if (applied) {
    input.onAttachSkill(skill);
  }
  return applied;
}

function replaceActiveTrigger(
  input: Pick<
    Parameters<typeof selectComposerAttachment>[0],
    "snapshot" | "trigger" | "applyPromptReplacement"
  >,
  replacement: string,
): boolean {
  const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
    input.snapshot.value,
    input.trigger.rangeEnd,
    replacement,
  );
  const applied = input.applyPromptReplacement(
    input.trigger.rangeStart,
    replacementRangeEnd,
    replacement,
    {
      expectedText: input.snapshot.value.slice(input.trigger.rangeStart, replacementRangeEnd),
    },
  );
  if (!applied) return false;
  return true;
}
