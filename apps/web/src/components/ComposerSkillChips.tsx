/**
 * ComposerSkillChips — renders skill attachment chips above the composer input
 * when the user has attached skill files via the SkillsPicker.
 */
import { BookOpenIcon, XIcon } from "lucide-react";
import { memo } from "react";

import type { ComposerSkillAttachment } from "../composerDraftStore";

interface ComposerSkillChipsProps {
  skills: ComposerSkillAttachment[];
  onRemove: (skillId: string) => void;
}

export const ComposerSkillChips = memo(function ComposerSkillChips({
  skills,
  onRemove,
}: ComposerSkillChipsProps) {
  if (skills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-2">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center gap-1.5 rounded-md border border-border/70 bg-accent/30 px-2 py-1 text-xs transition-colors"
          title={`${skill.source}: ${skill.relativePath}`}
        >
          <BookOpenIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-foreground">{skill.name}</span>
          {skill.content === null && <span className="text-muted-foreground italic">loading…</span>}
          <button
            type="button"
            aria-label={`Remove ${skill.name} skill`}
            className="ml-0.5 flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/8 hover:text-foreground"
            onClick={() => onRemove(skill.id)}
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
});
