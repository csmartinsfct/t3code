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
import {
  ADMIN_PROMPT_GROUP_ID,
  DEFAULT_RUNTIME_MODE,
  modelSelectionProviderKind,
  type ProjectId,
} from "@t3tools/contracts";
import { DEFAULT_MAX_REVIEW_ITERATIONS } from "@t3tools/contracts/settings";
import { Equal } from "effect";
import {
  AlertTriangleIcon,
  CircleAlertIcon,
  LinkIcon,
  LoaderIcon,
  PlayIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { useSettings } from "../../hooks/useSettings";
import { buildOrchestrationPlan, type OrchestrationPlan } from "../../lib/orchestrationValidation";
import { getCustomModelOptionsByProvider, makeAppModelSelection } from "../../modelSelection";
import { ensureNativeApi } from "../../nativeApi";
import { useServerProviders } from "../../rpc/serverState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { PromptEditorDialog } from "../settings/PromptEditorDialog";
import { PromptList } from "../settings/PromptList";
import { SettingsSection } from "../settings/SettingsPanels";
import { STATUS_CONFIG } from "../settings/ticketUtils";
import {
  getRunnableTicketIdentifiers,
  isOrchestrationSubmitDisabled,
  submitOrchestrationConfirm,
  type OrchestrationConfirmOnConfirm,
} from "./OrchestrateConfirmDialog";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationSubpageProps {
  selectedTickets: ReadonlyMap<TicketId, TicketSummary>;
  allTickets: readonly TicketSummary[];
  projectId: string;
  onConfirm: OrchestrationConfirmOnConfirm;
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

  // Per-run inclusion set: user can uncheck tickets on this page to drop them
  // from the run. Seeded with every originally-selected ticket (all on by default).
  const [includedIds, setIncludedIds] = useState<Set<TicketId>>(
    () => new Set(selectedTickets.keys()),
  );

  // If the caller replaces the selection, reset the inclusion set.
  useEffect(() => {
    setIncludedIds(new Set(selectedTickets.keys()));
  }, [selectedTickets]);

  useEffect(() => {
    if (includedIds.size === 0) {
      setPlan(null);
      setError(null);
      setPlanLoading(false);
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
        const result = buildOrchestrationPlan(includedIds, tree, allTickets);
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
  }, [includedIds, allTickets, projectId]);

  const toggleIncluded = useCallback((id: TicketId, checked: boolean) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // ── Settings + per-run model/review state ───────────────────────────
  const settings = useSettings();
  const serverProviders = useServerProviders();
  const settingsImplSel = settings.orchestrationImplementerModelSelection;
  const settingsRevSel = settings.orchestrationReviewerModelSelection;
  const settingsMaxReview = settings.maxReviewIterations;

  const [implementerSelection, setImplementerSelection] = useState<ModelSelection>(settingsImplSel);
  const [reviewerSelection, setReviewerSelection] = useState<ModelSelection>(settingsRevSel);
  const [skipReview, setSkipReview] = useState<boolean>(settingsMaxReview === 0);

  const implementerIsOverride = !Equal.equals(implementerSelection, settingsImplSel);
  const reviewerIsOverride = !Equal.equals(reviewerSelection, settingsRevSel);

  const resetImplementer = useCallback(() => {
    setImplementerSelection(settingsImplSel);
  }, [settingsImplSel]);
  const resetReviewer = useCallback(() => {
    setReviewerSelection(settingsRevSel);
  }, [settingsRevSel]);

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

  // ── Display ordering ────────────────────────────────────────────────
  // Always render every originally-selected ticket so checkboxes are stable,
  // even when the plan becomes blocked after an unchecking.
  const displayEntries = useMemo(() => {
    const bySelectedOrder = Array.from(selectedTickets.values());
    const planOrder = plan?.kind === "valid" ? plan.orderedTickets : null;
    if (!planOrder) {
      return bySelectedOrder.map((ticket) => ({
        ticket,
        planIndex: null as number | null,
        annotation: null as string | null,
      }));
    }
    const seen = new Set<TicketId>();
    const ordered: Array<{
      ticket: TicketSummary;
      planIndex: number | null;
      annotation: string | null;
    }> = [];
    planOrder.forEach((entry, i) => {
      seen.add(entry.ticket.id);
      ordered.push({
        ticket: entry.ticket,
        planIndex: entry.annotation === "skipped-done" ? null : i,
        annotation: entry.annotation,
      });
    });
    for (const ticket of bySelectedOrder) {
      if (seen.has(ticket.id)) continue;
      ordered.push({ ticket, planIndex: null, annotation: null });
    }
    return ordered;
  }, [plan, selectedTickets]);

  // ── Submit ──────────────────────────────────────────────────────────
  const resolvedMaxReviewIterations = useMemo<number | undefined>(() => {
    if (skipReview) return 0;
    if (settingsMaxReview === 0) return DEFAULT_MAX_REVIEW_ITERATIONS;
    return undefined;
  }, [skipReview, settingsMaxReview]);

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
      selectedTicketIdentifiers: getRunnableTicketIdentifiers(plan),
      implementerModelSelection: implementerSelection,
      reviewerModelSelection: reviewerSelection,
      ...(overrides ? { promptOverrides: overrides } : {}),
      ...(resolvedMaxReviewIterations !== undefined
        ? { maxReviewIterations: resolvedMaxReviewIterations }
        : {}),
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
  }, [
    isSubmitting,
    plan,
    implementerSelection,
    reviewerSelection,
    resolvedMaxReviewIterations,
    localOverrides,
    onConfirm,
    onBack,
  ]);

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
            {planLoading && displayEntries.length === 0 ? (
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
            ) : (
              <div className="flex flex-col gap-3">
                {plan?.kind === "blocked-external" ? (
                  <BlockedExternalInline externalDeps={plan.externalDeps} />
                ) : plan?.kind === "blocked-cycle" ? (
                  <BlockedCycleInline cycles={plan.cycles} />
                ) : null}
                {includedIds.size === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleAlertIcon className="size-3.5 shrink-0" />
                    Select at least one ticket to run.
                  </div>
                ) : null}
                <div className="flex flex-col gap-1">
                  {displayEntries.map((entry) => (
                    <TicketRow
                      key={entry.ticket.id}
                      ticket={entry.ticket}
                      planIndex={entry.planIndex}
                      annotation={entry.annotation}
                      included={includedIds.has(entry.ticket.id)}
                      onToggle={(checked) => toggleIncluded(entry.ticket.id, checked)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* Section 2: Run configuration */}
        <SettingsSection title="Run configuration">
          <div className="flex flex-col divide-y divide-border/50">
            <RunModelRow
              label="Implementer"
              selection={implementerSelection}
              onChange={setImplementerSelection}
              hasOverride={implementerIsOverride}
              onReset={resetImplementer}
              serverProviders={serverProviders}
              settings={settings}
              disabled={false}
            />
            <RunModelRow
              label="Reviewer"
              selection={reviewerSelection}
              onChange={setReviewerSelection}
              hasOverride={reviewerIsOverride}
              onReset={resetReviewer}
              serverProviders={serverProviders}
              settings={settings}
              disabled={skipReview}
              trailingControl={
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{skipReview ? "Skip review" : "Review"}</span>
                  <Switch
                    checked={!skipReview}
                    onCheckedChange={(checked) => setSkipReview(!checked)}
                    aria-label={
                      skipReview ? "Enable review for this run" : "Skip review for this run"
                    }
                  />
                </label>
              }
            />
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-foreground/80 sm:px-5">
              <span className="text-muted-foreground">Runtime</span>
              <span className="font-mono text-[11px]">
                {DEFAULT_RUNTIME_MODE === "full-access" ? "Full access" : "Approval required"}
              </span>
            </div>
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
  ticket,
  planIndex,
  annotation,
  included,
  onToggle,
}: {
  ticket: TicketSummary;
  planIndex: number | null;
  annotation: string | null;
  included: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const isSkipped = annotation === "skipped-done";
  const isWarn = annotation === "warn-reprocess";
  const statusCfg = STATUS_CONFIG[ticket.status];
  const dim = !included || isSkipped;

  return (
    <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${dim ? "opacity-50" : ""}`}>
      <Checkbox
        checked={included}
        onCheckedChange={(checked) => onToggle(Boolean(checked))}
        aria-label={`Include ${ticket.identifier} in run`}
      />
      {included && planIndex !== null ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
          {planIndex + 1}
        </span>
      ) : (
        <span className="size-5 shrink-0" aria-hidden />
      )}
      <span className="font-mono text-[10px] text-muted-foreground">{ticket.identifier}</span>
      <span
        className={`min-w-0 flex-1 truncate text-xs ${!included || isSkipped ? "line-through" : ""}`}
      >
        {ticket.title}
      </span>
      {included && isSkipped && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <SkipForwardIcon className="size-3" />
          Skipped
        </span>
      )}
      {included && isWarn && (
        <Badge size="sm" variant={statusCfg.badgeVariant} className="shrink-0">
          <AlertTriangleIcon className="size-2.5" />
          Re-processing
        </Badge>
      )}
    </div>
  );
}

function RunModelRow({
  label,
  selection,
  onChange,
  hasOverride,
  onReset,
  serverProviders,
  settings,
  disabled,
  trailingControl,
}: {
  label: string;
  selection: ModelSelection;
  onChange: (next: ModelSelection) => void;
  hasOverride: boolean;
  onReset: () => void;
  serverProviders: ReadonlyArray<import("@t3tools/contracts").ServerProvider>;
  settings: import("@t3tools/contracts").UnifiedSettings;
  disabled: boolean;
  trailingControl?: ReactNode;
}) {
  const provider = modelSelectionProviderKind(selection);
  const optionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    provider,
    selection.model,
  );
  const models = serverProviders.find((p) => p.provider === provider)?.models ?? [];

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-foreground/80 sm:px-5">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{label}</span>
        {hasOverride && !disabled && (
          <button
            type="button"
            className="text-muted-foreground/50 transition-colors hover:text-foreground"
            onClick={onReset}
            aria-label={`Reset ${label} to default`}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <div
          className={`flex flex-wrap items-center gap-1.5 transition-opacity ${
            disabled ? "pointer-events-none opacity-40" : ""
          }`}
          aria-disabled={disabled}
        >
          <ProviderModelPicker
            provider={provider}
            model={selection.model}
            lockedProvider={null}
            providers={serverProviders}
            modelOptionsByProvider={optionsByProvider}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            disabled={disabled}
            onProviderModelChange={(nextProvider, nextModel) => {
              onChange(makeAppModelSelection(nextProvider, nextModel));
            }}
          />
          <TraitsPicker
            provider={provider}
            models={models}
            model={selection.model}
            prompt=""
            onPromptChange={() => {}}
            modelOptions={(selection as Record<string, unknown>).options as never}
            allowPromptInjectedEffort={false}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            onModelOptionsChange={(nextOptions) => {
              onChange({
                ...selection,
                ...(nextOptions ? { options: nextOptions } : {}),
              } as ModelSelection);
            }}
          />
        </div>
        {trailingControl}
      </div>
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
