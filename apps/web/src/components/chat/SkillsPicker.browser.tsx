import "../../index.css";

import { type ProviderCapabilityEntry, type SkillEntry } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { resolveProviderCapabilities } = vi.hoisted(() => ({
  resolveProviderCapabilities: vi.fn().mockResolvedValue({ capabilities: [] }),
}));

vi.mock("~/nativeApi", () => ({
  readNativeApi: () => ({
    server: { resolveProviderCapabilities },
  }),
}));

import { useProviderCapabilities } from "~/hooks/useProviderCapabilities";

import { SkillsPicker } from "./SkillsPicker";

const TEST_SKILLS: readonly SkillEntry[] = [
  {
    id: "skill-top-level",
    name: "Top Level Skill",
    source: "project",
    absolutePath: "/repo/.claude/skills/top-level/SKILL.md",
    relativePath: ".claude/skills/top-level/SKILL.md",
    content: "# top level",
    group: null,
  },
  {
    id: "skill-zebra",
    name: "Zebra Skill",
    source: "project",
    absolutePath: "/repo/packages/zebra/.claude/skills/zebra/SKILL.md",
    relativePath: "packages/zebra/.claude/skills/zebra/SKILL.md",
    content: "# zebra",
    group: "zebra",
  },
  {
    id: "skill-alpha",
    name: "Alpha Skill",
    source: "project",
    absolutePath: "/repo/packages/alpha/.claude/skills/alpha/SKILL.md",
    relativePath: "packages/alpha/.claude/skills/alpha/SKILL.md",
    content: "# alpha",
    group: "alpha",
  },
];

const TEST_PROVIDER_CAPABILITIES: readonly ProviderCapabilityEntry[] = [
  {
    id: "superpowers@openai-curated-remote",
    provider: "codex",
    kind: "plugin",
    name: "superpowers",
    displayName: "Superpowers",
    description: "Planning workflows",
    enabled: true,
    installed: true,
  },
  {
    id: "superpowers:brainstorming",
    provider: "codex",
    kind: "skill",
    name: "superpowers:brainstorming",
    displayName: "Brainstorming",
    parentId: "superpowers@openai-curated-remote",
    parentDisplayName: "Superpowers",
    enabled: true,
    installed: true,
  },
];

async function mountPicker(props?: { attachedSkillIds?: ReadonlySet<string> }) {
  const host = document.createElement("div");
  document.body.append(host);
  const onAttachSkill = vi.fn();
  const onRevealSkill = vi.fn();
  const screen = await render(
    <SkillsPicker
      skills={TEST_SKILLS}
      attachedSkillIds={props?.attachedSkillIds ?? new Set()}
      providerCapabilities={[]}
      attachedProviderCapabilityIds={new Set()}
      onAttachSkill={onAttachSkill}
      onAttachProviderCapability={vi.fn()}
      onRevealSkill={onRevealSkill}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onAttachSkill,
    onRevealSkill,
  };
}

function ProviderCapabilitiesProbe() {
  useProviderCapabilities({ provider: "codex:profile", cwd: "/repo" });
  return null;
}

describe("SkillsPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    resolveProviderCapabilities.mockClear();
  });

  it("shows discovered skills with top-level items first and grouped package sections after", async () => {
    await using _ = await mountPicker();

    await page.getByLabelText("Skills").click();

    await vi.waitFor(() => {
      const menuItems = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
        "Top Level Skill",
        "Alpha Skill",
        "Zebra Skill",
      ]);

      const groupHeaders = Array.from(document.querySelectorAll("div"))
        .map((node) => node.textContent?.trim())
        .filter((text): text is string => text === "alpha" || text === "zebra");
      expect(groupHeaders).toEqual(["alpha", "zebra"]);
    });
  });

  it("attaches unattached skills and keeps attached rows disabled", async () => {
    await using mounted = await mountPicker({
      attachedSkillIds: new Set(["skill-top-level"]),
    });

    await page.getByLabelText("Skills").click();

    const attachedRow = await vi.waitFor(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (element) => element.textContent?.includes("Top Level Skill"),
      );
      expect(row).toBeTruthy();
      return row!;
    });
    expect(attachedRow.getAttribute("data-disabled")).toBe("");

    await page.getByRole("menuitem", { name: "Alpha Skill" }).click();

    expect(mounted.onAttachSkill).toHaveBeenCalledTimes(1);
    expect(mounted.onAttachSkill).toHaveBeenCalledWith(TEST_SKILLS[2]);
  });

  it("reveals a skill without attaching it", async () => {
    await using mounted = await mountPicker();

    await page.getByLabelText("Skills").click();

    const revealButton = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Reveal Alpha Skill in file explorer"]',
      );
      expect(button).toBeTruthy();
      return button!;
    });

    revealButton.click();

    expect(mounted.onRevealSkill).toHaveBeenCalledTimes(1);
    expect(mounted.onRevealSkill).toHaveBeenCalledWith(TEST_SKILLS[2]);
    expect(mounted.onAttachSkill).not.toHaveBeenCalled();
  });

  it("shows Codex provider capabilities and attaches a selected plugin", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onAttachProviderCapability = vi.fn();
    const screen = await render(
      <SkillsPicker
        skills={TEST_SKILLS}
        attachedSkillIds={new Set()}
        providerCapabilities={TEST_PROVIDER_CAPABILITIES}
        attachedProviderCapabilityIds={new Set()}
        onAttachSkill={vi.fn()}
        onAttachProviderCapability={onAttachProviderCapability}
        onRevealSkill={vi.fn()}
      />,
      { container: host },
    );

    await page.getByLabelText("Skills").click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Codex plugins");
      expect(document.body.textContent).toContain("Codex plugin skills");
    });

    await page.getByRole("menuitem", { name: "Superpowers" }).click();

    expect(onAttachProviderCapability).toHaveBeenCalledWith(TEST_PROVIDER_CAPABILITIES[0]);
    await expect
      .element(page.getByRole("menuitem", { name: "Superpowers" }))
      .not.toBeInTheDocument();

    await screen.unmount();
    host.remove();
  });

  it("preserves a profiled provider when resolving capabilities", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<ProviderCapabilitiesProbe />, { container: host });

    await vi.waitFor(() => {
      expect(resolveProviderCapabilities).toHaveBeenCalledWith({
        provider: "codex:profile",
        cwd: "/repo",
      });
    });

    await screen.unmount();
    host.remove();
  });
});
