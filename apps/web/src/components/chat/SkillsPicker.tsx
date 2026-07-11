import { memo, useCallback, useMemo } from "react";
import { BookOpenIcon, PencilIcon } from "lucide-react";

import type { ProviderCapabilityEntry, SkillEntry } from "@t3tools/contracts";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

const SKILLS_PICKER_OVERLAY_ROUTE_KEY = "skills-picker-menu";

type SkillsPickerResult =
  | { kind: "attach"; skill: SkillEntry }
  | { kind: "reveal"; skill: SkillEntry }
  | { kind: "attach-provider-capability"; capability: ProviderCapabilityEntry };

interface SkillsPickerProps {
  skills: readonly SkillEntry[];
  attachedSkillIds: ReadonlySet<string>;
  providerCapabilities: readonly ProviderCapabilityEntry[];
  attachedProviderCapabilityIds: ReadonlySet<string>;
  compact?: boolean;
  onAttachSkill: (skill: SkillEntry) => void;
  onAttachProviderCapability: (capability: ProviderCapabilityEntry) => void;
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

function isProviderCapabilityEntry(value: unknown): value is ProviderCapabilityEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProviderCapabilityEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.enabled === "boolean"
  );
}

function readProviderCapabilityEntriesParam(value: unknown): ProviderCapabilityEntry[] {
  return Array.isArray(value) ? value.filter(isProviderCapabilityEntry) : [];
}

function isSkillsPickerResult(value: unknown): value is SkillsPickerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SkillsPickerResult>;
  return (
    ((candidate.kind === "attach" || candidate.kind === "reveal") &&
      isSkillEntry(candidate.skill)) ||
    (candidate.kind === "attach-provider-capability" &&
      isProviderCapabilityEntry(candidate.capability))
  );
}

function SkillsMenuContent({
  attachedSkillIds,
  attachedProviderCapabilityIds,
  groups,
  plugins,
  pluginSkills,
  onAttachSkill,
  onAttachProviderCapability,
  onCloseMenu,
  onRevealSkill,
}: {
  attachedSkillIds: ReadonlySet<string>;
  attachedProviderCapabilityIds: ReadonlySet<string>;
  groups: readonly SkillGroup[];
  plugins: readonly ProviderCapabilityEntry[];
  pluginSkills: readonly ProviderCapabilityEntry[];
  onAttachSkill: (skill: SkillEntry) => void;
  onAttachProviderCapability: (capability: ProviderCapabilityEntry) => void;
  onCloseMenu: () => void;
  onRevealSkill: (skill: SkillEntry) => void;
}) {
  return (
    <>
      {groups.length > 0 && (
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Skills</div>
      )}
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
      {plugins.length > 0 && (
        <ProviderCapabilitySection
          label="Codex plugins"
          capabilities={plugins}
          attachedProviderCapabilityIds={attachedProviderCapabilityIds}
          onAttachProviderCapability={onAttachProviderCapability}
          showSeparator={groups.length > 0}
        />
      )}
      {pluginSkills.length > 0 && (
        <ProviderCapabilitySection
          label="Codex plugin skills"
          capabilities={pluginSkills}
          attachedProviderCapabilityIds={attachedProviderCapabilityIds}
          onAttachProviderCapability={onAttachProviderCapability}
          showSeparator
        />
      )}
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
  providerCapabilities,
  attachedProviderCapabilityIds,
  compact,
  onAttachSkill,
  onAttachProviderCapability,
  onRevealSkill,
}: SkillsPickerProps) {
  const groups = useMemo(() => groupSkills(skills), [skills]);
  const plugins = useMemo(
    () => providerCapabilities.filter((capability) => capability.kind === "plugin"),
    [providerCapabilities],
  );
  const pluginSkills = useMemo(
    () => providerCapabilities.filter((capability) => capability.kind === "skill"),
    [providerCapabilities],
  );

  const handleRouteResult = useCallback(
    (value: SkillsPickerResult) => {
      if (!isSkillsPickerResult(value)) return;
      if (value.kind === "attach") {
        onAttachSkill(value.skill);
        return;
      }
      if (value.kind === "attach-provider-capability") {
        onAttachProviderCapability(value.capability);
        return;
      }
      onRevealSkill(value.skill);
    },
    [onAttachProviderCapability, onAttachSkill, onRevealSkill],
  );
  const route = useRoutedPopoverSurface<HTMLButtonElement, SkillsPickerResult>({
    routeKey: SKILLS_PICKER_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: {
      attachedSkillIds: Array.from(attachedSkillIds),
      attachedProviderCapabilityIds: Array.from(attachedProviderCapabilityIds),
      providerCapabilities,
      skills,
    },
    onResult: handleRouteResult,
  });
  const closeMenu = useCallback(() => route.onOpenChange(false), [route]);

  if (skills.length === 0 && plugins.length === 0 && pluginSkills.length === 0) return null;

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
          attachedProviderCapabilityIds={attachedProviderCapabilityIds}
          groups={groups}
          plugins={plugins}
          pluginSkills={pluginSkills}
          onAttachSkill={onAttachSkill}
          onAttachProviderCapability={onAttachProviderCapability}
          onCloseMenu={closeMenu}
          onRevealSkill={onRevealSkill}
        />
      </MenuPopup>
    </Menu>
  );
});

