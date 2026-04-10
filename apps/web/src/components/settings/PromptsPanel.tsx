import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderIcon, PencilIcon } from "lucide-react";
import type {
  ListPromptDefinitionsResult,
  OrchestrationPromptId,
  PromptDocumentScopeState,
  PromptDocumentState,
  PromptManagementScopeKind,
  ProjectId,
} from "@t3tools/contracts";

import { ensureNativeApi } from "../../nativeApi";
import { useStore } from "../../store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsSection } from "./SettingsPanels";
import { PromptEditorDialog } from "./PromptEditorDialog";

const SCOPE_STATE_BADGE: Record<
  PromptDocumentScopeState,
  { label: string; variant: "outline" | "info" | "warning" }
> = {
  default: { label: "Default", variant: "outline" },
  customized: { label: "Customized", variant: "info" },
  inherited: { label: "Inherited", variant: "outline" },
  overridden: { label: "Overridden", variant: "warning" },
};

export function PromptsPanel() {
  const projects = useStore((s) => s.projects);

  const [scopeKind, setScopeKind] = useState<PromptManagementScopeKind>("global");
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const [definitions, setDefinitions] = useState<ListPromptDefinitionsResult | null>(null);
  const [documentStates, setDocumentStates] = useState<Map<string, PromptDocumentState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editingPromptId, setEditingPromptId] = useState<OrchestrationPromptId | null>(null);

  const scopeValue = scopeKind === "project" && selectedProjectId ? selectedProjectId : "global";

  const scopeInput = useMemo(
    () =>
      scopeKind === "project" && selectedProjectId
        ? { scope: "project" as const, projectId: selectedProjectId }
        : { scope: "global" as const },
    [scopeKind, selectedProjectId],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const api = ensureNativeApi();
      const defs = await api.prompts.listDefinitions(scopeInput);
      setDefinitions(defs);

      const states = await Promise.all(
        defs.definitions.map((def) =>
          api.prompts.getDocument({
            scope: scopeInput.scope,
            ...(scopeInput.scope === "project" ? { projectId: scopeInput.projectId } : {}),
            promptId: def.promptId,
          }),
        ),
      );

      const stateMap = new Map<string, PromptDocumentState>();
      for (const state of states) {
        stateMap.set(state.definition.promptId, state);
      }
      setDocumentStates(stateMap);
    } finally {
      setLoading(false);
    }
  }, [scopeInput]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleScopeChange = useCallback((value: string | null) => {
    if (!value || value === "global") {
      setScopeKind("global");
      setSelectedProjectId(null);
    } else {
      setScopeKind("project");
      setSelectedProjectId(value as ProjectId);
    }
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditingPromptId(null);
  }, []);

  const handleEditorSaved = useCallback(() => {
    setEditingPromptId(null);
    void loadData();
  }, [loadData]);

  const editingDocState = editingPromptId ? (documentStates.get(editingPromptId) ?? null) : null;

  return (
    <SettingsPageContainer>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">Scope</span>
          <Select value={scopeValue} onValueChange={handleScopeChange}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Prompt scope">
              <SelectValue>
                {scopeKind === "global"
                  ? "Global"
                  : (projects.find((p) => p.id === selectedProjectId)?.name ?? "Project")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="global">
                Global
              </SelectItem>
              {projects.map((project) => (
                <SelectItem hideIndicator key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : definitions ? (
        definitions.groups.map((group) => (
          <SettingsSection key={group.groupId} title={group.label}>
            {definitions.definitions
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
                          onClick={() => setEditingPromptId(def.promptId)}
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
        ))
      ) : null}

      <PromptEditorDialog
        open={editingPromptId !== null}
        onClose={handleEditorClose}
        onSaved={handleEditorSaved}
        documentState={editingDocState}
        scopeInput={scopeInput}
      />
    </SettingsPageContainer>
  );
}
