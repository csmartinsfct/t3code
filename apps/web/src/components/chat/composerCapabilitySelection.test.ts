import type {
  ProviderCapabilityEntry,
  SelectedProviderCapability,
  SkillEntry,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  defaultProviderCapabilitiesForProvider,
  isActivatableProviderCapabilityForProvider,
  isActivatableProviderCapability,
  mergeProviderCapabilitiesForSend,
  providerCapabilitySelectionKey,
  selectComposerAttachment,
  toSelectedProviderCapability,
} from "./composerCapabilitySelection";

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
  it("builds a provider-scoped selection key", () => {
    expect(
      providerCapabilitySelectionKey({
        provider: "codex:zbd",
        kind: "skill",
        id: "superpowers:using-superpowers",
      }),
    ).toBe("codex:zbd\u0000skill\u0000superpowers:using-superpowers");
  });

  it("treats Codex skills with activation fields as activatable provider capabilities", () => {
    expect(
      isActivatableProviderCapability({
        provider: "codex:zbd",
        kind: "skill",
        id: "superpowers:using-superpowers",
        name: "superpowers:using-superpowers",
        path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        displayName: "Using Superpowers",
      }),
    ).toBe(true);
  });

  it("does not treat plugin chips as activatable provider capabilities", () => {
    expect(
      isActivatableProviderCapability({
        provider: "codex",
        kind: "plugin",
        id: "superpowers@openai-curated-remote",
        name: "superpowers",
        displayName: "Superpowers",
      }),
    ).toBe(false);
  });

  it("treats app-backed Codex plugins as activatable provider capabilities", () => {
    expect(
      isActivatableProviderCapability({
        provider: "codex",
        kind: "plugin",
        id: "gmail@openai-curated-remote",
        name: "gmail",
        displayName: "Gmail",
        capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
        appIds: ["connector_2128aebfecb84f64a069897515042a44"],
      }),
    ).toBe(true);
  });

  it("defaults installed app-backed Codex plugins into outbound capabilities", () => {
    const gmailPlugin = {
      id: "gmail@openai-curated-remote",
      provider: "codex",
      kind: "plugin",
      name: "gmail",
      displayName: "Gmail",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
      appIds: ["connector_2128aebfecb84f64a069897515042a44"],
      enabled: true,
      installed: true,
    } satisfies ProviderCapabilityEntry;

    const gmailSkill = {
      id: "gmail:gmail",
      provider: "codex",
      kind: "skill",
      name: "gmail:gmail",
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5/skills/gmail/SKILL.md",
      displayName: "Gmail",
      parentId: "gmail@openai-curated-remote",
      parentDisplayName: "Gmail",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
      appIds: ["connector_2128aebfecb84f64a069897515042a44"],
      enabled: true,
      installed: true,
    } satisfies ProviderCapabilityEntry;

    expect(
      defaultProviderCapabilitiesForProvider(
        [gmailPlugin, gmailSkill, providerCapability],
        "codex",
      ),
    ).toEqual([
      {
        provider: "codex",
        kind: "plugin",
        id: "gmail@openai-curated-remote",
        name: "gmail",
        displayName: "Gmail",
        capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
        appIds: ["connector_2128aebfecb84f64a069897515042a44"],
      },
    ]);
  });

  it("merges default plugin roots with explicit selected capabilities without duplicates", () => {
    const gmailRoot = {
      provider: "codex",
      kind: "plugin",
      id: "gmail@openai-curated-remote",
      name: "gmail",
      displayName: "Gmail",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
      appIds: ["connector_2128aebfecb84f64a069897515042a44"],
    } satisfies SelectedProviderCapability;
    const explicitGmailSkill = {
      provider: "codex",
      kind: "skill",
      id: "gmail:gmail",
      name: "gmail:gmail",
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5/skills/gmail/SKILL.md",
      displayName: "Gmail",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/gmail/0.1.5",
      appIds: ["connector_2128aebfecb84f64a069897515042a44"],
    } satisfies SelectedProviderCapability;
    const superpowersSkill = {
      provider: "codex",
      kind: "skill",
      id: "superpowers:using-superpowers",
      name: "superpowers:using-superpowers",
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
      displayName: "Using Superpowers",
    } satisfies SelectedProviderCapability;

    expect(
      mergeProviderCapabilitiesForSend([explicitGmailSkill, superpowersSkill], [gmailRoot]),
    ).toEqual([gmailRoot, explicitGmailSkill, superpowersSkill]);
  });

  it("activates provider capabilities only for the matching active provider profile", () => {
    const capability = {
      provider: "codex:zbd",
      kind: "skill",
      id: "superpowers:using-superpowers",
      name: "superpowers:using-superpowers",
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
      displayName: "Using Superpowers",
    } satisfies SelectedProviderCapability;

    expect(isActivatableProviderCapabilityForProvider(capability, "codex:zbd")).toBe(true);
    expect(isActivatableProviderCapabilityForProvider(capability, "codex:metric")).toBe(false);
    expect(isActivatableProviderCapabilityForProvider(capability, "cursor")).toBe(false);
  });

  it("preserves provider capability activation fields for draft selection", () => {
    const selected = toSelectedProviderCapability({
      id: "superpowers:using-superpowers",
      provider: "codex",
      kind: "skill",
      name: "superpowers:using-superpowers",
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
      displayName: "Using Superpowers",
      parentId: "superpowers@openai-curated-remote",
      parentDisplayName: "Superpowers",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1",
      appIds: ["asdk_app_superpowers"],
      iconUrl: "https://example.com/superpowers.png",
      enabled: true,
      installed: true,
    });

    expect(selected).toEqual({
      provider: "codex",
      kind: "skill",
      id: "superpowers:using-superpowers",
      name: "superpowers:using-superpowers",
      path: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
      displayName: "Using Superpowers",
      parentId: "superpowers@openai-curated-remote",
      parentDisplayName: "Superpowers",
      capabilityRootPath: "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1",
      appIds: ["asdk_app_superpowers"],
      iconUrl: "https://example.com/superpowers.png",
    });
  });

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
    expect(applyPromptReplacement).toHaveBeenCalledWith(0, 4, "", {
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
    expect(applyPromptReplacement).toHaveBeenCalledWith(0, 4, "", {
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
