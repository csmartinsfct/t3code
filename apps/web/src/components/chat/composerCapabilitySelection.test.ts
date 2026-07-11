import type { ProviderCapabilityEntry, SkillEntry } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { selectComposerAttachment } from "./composerCapabilitySelection";

const providerCapability = {
  id: "superpowers@openai-curated-remote",
  provider: "codex",
  kind: "plugin",
  name: "superpowers",
  displayName: "Superpowers",
  enabled: true,
  installed: true,
} satisfies ProviderCapabilityEntry;

const localSkill = {
  id: "local-skill",
  name: "Local Skill",
  source: "workspace",
  absolutePath: "/repo/.agents/skills/local-skill.md",
  relativePath: ".agents/skills/local-skill.md",
  content: "# Local Skill",
  group: null,
} satisfies SkillEntry;

const trigger = {
  kind: "path" as const,
  query: "sup",
  rangeStart: 0,
  rangeEnd: 4,
};

describe("selectComposerAttachment", () => {
  it("attaches a provider capability only after replacing its active trigger", () => {
    const attachProviderCapability = vi.fn();
    const applyPromptReplacement = vi.fn(() => true);

    const applied = selectComposerAttachment({
      item: {
        id: "provider-capability:codex:plugin:superpowers@openai-curated-remote",
        type: "provider-capability",
        capability: providerCapability,
        label: "Superpowers",
        description: "Plugin",
      },
      availableSkills: [localSkill],
      snapshot: { value: "@sup" },
      trigger,
      applyPromptReplacement,
      onAttachProviderCapability: attachProviderCapability,
      onAttachSkill: vi.fn(),
    });

    expect(applied).toBe(true);
    expect(applyPromptReplacement).toHaveBeenCalledWith(0, 4, "@Superpowers ", {
      expectedText: "@sup",
    });
    expect(attachProviderCapability).toHaveBeenCalledWith(providerCapability);
    expect(applyPromptReplacement.mock.invocationCallOrder[0]).toBeLessThan(
      attachProviderCapability.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("does not attach a provider capability when replacement is rejected", () => {
    const attachProviderCapability = vi.fn();

    const applied = selectComposerAttachment({
      item: {
        id: "provider-capability:codex:plugin:superpowers@openai-curated-remote",
        type: "provider-capability",
        capability: providerCapability,
        label: "Superpowers",
        description: "Plugin",
      },
      availableSkills: [localSkill],
      snapshot: { value: "@sup" },
      trigger,
      applyPromptReplacement: vi.fn(() => false),
      onAttachProviderCapability: attachProviderCapability,
      onAttachSkill: vi.fn(),
    });

    expect(applied).toBe(false);
    expect(attachProviderCapability).not.toHaveBeenCalled();
  });

  it("attaches a local skill only after replacing its active trigger", () => {
    const attachSkill = vi.fn();
    const applyPromptReplacement = vi.fn(() => true);

    const applied = selectComposerAttachment({
      item: {
        id: "local-skill:local-skill",
        type: "local-skill",
        skillId: localSkill.id,
        label: localSkill.name,
        description: "Local skill",
      },
      availableSkills: [localSkill],
      snapshot: { value: "@sup" },
      trigger,
      applyPromptReplacement,
      onAttachProviderCapability: vi.fn(),
      onAttachSkill: attachSkill,
    });

    expect(applied).toBe(true);
    expect(applyPromptReplacement).toHaveBeenCalledWith(0, 4, "@Local Skill ", {
      expectedText: "@sup",
    });
    expect(attachSkill).toHaveBeenCalledWith(localSkill);
    expect(applyPromptReplacement.mock.invocationCallOrder[0]).toBeLessThan(
      attachSkill.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("does not attach a local skill when replacement is rejected", () => {
    const attachSkill = vi.fn();

    const applied = selectComposerAttachment({
      item: {
        id: "local-skill:local-skill",
        type: "local-skill",
        skillId: localSkill.id,
        label: localSkill.name,
        description: "Local skill",
      },
      availableSkills: [localSkill],
      snapshot: { value: "@sup" },
      trigger,
      applyPromptReplacement: vi.fn(() => false),
      onAttachProviderCapability: vi.fn(),
      onAttachSkill: attachSkill,
    });

    expect(applied).toBe(false);
    expect(attachSkill).not.toHaveBeenCalled();
  });
});
