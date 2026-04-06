import type {
  ManagedRunRuntimeService,
  ManagedRunSummary,
  ProjectScript,
  ServiceHealthCheck,
} from "@t3tools/contracts";
import { ActivitySquareIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { truncate } from "@t3tools/shared/String";
import { readNativeApi } from "~/nativeApi";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuTrigger } from "./ui/menu";

interface ManagedRunsControlProps {
  runs: ReadonlyArray<ManagedRunSummary>;
  scripts?: ReadonlyArray<ProjectScript>;
}

function resolveRunName(run: ManagedRunSummary, scripts?: ReadonlyArray<ProjectScript>): string {
  return scripts?.find((script) => script.id === run.scriptId)?.name ?? run.scriptId;
}

function resolveRunCommand(run: ManagedRunSummary, scripts?: ReadonlyArray<ProjectScript>): string {
  return scripts?.find((script) => script.id === run.scriptId)?.command ?? "";
}

function serviceStatusDot(status: ManagedRunRuntimeService["validationStatus"]) {
  if (status === "healthy") return "bg-green-500";
  if (status === "unhealthy") return "bg-red-500";
  return "bg-muted-foreground/40";
}

function deriveUrl(healthCheck: ServiceHealthCheck | null): string | null {
  if (!healthCheck) return null;
  if (healthCheck.type === "url") return healthCheck.url;
  if (healthCheck.type === "port")
    return `http://${healthCheck.host ?? "localhost"}:${healthCheck.port}`;
  return null;
}

function ServiceRow({ service }: { service: ManagedRunRuntimeService }) {
  const url = deriveUrl(service.canonicalHealthCheck);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(() => {
    clearTimeout(closeTimer.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.top + rect.height / 2, left: rect.left - 30 });
    }
    setOpen(true);
  }, []);

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const cancelClose = useCallback(() => {
    clearTimeout(closeTimer.current);
  }, []);

  return (
    <div
      ref={triggerRef}
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${serviceStatusDot(service.validationStatus)}`}
      />
      <span className="min-w-0 truncate">{service.resolvedName}</span>
      {open &&
        pos &&
        createPortal(
          <div
            className="fixed z-[200] rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md animate-in fade-in zoom-in-95 duration-100"
            style={{ top: pos.top, left: pos.left, transform: "translate(-100%, -50%)" }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {service.role}
              </div>
              {url ? (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 font-mono text-[11px] text-foreground">{url}</div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => copyToClipboard(url)}
                      title="Copy URL"
                    >
                      {isCopied ? (
                        <CheckIcon className="size-3 text-success" />
                      ) : (
                        <CopyIcon className="size-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                      title="Open in browser"
                    >
                      <ExternalLinkIcon className="size-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground">No open URL</span>
              )}
              <div className="text-[10px] capitalize text-muted-foreground">
                {service.validationStatus}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function serviceSummary(run: ManagedRunSummary) {
  if (run.runtimeServices.length === 0) return null;
  const healthy = run.runtimeServices.filter(
    (service) => service.validationStatus === "healthy",
  ).length;
  return `${healthy}/${run.runtimeServices.length}`;
}

function secondaryText(run: ManagedRunSummary, scripts?: ReadonlyArray<ProjectScript>) {
  if (run.detectedUrl) return run.detectedUrl;
  const summary = serviceSummary(run);
  if (summary) return `${summary} services validated`;
  if (run.inferenceStatus === "pending") return "Inferring runtime services…";
  if (run.inferenceStatus === "ungrounded") return "Inference could not ground a runtime target";
  if (run.inferenceError) return run.inferenceError;
  const command = resolveRunCommand(run, scripts);
  return command ? truncate(command, 56) : run.scriptId;
}

function isStoppableRun(run: ManagedRunSummary): boolean {
  return run.status === "running" || run.status === "starting";
}

function RunStatusControl({ run, runName }: { run: ManagedRunSummary; runName: string }) {
  const [isStopping, setIsStopping] = useState(false);
  const stoppable = isStoppableRun(run);

  const handleStop = useCallback(async () => {
    const api = readNativeApi();
    if (!api || isStopping) return;

    const confirmed = await api.dialogs.confirm(
      [
        `Stop run "${truncate(runName, 40)}"?`,
        "",
        "This will stop the active managed run and any tracked services it owns.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setIsStopping(true);
    try {
      await api.managedRuns.stop({ runId: run.runId });
    } finally {
      setIsStopping(false);
    }
  }, [isStopping, run.runId, runName]);

  return (
    <div className="relative h-5.5 w-[78px] shrink-0 sm:h-4.5">
      <Badge
        variant="outline"
        className={`absolute inset-0 flex w-full justify-center text-[10px] capitalize transition-opacity duration-150 ${
          stoppable
            ? "opacity-100 group-hover/run-card:opacity-0 group-focus-within/run-card:opacity-0"
            : "opacity-100"
        }`}
      >
        {run.status}
      </Badge>
      {stoppable ? (
        <Button
          variant="destructive-outline"
          className={`absolute inset-0 h-5.5 w-full gap-1 rounded-sm px-[calc(--spacing(1)-1px)] text-sm sm:h-4.5 sm:text-xs ${
            isStopping
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover/run-card:pointer-events-auto group-hover/run-card:opacity-100 group-focus-within/run-card:pointer-events-auto group-focus-within/run-card:opacity-100"
          }`}
          onClick={handleStop}
          disabled={isStopping}
        >
          {isStopping ? "Stopping" : "Stop"}
        </Button>
      ) : null}
    </div>
  );
}

function RunCard({
  run,
  scripts,
}: {
  run: ManagedRunSummary;
  scripts?: ReadonlyArray<ProjectScript>;
}) {
  const runName = resolveRunName(run, scripts);

  return (
    <div
      key={run.runId}
      className="group/run-card rounded-md border border-border/70 px-2 py-2 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-medium text-foreground">{truncate(runName, 24)}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {serviceSummary(run) && (
            <span className="text-[10px] text-muted-foreground">{serviceSummary(run)}</span>
          )}
          <RunStatusControl run={run} runName={runName} />
        </div>
      </div>
      {run.runtimeServices.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {run.runtimeServices.map((service) => (
            <ServiceRow
              key={`${service.declaredServiceName ?? service.resolvedName}-${service.role}-${deriveUrl(service.canonicalHealthCheck) ?? "no-url"}`}
              service={service}
            />
          ))}
        </div>
      ) : (
        <div
          className="mt-1 truncate text-muted-foreground text-xs"
          title={secondaryText(run, scripts)}
        >
          {secondaryText(run, scripts)}
        </div>
      )}
    </div>
  );
}

export default function ManagedRunsControl({ runs, scripts }: ManagedRunsControlProps) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="xs" variant="outline" className="shrink-0 gap-1">
            <ActivitySquareIcon className="size-3" />
            <span>Runs</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {runs.length}
            </Badge>
          </Button>
        }
      />
      <MenuPopup align="end" side="bottom" className="w-[340px]">
        <div className="max-h-[420px] overflow-y-auto">
          <MenuGroup>
            <MenuGroupLabel>Active Runs</MenuGroupLabel>
            {runs.length === 0 ? (
              <div className="px-2 py-3 text-muted-foreground text-xs">
                No active managed runs for this project.
              </div>
            ) : (
              <div className="space-y-1 p-1">
                {runs.map((run) => (
                  <RunCard key={run.runId} run={run} {...(scripts ? { scripts } : {})} />
                ))}
              </div>
            )}
          </MenuGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}