const ProviderCapabilitySection = memo(function ProviderCapabilitySection({
  label,
  capabilities,
  attachedProviderCapabilityIds,
  onAttachProviderCapability,
  showSeparator,
}: {
  label: string;
  capabilities: readonly ProviderCapabilityEntry[];
  attachedProviderCapabilityIds: ReadonlySet<string>;
  onAttachProviderCapability: (capability: ProviderCapabilityEntry) => void;
  showSeparator: boolean;
}) {
  return (
    <div>
      {showSeparator && <div className="mx-2 my-1 border-t border-border/50" role="separator" />}
      <div className="px-2 pb-0.5 pt-1.5 font-medium text-muted-foreground text-xs">{label}</div>
      {capabilities.map((capability) => (
        <ProviderCapabilityMenuItem
          key={capability.id}
          capability={capability}
          isAttached={attachedProviderCapabilityIds.has(capability.id)}
          onAttach={onAttachProviderCapability}
        />
      ))}
    </div>
  );
});

const ProviderCapabilityMenuItem = memo(function ProviderCapabilityMenuItem({
  capability,
  isAttached,
  onAttach,
}: {
  capability: ProviderCapabilityEntry;
  isAttached: boolean;
  onAttach: (capability: ProviderCapabilityEntry) => void;
}) {
  const handleClick = useCallback(() => {
    if (!isAttached) onAttach(capability);
  }, [capability, isAttached, onAttach]);

  return (
    <MenuItem disabled={isAttached} onClick={handleClick}>
      <span className="min-w-0 truncate text-sm">{capability.displayName}</span>
    </MenuItem>
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
  attachedProviderCapabilityIds?: unknown;
  providerCapabilities?: unknown;
  skills?: unknown;
}>(SKILLS_PICKER_OVERLAY_ROUTE_KEY, function SkillsPickerOverlayRoute({ message, controller }) {
  const skills = readSkillEntriesParam(message.params.skills);
  const attachedSkillIds = readAttachedSkillIdsParam(message.params.attachedSkillIds);
  const providerCapabilities = readProviderCapabilityEntriesParam(
    message.params.providerCapabilities,
  );
  const attachedProviderCapabilityIds = readAttachedSkillIdsParam(
    message.params.attachedProviderCapabilityIds,
  );
  const groups = groupSkills(skills);
  const plugins = providerCapabilities.filter((capability) => capability.kind === "plugin");
  const pluginSkills = providerCapabilities.filter((capability) => capability.kind === "skill");

  return (
    <OverlayRouteMenu>
      <OverlayRouteMenuPopup align="start" className="max-h-[500px]">
        <SkillsMenuContent
          attachedSkillIds={attachedSkillIds}
          attachedProviderCapabilityIds={attachedProviderCapabilityIds}
          groups={groups}
          plugins={plugins}
          pluginSkills={pluginSkills}
          onAttachSkill={(skill) => controller.submit({ kind: "attach", skill })}
          onAttachProviderCapability={(capability) =>
            controller.submit({ kind: "attach-provider-capability", capability })
          }
          onCloseMenu={() => undefined}
          onRevealSkill={(skill) => controller.submit({ kind: "reveal", skill })}
        />
      </OverlayRouteMenuPopup>
    </OverlayRouteMenu>
  );
});
