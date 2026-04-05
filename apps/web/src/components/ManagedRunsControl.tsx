import type {
  ManagedRunServiceSnapshot,
  ManagedRunSummary,
  ProjectScript,
} from "@t3tools/contracts";
import { ActivitySquareIcon } from "lucide-react";

import { truncate } from "@t3tools/shared/String";
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
                          <div
                            key={i}
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                          >
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${serviceStatusDot(service.status)}`}
                            />
                            <span className="truncate">{service.name}</span>
                          </div>
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
