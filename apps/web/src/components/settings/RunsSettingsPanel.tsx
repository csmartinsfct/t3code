import type {
  ManagedRunInferenceRecordDetail,
  ManagedRunInferenceRecordSummary,
} from "@t3tools/contracts";
import { ActivityIcon, ChevronDownIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const STATUS_BADGE_VARIANT: Record<string, "success" | "error" | "warning"> = {
  ready: "success",
  failed: "error",
  ungrounded: "warning",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status] ?? "outline"} size="sm" className="capitalize">
      {status}
    </Badge>
  );
}

function MetadataField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 break-all text-sm", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function JsonSection({
  title,
  value,
  defaultOpen = false,
}: {
  title: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = Array.isArray(value) ? value.length === 0 : value == null || value === "";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30"
        onClick={() => setOpen(!open)}
      >
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </span>
        {isEmpty && <span className="text-[10px] text-muted-foreground/50">empty</span>}
      </button>
      <CollapsibleContent>
        <div className="px-2 pb-2 pt-1">
          <JsonBlock value={value} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InferenceRecordRow({
  record,
  isExpanded,
  onToggle,
}: {
  record: ManagedRunInferenceRecordSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [detail, setDetail] = useState<ManagedRunInferenceRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    if (detail?.inferenceId === record.inferenceId) return;
    setDetailLoading(true);
    void ensureNativeApi()
      .managedRuns.getInferenceRecord({ inferenceId: record.inferenceId })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [isExpanded, detail?.inferenceId, record.inferenceId]);

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 sm:px-5"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {record.scriptName ?? record.scriptId}
            </span>
            <StatusBadge status={record.status} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>
              {record.provider}
              {record.model !== "unknown" ? ` / ${record.model}` : ""}
            </span>
            <span className="text-border">·</span>
            <span>{formatRelativeTimeLabel(record.createdAt)}</span>
            <span className="text-border">·</span>
            <span>
              {record.runtimeServiceCount} service
              {record.runtimeServiceCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      <Collapsible open={isExpanded}>
        <CollapsibleContent>
          <div className="border-t border-border/60 px-4 py-4 sm:px-5">
            {detailLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderIcon className="size-3.5 animate-spin" />
                Loading detail…
              </div>
            ) : detail ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <MetadataField label="Project" value={detail.projectId} />
                  <MetadataField label="Run ID" value={detail.runId} mono />
                  <MetadataField label="Working directory" value={detail.cwd} />
                  <MetadataField label="Created" value={formatDate(detail.createdAt)} />
                </div>

                {detail.inferenceError ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                    <p className="text-[11px] font-medium text-destructive-foreground">Error</p>
                    <p className="mt-0.5 text-xs text-destructive-foreground">
                      {detail.inferenceError}
                    </p>
                  </div>
                ) : null}

                <div className="space-y-1">
                  <JsonSection
                    title="Declared Services"
                    value={detail.declaredServices}
                    defaultOpen={
                      Array.isArray(detail.declaredServices) && detail.declaredServices.length > 0
                    }
                  />
                  <JsonSection title="Normalized Payload" value={detail.normalizedPayload} />
                  <JsonSection title="Raw Payload" value={detail.rawPayload} />
                  <JsonSection
                    title="Grounding Failures"
                    value={detail.groundingFailures}
                    defaultOpen={
                      Array.isArray(detail.groundingFailures) && detail.groundingFailures.length > 0
                    }
                  />
                  <JsonSection
                    title="Evidence Excerpt"
                    value={detail.evidenceExcerpt}
                    defaultOpen={
                      Array.isArray(detail.evidenceExcerpt) && detail.evidenceExcerpt.length > 0
                    }
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Failed to load detail.</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function RunsSettingsPanel() {
  const [records, setRecords] = useState<ReadonlyArray<ManagedRunInferenceRecordSummary>>([]);
  const [expandedInferenceId, setExpandedInferenceId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "failed" | "ungrounded">(
    "all",
  );
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [scriptFilter, setScriptFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const api = ensureNativeApi();
      const next = await api.managedRuns.listInferenceRecords({
        limit: 100,
        ...(projectFilter !== "all" ? { projectId: projectFilter as never } : {}),
        ...(scriptFilter !== "all" ? { scriptId: scriptFilter } : {}),
      });
      setRecords(
        statusFilter === "all" ? next : next.filter((record) => record.status === statusFilter),
      );
    } catch (error) {
      console.error("Failed to fetch managed run inference records", error);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [projectFilter, scriptFilter, statusFilter]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  // Reset expanded row when records change (e.g. filter applied)
  useEffect(() => {
    setExpandedInferenceId(null);
  }, [records]);

  const projectOptions = useMemo(
    () => ["all", ...new Set(records.map((record) => record.projectId))],
    [records],
  );
  const scriptOptions = useMemo(
    () => ["all", ...new Set(records.map((record) => record.scriptId))],
    [records],
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-foreground">Runs</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Inspect managed-run inference calls, normalized runtime services, and the exact
              payload stored for each inference attempt.
            </p>
          </div>
          <Button size="xs" variant="outline" onClick={() => void fetchRecords()}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value ?? "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue>{projectFilter === "all" ? "All projects" : projectFilter}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {projectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All projects" : option}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          <Select value={scriptFilter} onValueChange={(value) => setScriptFilter(value ?? "all")}>
            <SelectTrigger className="w-[200px]">
              <SelectValue>{scriptFilter === "all" ? "All actions" : scriptFilter}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {scriptOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All actions" : option}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter((value ?? "all") as "all" | "ready" | "failed" | "ungrounded")
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue>{statusFilter === "all" ? "All statuses" : statusFilter}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="ungrounded">Ungrounded</SelectItem>
            </SelectPopup>
          </Select>
        </div>

        {/* Records */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Inference Records
          </h2>
          <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <LoaderIcon className="size-4 animate-spin" />
                Loading inference records…
              </div>
            ) : records.length === 0 ? (
              <Empty className="min-h-64">
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No inference records</EmptyTitle>
                  <EmptyDescription>
                    Managed-run inference records will appear here once runs are executed.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="divide-y divide-border">
                {records.map((record) => (
                  <InferenceRecordRow
                    key={record.inferenceId}
                    record={record}
                    isExpanded={expandedInferenceId === record.inferenceId}
                    onToggle={() =>
                      setExpandedInferenceId(
                        expandedInferenceId === record.inferenceId ? null : record.inferenceId,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
