import "../../index.css";

import { type SkillEntry } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

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

async function mountPicker(props?: { attachedSkillIds?: ReadonlySet<string> }) {
  const host = document.createElement("div");
  document.body.append(host);
  const onAttachSkill = vi.fn();
  const onRevealSkill = vi.fn();
  const screen = await render(
    <SkillsPicker
      skills={TEST_SKILLS}
      attachedSkillIds={props?.attachedSkillIds ?? new Set()}
      onAttachSkill={onAttachSkill}
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

describe("SkillsPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
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
    const mounted = await mountPicker({
      attachedSkillIds: new Set(["skill-top-level"]),
    });

    try {
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
    } finally {
      await mounted.cleanup();
    }
  });

  it("reveals a skill without attaching it", async () => {
    const mounted = await mountPicker();

    try {
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
    } finally {
      await mounted.cleanup();
    }
  });
});
