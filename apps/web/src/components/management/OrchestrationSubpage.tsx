import type {
  ListPromptDefinitionsResult,
  ModelSelection,
  OrchestrationPromptOverrides,
  PromptDocumentState,
  PromptDocumentV1,
  PromptId,
  TicketId,
  TicketSummary,
  TicketTreeNode,
} from "@t3tools/contracts";
import { ADMIN_PROMPT_GROUP_ID, DEFAULT_RUNTIME_MODE, type ProjectId } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  CircleAlertIcon,
  LinkIcon,
  LoaderIcon,
  PlayIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettings } from "../../hooks/useSettings";
import { buildOrchestrationPlan, type OrchestrationPlan } from "../../lib/orchestrationValidation";
import { ensureNativeApi } from "../../nativeApi";
import {
  formatModelSelectionSummary,
  resolveReviewerConfigurationSummary,
} from "./orchestrationModelDisplay";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { PromptEditorDialog } from "../settings/PromptEditorDialog";
import { PromptList } from "../settings/PromptList";
import { SettingsSection } from "../settings/SettingsPanels";
import { STATUS_CONFIG } from "../settings/ticketUtils";
import {
  getRunnableTicketIdentifiers,
  isOrchestrationSubmitDisabled,
  submitOrchestrationConfirm,
} from "./OrchestrateConfirmDialog";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationSubpageProps {
  selectedTickets: ReadonlyMap<TicketId, TicketSummary>;
  allTickets: readonly TicketSummary[];
  projectId: string;
  onConfirm: (
    selectedTicketIdentifiers: string[],
    implementerModelSelection: ModelSelection,
    reviewerModelSelection: ModelSelection,
    promptOverrides?: OrchestrationPromptOverrides,
  ) => Promise<void> | void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrchestrationSubpage({
  selectedTickets,
  allTickets,
  projectId,
  onConfirm,
  onBack,
}: OrchestrationSubpageProps) {
  // ── Plan state ──────────────────────────────────────────────────────
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (selectedTickets.size === 0) {
      setPlan(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setPlanLoading(true);
    setError(null);

    const api = ensureNativeApi();
    api.ticketing
      .getTree({ projectId: projectId as ProjectId })
      .then((tree: readonly TicketTreeNode[]) => {
        if (cancelled) return;
        const selectedIds = new Set(selectedTickets.keys());
        const result = buildOrchestrationPlan(selectedIds, tree, allTickets);
        setPlan(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load ticket data");
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTickets, allTickets, projectId]);

  // ── Settings ────────────────────────────────────────────────────────
  const settings = useSettings();
  const implSel = settings.orchestrationImplementerModelSelection;
  const revSel = settings.orchestrationReviewerModelSelection;
  const implDisplayName = formatModelSelectionSummary(implSel);
  const revDisplayName = resolveReviewerConfigurationSummary(settings.maxReviewIterations, revSel);

  // ── Prompts state ───────────────────────────────────────────────────
  const [promptDefs, setPromptDefs] = useState<ListPromptDefinitionsResult | null>(null);
  const [promptDocStates, setPromptDocStates] = useState<Map<string, PromptDocumentState>>(
    new Map(),
  );
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [editingPromptId, setEditingPromptId] = useState<PromptId | null>(null);

  // Local overrides — never saved to the server, passed to createRun on submit
  const [localOverrides, setLocalOverrides] = useState<Partial<Record<PromptId, PromptDocumentV1>>>(
    {},
  );

  const loadPrompts = useCallback(async () => {
    setPromptsLoading(true);
    try {
      const api = ensureNativeApi();
      const defs = await api.prompts.listDefinitions({ scope: "global" });
      setPromptDefs(defs);

      const orchDefs = defs.definitions.filter((d) => d.groupId !== ADMIN_PROMPT_GROUP_ID);
      const orchStates = await Promise.all(
        orchDefs.map((def) =>
          api.prompts.getDocument({
            scope: "project",
            projectId: projectId as ProjectId,
            promptId: def.promptId,
          }),
        ),
      );

      const map = new Map<string, PromptDocumentState>();
      for (const state of orchStates) map.set(state.definition.promptId, state);
      setPromptDocStates(map);
    } finally {
      setPromptsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const orchGroups = useMemo(
    () => promptDefs?.groups.filter((g) => g.groupId !== ADMIN_PROMPT_GROUP_ID) ?? [],
    [promptDefs],
  );
  const orchDefs = useMemo(
    () => promptDefs?.definitions.filter((d) => d.groupId !== ADMIN_PROMPT_GROUP_ID) ?? [],
    [promptDefs],
  );

  // Merge local overrides into document states for display
  const displayDocStates = useMemo(() => {
    const merged = new Map(promptDocStates);
    for (const [promptId, doc] of Object.entries(localOverrides)) {
      if (!doc) continue;
      const base = merged.get(promptId);
      if (base) {
        merged.set(promptId, {
          ...base,
          effectiveDocument: doc,
          effectiveSource: "run_override",
          scopeState: "overridden",
          runOverrideDocument: doc,
        });
      }
    }
    return merged;
  }, [promptDocStates, localOverrides]);

  const handleEditPrompt = useCallback((promptId: PromptId) => {
    setEditingPromptId(promptId);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditingPromptId(null);
  }, []);

  const handleLocalSave = useCallback((promptId: PromptId, document: PromptDocumentV1) => {
    setLocalOverrides((prev) => ({ ...prev, [promptId]: document }));
  }, []);

  const handleEditorSaved = useCallback(() => {
    setEditingPromptId(null);
  }, []);

  // For the editor, show the local override if it exists, otherwise the fetched state
  const editingDocState = useMemo(() => {
    if (!editingPromptId) return null;
    return displayDocStates.get(editingPromptId) ?? null;
  }, [editingPromptId, displayDocStates]);

  // Build the prompt scope for the editor — not used for saving (onLocalSave handles that)
  const editorScopeInput = useMemo(
    () => ({ scope: "project" as const, projectId: projectId as ProjectId }),
    [projectId],
  );

  // ── Submit ──────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (isOrchestrationSubmitDisabled({ plan, isSubmitting })) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const overrides =
      Object.keys(localOverrides).length > 0
        ? (localOverrides as OrchestrationPromptOverrides)
        : null;
    const result = await submitOrchestrationConfirm({
      plan,
      selectedTicketIdentifiers: [...selectedTickets.values()].map((ticket) => ticket.identifier),
      implementerModelSelection: implSel,
      reviewerModelSelection: revSel,
      ...(overrides ? { promptOverrides: overrides } : {}),
      onConfirm,
    });
    if (result.kind === "started") {
      onBack();
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
    }
    setIsSubmitting(false);
  }, [isSubmitting, plan, implSel, revSel, localOverrides, onConfirm, onBack, selectedTickets]);

  const runnableCount = getRunnableTicketIdentifiers(plan).length;
  const submitDisabled = isOrchestrationSubmitDisabled({ plan, isSubmitting });

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
        {/* Page title */}
        <div>
          <h1 className="text-sm font-semibold text-foreground">
            Orchestrate {runnableCount > 0 ? runnableCount : ""} ticket
            {runnableCount !== 1 ? "s" : ""}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Tickets will be processed sequentially in the order below.
          </p>
        </div>

        {/* Section 1: Ticket execution order */}
        <SettingsSection title="Execution order">
          <div className="px-4 py-3 sm:px-5">
            {planLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: Math.min(selectedTickets.size, 5) }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : error && !plan ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" />
                {error}
              </div>
            ) : plan?.kind === "blocked-external" ? (
              <BlockedExternalInline externalDeps={plan.externalDeps} />
            ) : plan?.kind === "blocked-cycle" ? (
              <BlockedCycleInline cycles={plan.cycles} />
            ) : plan?.kind === "valid" ? (
              <div className="flex flex-col gap-1">
                {plan.orderedTickets.map((entry, index) => (
                  <TicketRow key={entry.ticket.id} entry={entry} index={index} />
                ))}
              </div>
            ) : null}
          </div>
        </SettingsSection>

        {/* Section 2: Run configuration */}
        <SettingsSection title="Run configuration">
          <div className="flex flex-col gap-1 px-4 py-3 text-xs text-foreground/80 sm:px-5">
            <ConfigRow label="Implementer" value={implDisplayName} />
            <ConfigRow label="Reviewer" value={revDisplayName} />
            <ConfigRow
              label="Runtime"
              value={DEFAULT_RUNTIME_MODE === "full-access" ? "Full access" : "Approval required"}
            />
          </div>
        </SettingsSection>

        {/* Section 3: Orchestration prompts */}
        {promptsLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <PromptList
            definitions={orchDefs}
            groups={orchGroups}
            documentStates={displayDocStates}
            onEditPrompt={handleEditPrompt}
          />
        )}

        {/* Error banner */}
        {error && plan ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {/* Submit area */}
        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={submitDisabled}>
            <PlayIcon className="size-3.5" />
            {isSubmitting ? "Starting..." : "Start Orchestration"}
          </Button>
        </div>
      </div>

      <PromptEditorDialog
        open={editingPromptId !== null}
        onClose={handleEditorClose}
        onSaved={handleEditorSaved}
        documentState={editingDocState}
        scopeInput={editorScopeInput}
        onLocalSave={handleLocalSave}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TicketRow({
  entry,
  index,
}: {
  entry: { ticket: TicketSummary; annotation: string };
  index: number;
}) {
  const isSkipped = entry.annotation === "skipped-done";
  const isWarn = entry.annotation === "warn-reprocess";
  const statusCfg = STATUS_CONFIG[entry.ticket.status];

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isSkipped ? "opacity-50" : ""}`}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">{entry.ticket.identifier}</span>
      <span className={`min-w-0 flex-1 truncate text-xs ${isSkipped ? "line-through" : ""}`}>
        {entry.ticket.title}
      </span>
      {isSkipped && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <SkipForwardIcon className="size-3" />
          Skipped
        </span>
      )}
      {isWarn && (
        <Badge size="sm" variant={statusCfg.badgeVariant} className="shrink-0">
          <AlertTriangleIcon className="size-2.5" />
          Re-processing
        </Badge>
      )}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}

function BlockedExternalInline({
  externalDeps,
}: {
  externalDeps: Array<{
    ticket: TicketSummary;
    dependsOn: { identifier: string; title: string; status: string };
  }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500" />
        <span className="text-muted-foreground">
          Some selected tickets depend on unfinished tickets not included in this orchestration.
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {externalDeps.map((dep, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-xs"
          >
            <span className="font-mono text-muted-foreground">{dep.ticket.identifier}</span>
            <LinkIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="font-mono text-amber-600 dark:text-amber-400">
              {dep.dependsOn.identifier}
            </span>
            <Badge size="sm" variant="outline" className="ml-auto shrink-0">
              {dep.dependsOn.status.replace("_", " ")}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockedCycleInline({ cycles }: { cycles: TicketSummary[][] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" />
        <span className="text-muted-foreground">
          Circular dependencies prevent determining an execution order.
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {cycles.map((cycle, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2"
          >
            {cycle.map((ticket, j) => (
              <span key={ticket.id} className="flex items-center gap-1">
                {j > 0 && <span className="text-muted-foreground">&rarr;</span>}
                <span className="font-mono text-xs">{ticket.identifier}</span>
              </span>
            ))}
            <span className="text-muted-foreground">&rarr;</span>
            <span className="font-mono text-xs">{cycle[0]?.identifier}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
