import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderIcon } from "lucide-react";
import type {
  ListPromptDefinitionsResult,
  OrchestrationRunId,
  OrchestrationRunSummary,
  PromptDocumentState,
  PromptId,
  PromptManagementScopeKind,
  ProjectId,
} from "@t3tools/contracts";
import { ADMIN_PROMPT_GROUP_ID } from "@t3tools/contracts";

import { ensureNativeApi } from "../../nativeApi";
import { useStore } from "../../store";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer } from "./SettingsPanels";
import { DynamicChatUiPromptSection } from "./DynamicChatUiPromptSection";
import { PromptEditorDialog } from "./PromptEditorDialog";
import { PromptList } from "./PromptList";

function runLabel(
  run: OrchestrationRunSummary | undefined,
  projects?: readonly { id: string; name: string }[],
): string {
  if (!run) return "Run";
  const projectName = projects?.find((p) => p.id === run.projectId)?.name;
  const prefix = projectName ? `${projectName} — ` : "";
  return `${prefix}Run ${run.id.slice(0, 6)} (${run.status})`;
}

export function PromptsPanel() {
  const projects = useStore((s) => s.projects);

  // Orchestration scope state
  const [scopeKind, setScopeKind] = useState<PromptManagementScopeKind>("global");
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<OrchestrationRunId | null>(null);
  const [activeRuns, setActiveRuns] = useState<OrchestrationRunSummary[]>([]);

  // Shared definitions (both groups come from one listDefinitions call)
  const [definitions, setDefinitions] = useState<ListPromptDefinitionsResult | null>(null);

  // Separate document state maps: admin is always global, orchestration follows the scope dropdown
  const [adminDocStates, setAdminDocStates] = useState<Map<string, PromptDocumentState>>(new Map());
  const [orchDocStates, setOrchDocStates] = useState<Map<string, PromptDocumentState>>(new Map());

  const [loading, setLoading] = useState(true);
  const [editingPromptId, setEditingPromptId] = useState<PromptId | null>(null);
  const [editingIsAdmin, setEditingIsAdmin] = useState(false);

  const scopeValue =
    scopeKind === "orchestration-run" && selectedRunId
      ? `run:${selectedRunId}`
      : scopeKind === "project" && selectedProjectId
        ? selectedProjectId
        : "global";

  const orchScopeInput = useMemo(
    () =>
      scopeKind === "orchestration-run" && selectedRunId
        ? {
            scope: "orchestration-run" as const,
            orchestrationRunId: selectedRunId,
          }
        : scopeKind === "project" && selectedProjectId
          ? { scope: "project" as const, projectId: selectedProjectId }
          : { scope: "global" as const },
    [scopeKind, selectedProjectId, selectedRunId],
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
            ...(orchScopeInput.scope === "orchestration-run"
              ? { orchestrationRunId: orchScopeInput.orchestrationRunId }
              : orchScopeInput.scope === "project"
                ? { projectId: orchScopeInput.projectId }
                : {}),
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

  // Fetch resumable runs across all projects so they always appear in the dropdown
  useEffect(() => {
    const api = ensureNativeApi();
    const resumableStatuses = ["pending", "running", "paused", "failed"] as const;
    Promise.all(
      projects.map((p) =>
        api.orchestration.listRuns({ projectId: p.id as ProjectId, status: resumableStatuses }),
      ),
    )
      .then((results) => setActiveRuns(results.flat()))
      .catch(() => setActiveRuns([]));
  }, [projects]);

  const handleScopeChange = useCallback(
    (value: string | null) => {
      if (!value || value === "global") {
        setScopeKind("global");
        setSelectedProjectId(null);
        setSelectedRunId(null);
      } else if (value.startsWith("run:")) {
        const runId = value.slice(4) as OrchestrationRunId;
        // Find which project this run belongs to
        const run = activeRuns.find((r) => r.id === runId);
        setScopeKind("orchestration-run");
        if (run) setSelectedProjectId(run.projectId);
        setSelectedRunId(runId);
      } else {
        setScopeKind("project");
        setSelectedProjectId(value as ProjectId);
        setSelectedRunId(null);
      }
    },
    [activeRuns],
  );

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

  const handleEditAdmin = useCallback((promptId: PromptId) => {
    setEditingIsAdmin(true);
    setEditingPromptId(promptId);
  }, []);

  const handleEditOrch = useCallback((promptId: PromptId) => {
    setEditingIsAdmin(false);
    setEditingPromptId(promptId);
  }, []);

  return (
    <SettingsPageContainer>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Admin Prompts — always global, no scope dropdown */}
          <PromptList
            definitions={adminDefs}
            groups={adminGroups}
            documentStates={adminDocStates}
            onEditPrompt={handleEditAdmin}
          />

          <DynamicChatUiPromptSection />

          {/* Scope dropdown — only affects orchestration prompts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground">Scope</span>
              <Select value={scopeValue} onValueChange={handleScopeChange}>
                <SelectTrigger className="w-full sm:w-56" aria-label="Prompt scope">
                  <SelectValue>
                    {scopeKind === "orchestration-run"
                      ? (runLabel(
                          activeRuns.find((r) => r.id === selectedRunId),
                          projects,
                        ) ?? "Run")
                      : scopeKind === "global"
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
                  {activeRuns.length > 0 && (
                    <>
                      <div className="mx-2 my-1 border-t border-border" />
                      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Orchestrations
                      </div>
                      {activeRuns.map((run) => (
                        <SelectItem hideIndicator key={run.id} value={`run:${run.id}`}>
                          {runLabel(run, projects)}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectPopup>
              </Select>
            </div>
          </div>

          {/* Orchestration Prompts — affected by scope */}
          <PromptList
            definitions={orchDefs}
            groups={orchGroups}
            documentStates={orchDocStates}
            onEditPrompt={handleEditOrch}
          />
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
