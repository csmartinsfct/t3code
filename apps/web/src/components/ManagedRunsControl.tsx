import type {
  ManagedRunServiceSnapshot,
  ManagedRunSummary,
  ProjectScript,
  ServiceHealthCheck,
} from "@t3tools/contracts";
import { ActivitySquareIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { truncate } from "@t3tools/shared/String";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuTrigger } from "./ui/menu";

interface ManagedRunsControlProps {
  runs: ReadonlyArray<ManagedRunSummary>;
  scripts?: ReadonlyArray<ProjectScript>;
}

function resolveRunName(run: ManagedRunSummary, scripts?: ReadonlyArray<ProjectScript>): string {
  return scripts?.find((s) => s.id === run.scriptId)?.name ?? run.scriptId;
}

function resolveRunCommand(run: ManagedRunSummary, scripts?: ReadonlyArray<ProjectScript>): string {
  return scripts?.find((s) => s.id === run.scriptId)?.command ?? "";
}

function serviceStatusDot(status: ManagedRunServiceSnapshot["status"]) {
  if (status === "healthy") return "bg-green-500";
  if (status === "unhealthy") return "bg-red-500";
  return "bg-muted-foreground/40";
}

function deriveUrl(healthCheck: ServiceHealthCheck): string | null {
  if (healthCheck.type === "url") return healthCheck.url;
  if (healthCheck.type === "port")
    return `http://${healthCheck.host ?? "localhost"}:${healthCheck.port}`;
  return null;
}

function ServiceRow({ service }: { service: ManagedRunServiceSnapshot }) {
  const url = deriveUrl(service.healthCheck);
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
      <span className={`size-1.5 shrink-0 rounded-full ${serviceStatusDot(service.status)}`} />
      <span className="min-w-0 truncate">{service.name}</span>
      {open &&
        pos &&
        createPortal(
          <div
            className="fixed z-[200] rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md animate-in fade-in zoom-in-95 duration-100"
            style={{ top: pos.top, left: pos.left, transform: "translate(-100%, -50%)" }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            {url ? (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  URL
                </div>
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
              </div>
            ) : (
              <span className="text-muted-foreground">No metadata</span>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function serviceSummary(run: ManagedRunSummary) {
  if (run.serviceStatuses.length === 0) return null;
  const healthy = run.serviceStatuses.filter((s) => s.status === "healthy").length;
  return `${healthy}/${run.serviceStatuses.length}`;
}

function secondaryText(run: ManagedRunSummary, scripts?: ReadonlyArray<ProjectScript>) {
  if (run.detectedUrl) return run.detectedUrl;
  const summary = serviceSummary(run);
  if (summary) return `${summary} services up`;
  const command = resolveRunCommand(run, scripts);
  return command ? truncate(command, 56) : run.scriptId;
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
      <MenuPopup align="end" side="bottom" className="w-[320px]">
        <div className="max-h-[400px] overflow-y-auto">
          <MenuGroup>
            <MenuGroupLabel>Active Runs</MenuGroupLabel>
            {runs.length === 0 ? (
              <div className="px-2 py-3 text-muted-foreground text-xs">
                No active managed runs for this project.
              </div>
            ) : (
              <div className="space-y-1 p-1">
                {runs.map((run) => (
                  <div
                    key={run.runId}
                    className="rounded-md border border-border/70 px-2 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 font-medium text-foreground">
                        {truncate(resolveRunName(run, scripts), 24)}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {serviceSummary(run) && (
                          <span className="text-[10px] text-muted-foreground">
                            {serviceSummary(run)}
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {run.status}
                        </Badge>
                      </div>
                    </div>
                    {/* Service-level detail */}
                    {run.serviceStatuses.length > 0 ? (
                      <div className="mt-1.5 space-y-0.5">
                        {run.serviceStatuses.map((service, i) => (
                          <ServiceRow key={i} service={service} />
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
                ))}
              </div>
            )}
          </MenuGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}
