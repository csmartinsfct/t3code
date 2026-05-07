import { memo, useCallback, useMemo } from "react";
import { BookOpenIcon, PencilIcon } from "lucide-react";

import type { SkillEntry } from "@t3tools/contracts";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

const SKILLS_PICKER_OVERLAY_ROUTE_KEY = "skills-picker-menu";

type SkillsPickerResult =
  | { kind: "attach"; skill: SkillEntry }
  | { kind: "reveal"; skill: SkillEntry };

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
  const subKeys = [...groups.keys()].filter((k): k is string => k !== null).toSorted();
  for (const key of subKeys) {
    const list = groups.get(key)!;
    result.push({ label: key, skills: list });
  }

  return result;
}

function isSkillEntry(value: unknown): value is SkillEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SkillEntry>;
  return typeof candidate.id === "string" && typeof candidate.name === "string";
}

function readSkillEntriesParam(value: unknown): SkillEntry[] {
  return Array.isArray(value) ? value.filter(isSkillEntry) : [];
}

function readAttachedSkillIdsParam(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === "string"));
}

function isSkillsPickerResult(value: unknown): value is SkillsPickerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SkillsPickerResult>;
  return (
    (candidate.kind === "attach" || candidate.kind === "reveal") && isSkillEntry(candidate.skill)
  );
}

function SkillsMenuContent({
  attachedSkillIds,
  groups,
  onAttachSkill,
  onCloseMenu,
  onRevealSkill,
}: {
  attachedSkillIds: ReadonlySet<string>;
  groups: readonly SkillGroup[];
  onAttachSkill: (skill: SkillEntry) => void;
  onCloseMenu: () => void;
  onRevealSkill: (skill: SkillEntry) => void;
}) {
  return (
    <>
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Skills</div>
      {groups.map((group, groupIdx) => (
        <div key={group.label ?? "__top__"}>
          {groupIdx > 0 && <div className="mx-2 my-1 border-t border-border/50" role="separator" />}
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
              onCloseMenu={onCloseMenu}
            />
          ))}
        </div>
      ))}
    </>
  );
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

  const handleRouteResult = useCallback(
    (value: SkillsPickerResult) => {
      if (!isSkillsPickerResult(value)) return;
      if (value.kind === "attach") {
        onAttachSkill(value.skill);
        return;
      }
      onRevealSkill(value.skill);
    },
    [onAttachSkill, onRevealSkill],
  );
  const route = useRoutedPopoverSurface<HTMLButtonElement, SkillsPickerResult>({
    routeKey: SKILLS_PICKER_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: {
      attachedSkillIds: Array.from(attachedSkillIds),
      skills,
    },
    onResult: handleRouteResult,
  });
  const closeMenu = useCallback(() => route.onOpenChange(false), [route]);

  if (skills.length === 0) return null;

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80 not-hover:data-pressed:bg-transparent! not-hover:data-popup-open:bg-transparent!"
            aria-label="Skills"
          />
        }
        onFocusCapture={route.updateAnchor}
        onMouseOverCapture={route.updateAnchor}
        ref={route.triggerRef}
      >
        <BookOpenIcon aria-hidden="true" className="size-4" />
        {!compact ? <span className="sr-only sm:not-sr-only">Skills</span> : null}
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-[500px]">
        <SkillsMenuContent
          attachedSkillIds={attachedSkillIds}
          groups={groups}
          onAttachSkill={onAttachSkill}
          onCloseMenu={closeMenu}
          onRevealSkill={onRevealSkill}
        />
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

registerOverlayRoute<{
  attachedSkillIds?: unknown;
  skills?: unknown;
}>(SKILLS_PICKER_OVERLAY_ROUTE_KEY, function SkillsPickerOverlayRoute({ message, controller }) {
  const skills = readSkillEntriesParam(message.params.skills);
  const attachedSkillIds = readAttachedSkillIdsParam(message.params.attachedSkillIds);
  const groups = groupSkills(skills);

  return (
    <OverlayRouteMenu>
      <OverlayRouteMenuPopup align="start" className="max-h-[500px]">
        <SkillsMenuContent
          attachedSkillIds={attachedSkillIds}
          groups={groups}
          onAttachSkill={(skill) => controller.submit({ kind: "attach", skill })}
          onCloseMenu={() => undefined}
          onRevealSkill={(skill) => controller.submit({ kind: "reveal", skill })}
        />
      </OverlayRouteMenuPopup>
    </OverlayRouteMenu>
  );
});
