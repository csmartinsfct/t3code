import type {
  ProviderCapabilityEntry,
  SelectedProviderCapability,
  SkillEntry,
} from "@t3tools/contracts";
import { baseProviderKind } from "@t3tools/contracts";

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

export function providerCapabilitySelectionKey(
  capability: Pick<SelectedProviderCapability, "provider" | "kind" | "id">,
): string {
  return `${capability.provider}\u0000${capability.kind}\u0000${capability.id}`;
}

export function isActivatableProviderCapability(capability: SelectedProviderCapability): boolean {
  if (baseProviderKind(capability.provider) !== "codex") return false;
  if (capability.kind === "skill" && capability.name && capability.path) return true;
  return Boolean(
    capability.capabilityRootPath &&
    capability.appIds !== undefined &&
    capability.appIds.length > 0,
  );
}

export function isDefaultEnabledProviderCapability(
  capability: SelectedProviderCapability,
): boolean {
  return (
    baseProviderKind(capability.provider) === "codex" &&
    capability.capabilityRootPath !== undefined &&
    capability.appIds !== undefined &&
    capability.appIds.length > 0
  );
}

export function isActivatableProviderCapabilityForProvider(
  capability: SelectedProviderCapability,
  provider: SelectedProviderCapability["provider"],
): boolean {
  return capability.provider === provider && isActivatableProviderCapability(capability);
}

export function defaultProviderCapabilitiesForProvider(
  capabilities: ReadonlyArray<ProviderCapabilityEntry>,
  provider: SelectedProviderCapability["provider"],
): SelectedProviderCapability[] {
  const seenRoots = new Set<string>();
  const selected: SelectedProviderCapability[] = [];
  for (const capability of capabilities) {
    const selection = toSelectedProviderCapability(capability);
    if (selection.provider !== provider || !isDefaultEnabledProviderCapability(selection)) {
      continue;
    }
    const root = selection.capabilityRootPath;
    if (!root || seenRoots.has(root)) continue;
    seenRoots.add(root);
    selected.push(selection);
  }
  return selected;
}

export function mergeProviderCapabilitiesForSend(
  selectedCapabilities: ReadonlyArray<SelectedProviderCapability>,
  defaultCapabilities: ReadonlyArray<SelectedProviderCapability>,
): SelectedProviderCapability[] {
  const merged: SelectedProviderCapability[] = [];
  const seenPlugins = new Set<string>();
  const seenSelections = new Set<string>();
  for (const capability of [...defaultCapabilities, ...selectedCapabilities]) {
    const selectionKey = providerCapabilitySelectionKey(capability);
    if (seenSelections.has(selectionKey)) continue;
    if (capability.kind === "plugin" && capability.capabilityRootPath) {
      const pluginKey = `${capability.provider}\u0000${capability.capabilityRootPath}`;
      if (seenPlugins.has(pluginKey)) continue;
      seenPlugins.add(pluginKey);
    }
    seenSelections.add(selectionKey);
    merged.push(capability);
  }
  return merged;
}

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
    ...(capability.capabilityRootPath ? { capabilityRootPath: capability.capabilityRootPath } : {}),
    ...(capability.appIds ? { appIds: [...capability.appIds] } : {}),
    ...(capability.iconPath ? { iconPath: capability.iconPath } : {}),
    ...(capability.iconUrl ? { iconUrl: capability.iconUrl } : {}),
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
