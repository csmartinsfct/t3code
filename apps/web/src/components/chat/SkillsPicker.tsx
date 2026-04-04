import { memo, useCallback, useMemo, useState } from "react";
import { BookOpenIcon, PencilIcon } from "lucide-react";

import type { SkillEntry } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

interface SkillsPickerProps {
  skills: readonly SkillEntry[];
  attachedSkillIds: ReadonlySet<string>;
  compact?: boolean;
  onAttachSkill: (skill: SkillEntry) => void;
  onRevealSkill: (skill: SkillEntry) => void;
}

interface SkillGroup {
  label: string | null;
  skills: SkillEntry[];
}

/** Group skills: top-level first (`group: null`), then by sub-package name. */
function groupSkills(skills: readonly SkillEntry[]): SkillGroup[] {
  const groups = new Map<string | null, SkillEntry[]>();

  for (const skill of skills) {
    const key = skill.group ?? null;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(skill);
  }

  const result: SkillGroup[] = [];

  // Top-level first
  const topLevel = groups.get(null);
  if (topLevel && topLevel.length > 0) {
    result.push({ label: null, skills: topLevel });
  }

  // Then sub-packages, sorted alphabetically
  const subKeys = [...groups.keys()].filter((k): k is string => k !== null).sort();
  for (const key of subKeys) {
    const list = groups.get(key)!;
    result.push({ label: key, skills: list });
  }

  return result;
}

/**
 * Composer-footer picker that lists discovered skill files and lets users
 * attach them to the current message.  Returns `null` when no skills are
 * available so the button disappears entirely.
 *
 * Skills are grouped by sub-package for monorepo projects.
 */
export const SkillsPicker = memo(function SkillsPicker({
  skills,
  attachedSkillIds,
  compact,
  onAttachSkill,
  onRevealSkill,
}: SkillsPickerProps) {
  const groups = useMemo(() => groupSkills(skills), [skills]);
  const [open, setOpen] = useState(false);

  const closeMenu = useCallback(() => setOpen(false), []);

  if (skills.length === 0) return null;

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="Skills"
          />
        }
      >
        <BookOpenIcon aria-hidden="true" className="size-4" />
        {!compact ? <span className="sr-only sm:not-sr-only">Skills</span> : null}
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-[500px]">
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Skills</div>
        {groups.map((group, groupIdx) => (
          <div key={group.label ?? "__top__"}>
            {/* Separator between groups */}
            {groupIdx > 0 && (
              <div className="mx-2 my-1 border-t border-border/50" role="separator" />
            )}
            {/* Group header for sub-packages */}
            {group.label !== null && (
              <div className="px-2 pb-0.5 pt-1.5 font-medium text-muted-foreground text-xs">
                {group.label}
              </div>
            )}
            {group.skills.map((skill) => (
              <SkillMenuItem
                key={skill.id}
                skill={skill}
                isAttached={attachedSkillIds.has(skill.id)}
                onAttach={onAttachSkill}
                onReveal={onRevealSkill}
                onCloseMenu={closeMenu}
              />
            ))}
          </div>
        ))}
      </MenuPopup>
    </Menu>
  );
});

/** Individual skill row — extracted so the reveal handler is stable per item. */
const SkillMenuItem = memo(function SkillMenuItem({
  skill,
  isAttached,
  onAttach,
  onReveal,
  onCloseMenu,
}: {
  skill: SkillEntry;
  isAttached: boolean;
  onAttach: (skill: SkillEntry) => void;
  onReveal: (skill: SkillEntry) => void;
  onCloseMenu: () => void;
}) {
  const handleClick = useCallback(() => {
    if (!isAttached) onAttach(skill);
  }, [isAttached, onAttach, skill]);

  const handleReveal = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onCloseMenu();
      onReveal(skill);
    },
    [onCloseMenu, onReveal, skill],
  );

  return (
    <MenuItem
      className="group flex items-center justify-between gap-2"
      disabled={isAttached}
      onClick={handleClick}
    >
      <span className="min-w-0 truncate text-sm">{skill.name}</span>
      <button
        type="button"
        className="invisible shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground group-hover:visible"
        aria-label={`Reveal ${skill.name} in file explorer`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleReveal}
      >
        <PencilIcon className="size-3" />
      </button>
    </MenuItem>
  );
});
