import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderIcon, PencilIcon } from "lucide-react";
import type {
  ListPromptDefinitionsResult,
  PromptDocumentScopeState,
  PromptDocumentState,
  PromptId,
  PromptManagementScopeKind,
  ProjectId,
} from "@t3tools/contracts";
import { ADMIN_PROMPT_GROUP_ID } from "@t3tools/contracts";

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

  // Orchestration scope state
  const [scopeKind, setScopeKind] = useState<PromptManagementScopeKind>("global");
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);

  // Shared definitions (both groups come from one listDefinitions call)
  const [definitions, setDefinitions] = useState<ListPromptDefinitionsResult | null>(null);

  // Separate document state maps: admin is always global, orchestration follows the scope dropdown
  const [adminDocStates, setAdminDocStates] = useState<Map<string, PromptDocumentState>>(new Map());
  const [orchDocStates, setOrchDocStates] = useState<Map<string, PromptDocumentState>>(new Map());

  const [loading, setLoading] = useState(true);
  const [editingPromptId, setEditingPromptId] = useState<PromptId | null>(null);
  const [editingIsAdmin, setEditingIsAdmin] = useState(false);

  const scopeValue = scopeKind === "project" && selectedProjectId ? selectedProjectId : "global";

  const orchScopeInput = useMemo(
    () =>
      scopeKind === "project" && selectedProjectId
        ? { scope: "project" as const, projectId: selectedProjectId }
        : { scope: "global" as const },
    [scopeKind, selectedProjectId],
  );

  const adminScopeInput = useMemo(() => ({ scope: "global" as const }), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const api = ensureNativeApi();
      // Fetch definitions (includes both groups)
      const defs = await api.prompts.listDefinitions(adminScopeInput);
      setDefinitions(defs);

      const adminDefs = defs.definitions.filter((d) => d.groupId === ADMIN_PROMPT_GROUP_ID);
      const orchDefs = defs.definitions.filter((d) => d.groupId !== ADMIN_PROMPT_GROUP_ID);

      // Fetch admin document states (always global)
      const adminStates = await Promise.all(
        adminDefs.map((def) =>
          api.prompts.getDocument({
            scope: "global",
            promptId: def.promptId,
          }),
        ),
      );

      // Fetch orchestration document states (user-selected scope)
      const orchStates = await Promise.all(
        orchDefs.map((def) =>
          api.prompts.getDocument({
            scope: orchScopeInput.scope,
            ...(orchScopeInput.scope === "project" ? { projectId: orchScopeInput.projectId } : {}),
            promptId: def.promptId,
          }),
        ),
      );

      const adminMap = new Map<string, PromptDocumentState>();
      for (const state of adminStates) adminMap.set(state.definition.promptId, state);
      setAdminDocStates(adminMap);

      const orchMap = new Map<string, PromptDocumentState>();
      for (const state of orchStates) orchMap.set(state.definition.promptId, state);
      setOrchDocStates(orchMap);
    } finally {
      setLoading(false);
    }
  }, [adminScopeInput, orchScopeInput]);

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
    setEditingIsAdmin(false);
  }, []);

  const handleEditorSaved = useCallback(() => {
    setEditingPromptId(null);
    setEditingIsAdmin(false);
    void loadData();
  }, [loadData]);

  const editingDocState = editingPromptId
    ? ((editingIsAdmin ? adminDocStates : orchDocStates).get(editingPromptId) ?? null)
    : null;

  const adminGroups = definitions?.groups.filter((g) => g.groupId === ADMIN_PROMPT_GROUP_ID) ?? [];
  const orchGroups = definitions?.groups.filter((g) => g.groupId !== ADMIN_PROMPT_GROUP_ID) ?? [];
  const adminDefs =
    definitions?.definitions.filter((d) => d.groupId === ADMIN_PROMPT_GROUP_ID) ?? [];
  const orchDefs =
    definitions?.definitions.filter((d) => d.groupId !== ADMIN_PROMPT_GROUP_ID) ?? [];

  return (
    <SettingsPageContainer>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Admin Prompts — always global, no scope dropdown */}
          {adminGroups.map((group) => (
            <SettingsSection key={group.groupId} title={group.label}>
              {adminDefs
                .filter((def) => def.groupId === group.groupId)
                .map((def) => {
                  const docState = adminDocStates.get(def.promptId);
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
                            onClick={() => {
                              setEditingIsAdmin(true);
                              setEditingPromptId(def.promptId);
                            }}
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

          {/* Scope dropdown — only affects orchestration prompts */}
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

          {/* Orchestration Prompts — affected by scope */}
          {orchGroups.map((group) => (
            <SettingsSection key={group.groupId} title={group.label}>
              {orchDefs
                .filter((def) => def.groupId === group.groupId)
                .map((def) => {
                  const docState = orchDocStates.get(def.promptId);
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
                            onClick={() => {
                              setEditingIsAdmin(false);
                              setEditingPromptId(def.promptId);
                            }}
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
      )}

      <PromptEditorDialog
        open={editingPromptId !== null}
        onClose={handleEditorClose}
        onSaved={handleEditorSaved}
        documentState={editingDocState}
        scopeInput={editingIsAdmin ? adminScopeInput : orchScopeInput}
      />
    </SettingsPageContainer>
  );
}
