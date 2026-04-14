import {
  type ModelSelection,
  type OrchestrationPromptOverrides,
  type TicketId,
  type TicketSummary,
  type TicketTreeNode,
} from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  CircleAlertIcon,
  LinkIcon,
  PlayIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { DEFAULT_RUNTIME_MODE, type ProjectId } from "@t3tools/contracts";

import { useSettings } from "../../hooks/useSettings";
import { buildOrchestrationPlan, type OrchestrationPlan } from "../../lib/orchestrationValidation";
import { ensureNativeApi } from "../../nativeApi";
import {
  formatModelSelectionSummary,
  resolveReviewerConfigurationSummary,
} from "./orchestrationModelDisplay";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";
import { STATUS_CONFIG } from "../settings/ticketUtils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTickets: ReadonlyMap<TicketId, TicketSummary>;
  allTickets: readonly TicketSummary[];
  projectId: string;
  onConfirm: (
    selectedTicketIdentifiers: string[],
    implementerModelSelection: ModelSelection,
    reviewerModelSelection: ModelSelection,
  ) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrchestrateConfirmDialog({
  open,
  onOpenChange,
  selectedTickets,
  allTickets,
  projectId,
  onConfirm,
}: OrchestrateConfirmDialogProps) {
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch tree and compute plan when dialog opens.
  useEffect(() => {
    if (!open || selectedTickets.size === 0) {
      setPlan(null);
      setError(null);
      setIsSubmitting(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
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
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedTickets, allTickets, projectId]);

  const settings = useSettings();
  const implSel = settings.orchestrationImplementerModelSelection;
  const revSel = settings.orchestrationReviewerModelSelection;
  const implDisplayName = formatModelSelectionSummary(implSel);
  const revDisplayName = resolveReviewerConfigurationSummary(settings.maxReviewIterations, revSel);

  const handleConfirm = useCallback(async () => {
    if (isOrchestrationSubmitDisabled({ plan, isSubmitting })) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const result = await submitOrchestrationConfirm({
      plan,
      selectedTicketIdentifiers: [...selectedTickets.values()].map((ticket) => ticket.identifier),
      implementerModelSelection: implSel,
      reviewerModelSelection: revSel,
      onConfirm,
    });
    if (result.kind === "started") {
      onOpenChange(false);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
    }
    setIsSubmitting(false);
  }, [isSubmitting, plan, implSel, revSel, onConfirm, onOpenChange]);

  const runnableCount = getRunnableTicketIdentifiers(plan).length;
  const submitDisabled = isOrchestrationSubmitDisabled({
    plan,
    isSubmitting,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState error={error} onClose={() => onOpenChange(false)} />
        ) : plan?.kind === "valid" ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Orchestrate {runnableCount} ticket{runnableCount !== 1 ? "s" : ""}
              </DialogTitle>
              <DialogDescription>
                Tickets will be processed sequentially in the order below.
              </DialogDescription>
            </DialogHeader>

            <DialogPanel>
              <div className="flex flex-col gap-3">
                {/* Execution order list */}
                <div className="flex flex-col gap-1">
                  {plan.orderedTickets.map((entry, index) => (
                    <TicketRow key={entry.ticket.id} entry={entry} index={index} />
                  ))}
                </div>

                {/* Config summary */}
                <div className="mt-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Run configuration
                  </p>
                  <div className="flex flex-col gap-1 text-xs text-foreground/80">
                    <ConfigRow label="Implementer" value={implDisplayName} />
                    <ConfigRow label="Reviewer" value={revDisplayName} />
                    <ConfigRow
                      label="Runtime"
                      value={
                        DEFAULT_RUNTIME_MODE === "full-access" ? "Full access" : "Approval required"
                      }
                    />
                  </div>
                </div>
                {error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                ) : null}
              </div>
            </DialogPanel>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={() => void handleConfirm()} disabled={submitDisabled}>
                <PlayIcon className="size-3.5" />
                {isSubmitting ? "Starting..." : "Start Orchestration"}
              </Button>
            </DialogFooter>
          </>
        ) : plan?.kind === "blocked-external" ? (
          <BlockedExternalState
            externalDeps={plan.externalDeps}
            onClose={() => onOpenChange(false)}
          />
        ) : plan?.kind === "blocked-cycle" ? (
          <BlockedCycleState cycles={plan.cycles} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

export function getRunnableTicketIdentifiers(plan: OrchestrationPlan | null): string[] {
  if (plan?.kind !== "valid") {
    return [];
  }
  return plan.orderedTickets
    .filter((ticket) => ticket.annotation !== "skipped-done")
    .map((ticket) => ticket.ticket.identifier);
}

export function isOrchestrationSubmitDisabled(input: {
  plan: OrchestrationPlan | null;
  isSubmitting: boolean;
}): boolean {
  return input.plan?.kind !== "valid" || input.isSubmitting;
}

export async function submitOrchestrationConfirm(input: {
  plan: OrchestrationPlan | null;
  selectedTicketIdentifiers: string[];
  implementerModelSelection: ModelSelection;
  reviewerModelSelection: ModelSelection;
  promptOverrides?: OrchestrationPromptOverrides;
  onConfirm: (
    selectedTicketIdentifiers: string[],
    implementerModelSelection: ModelSelection,
    reviewerModelSelection: ModelSelection,
    promptOverrides?: OrchestrationPromptOverrides,
  ) => Promise<void> | void;
}): Promise<{ kind: "noop" } | { kind: "started" } | { kind: "error"; message: string }> {
  if (input.plan?.kind !== "valid") {
    return { kind: "noop" };
  }

  try {
    await input.onConfirm(
      input.selectedTicketIdentifiers,
      input.implementerModelSelection,
      input.reviewerModelSelection,
      input.promptOverrides,
    );
    return { kind: "started" };
  } catch (err: unknown) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Failed to start orchestration",
    };
  }
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

function LoadingSkeleton() {
  return (
    <>
      <DialogHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-3.5 w-56" />
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </DialogPanel>
    </>
  );
}

function ErrorState({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CircleAlertIcon className="size-4 text-destructive" />
          Error
        </DialogTitle>
        <DialogDescription>{error}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function BlockedExternalState({
  externalDeps,
  onClose,
}: {
  externalDeps: Array<{
    ticket: TicketSummary;
    dependsOn: { identifier: string; title: string; status: string };
  }>;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TriangleAlertIcon className="size-4 text-amber-500" />
          Cannot orchestrate
        </DialogTitle>
        <DialogDescription>
          Some selected tickets depend on unfinished tickets that are not included in this
          orchestration. Complete or include them first.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
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
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function BlockedCycleState({
  cycles,
  onClose,
}: {
  cycles: TicketSummary[][];
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TriangleAlertIcon className="size-4 text-destructive" />
          Dependency cycle detected
        </DialogTitle>
        <DialogDescription>
          The selected tickets contain circular dependencies that prevent determining an execution
          order. Resolve the cycles before orchestrating.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
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
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
