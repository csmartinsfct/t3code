import { PencilIcon } from "lucide-react";
import type {
  PromptDefinition,
  PromptDocumentScopeState,
  PromptDocumentState,
  PromptGroupDefinition,
  PromptId,
} from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SettingsSection } from "./SettingsPanels";

// ---------------------------------------------------------------------------
// Scope-state badge configuration
// ---------------------------------------------------------------------------

export const SCOPE_STATE_BADGE: Record<
  PromptDocumentScopeState,
  { label: string; variant: "outline" | "info" | "warning" }
> = {
  default: { label: "Default", variant: "outline" },
  customized: { label: "Customized", variant: "info" },
  inherited: { label: "Inherited", variant: "outline" },
  overridden: { label: "Overridden", variant: "warning" },
};

// ---------------------------------------------------------------------------
// PromptList
// ---------------------------------------------------------------------------

interface PromptListProps {
  definitions: readonly PromptDefinition[];
  groups: readonly PromptGroupDefinition[];
  documentStates: ReadonlyMap<string, PromptDocumentState>;
  onEditPrompt: (promptId: PromptId) => void;
}

export function PromptList({ definitions, groups, documentStates, onEditPrompt }: PromptListProps) {
  return (
    <>
      {groups.map((group) => (
        <SettingsSection key={group.groupId} title={group.label}>
          {definitions
            .filter((def) => def.groupId === group.groupId)
            .map((def) => {
              const docState = documentStates.get(def.promptId);
              const badgeConfig = docState
                ? SCOPE_STATE_BADGE[docState.scopeState]
                : SCOPE_STATE_BADGE.default;

              return (
                <div
                  key={def.promptId}
                  className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-h-5 items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{def.label}</h3>
                        <Badge variant={badgeConfig.variant} size="sm">
                          {badgeConfig.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                    </div>
                    <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onEditPrompt(def.promptId)}
                      >
                        <PencilIcon className="size-3" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
        </SettingsSection>
      ))}
    </>
  );
}
