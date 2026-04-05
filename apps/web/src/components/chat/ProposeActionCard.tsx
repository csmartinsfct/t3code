import { useState, useCallback, memo } from "react";
import type { DeclaredService, ProjectScriptIcon } from "@t3tools/contracts";
import { CheckIcon, ContainerIcon, GlobeIcon, PlugIcon, TerminalIcon, XIcon } from "lucide-react";

import { ScriptIcon, SCRIPT_ICONS } from "../ProjectScriptsControl";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";

export interface ProposeActionCardProps {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  services?: DeclaredService[];
  isStreaming: boolean;
  onAccept: (data: {
    name: string;
    command: string;
    icon: ProjectScriptIcon;
    services?: DeclaredService[];
  }) => void;
  onReject: () => void;
}

function healthCheckLabel(check: DeclaredService["healthCheck"]): string {
  switch (check.type) {
    case "url":
      return check.url;
    case "docker":
      return `container: ${check.container}`;
    case "port":
      return `port ${check.port}${check.host ? ` on ${check.host}` : ""}`;
    case "command":
      return check.command;
  }
}

function HealthCheckIcon({ type }: { type: string }) {
  switch (type) {
    case "url":
      return <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />;
    case "docker":
      return <ContainerIcon className="size-3 shrink-0 text-muted-foreground" />;
    case "port":
      return <PlugIcon className="size-3 shrink-0 text-muted-foreground" />;
    case "command":
      return <TerminalIcon className="size-3 shrink-0 text-muted-foreground" />;
    default:
      return null;
  }
}

function ProposeActionCard({
  name: initialName,
  command: initialCommand,
  icon: initialIcon,
  services,
  isStreaming,
  onAccept,
  onReject,
}: ProposeActionCardProps) {
  const [name, setName] = useState(initialName);
  const [command, setCommand] = useState(initialCommand);
  const [icon, setIcon] = useState<ProjectScriptIcon>(initialIcon);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");

  const disabled = isStreaming || status !== "pending";

  const handleAccept = useCallback(() => {
    if (disabled) return;
    setStatus("accepted");
    onAccept({
      name: name.trim(),
      command: command.trim(),
      icon,
      ...(services ? { services } : {}),
    });
  }, [disabled, name, command, icon, services, onAccept]);

  const handleReject = useCallback(() => {
    if (disabled) return;
    setStatus("rejected");
    onReject();
  }, [disabled, onReject]);

  return (
    <div
      className="my-2 rounded-lg border border-border/70 bg-muted/30 p-3"
      data-scroll-anchor-ignore
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ScriptIcon icon={icon} className="size-3.5" />
        <span>Proposed Action</span>
        {status === "accepted" && (
          <Badge variant="outline" className="ml-auto text-[10px] text-green-600">
            Added
          </Badge>
        )}
        {status === "rejected" && (
          <Badge variant="outline" className="ml-auto text-[10px] text-red-500">
            Rejected
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {/* Name + Icon */}
        <div className="flex items-center gap-2">
          <Popover open={iconPickerOpen && !disabled} onOpenChange={setIconPickerOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  disabled={disabled}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  <ScriptIcon icon={icon} className="size-3.5" />
                </button>
              }
            />
            <PopoverPopup
              side="bottom"
              align="start"
              className="z-50 rounded-md border border-border bg-popover p-1.5 shadow-md"
            >
              <div className="grid grid-cols-3 gap-1">
                {SCRIPT_ICONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted ${
                      icon === entry.id ? "bg-primary/10 text-primary" : "text-muted-foreground"
                    }`}
                    onClick={() => {
                      setIcon(entry.id);
                      setIconPickerOpen(false);
                    }}
                  >
                    <ScriptIcon icon={entry.id} className="size-3" />
                    {entry.label}
                  </button>
                ))}
              </div>
            </PopoverPopup>
          </Popover>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            placeholder="Action name"
            className="h-8 text-sm"
          />
        </div>

        {/* Command */}
        <Textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={disabled}
          placeholder="Command"
          rows={2}
          className="resize-none text-xs font-mono"
        />

        {/* Declared Services */}
        {services && services.length > 0 && (
          <div className="rounded-md border border-border/50 bg-background/50 px-2.5 py-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Services
            </div>
            <div className="space-y-1">
              {services.map((service, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HealthCheckIcon type={service.healthCheck.type} />
                  <span className="font-medium text-foreground/80">{service.name}</span>
                  <span className="truncate text-[10px]">
                    {healthCheckLabel(service.healthCheck)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {!isStreaming && status === "pending" && (
          <div className="flex items-center justify-end gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={handleReject}
              className="gap-1 text-muted-foreground"
            >
              <XIcon className="size-3" />
              Reject
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={handleAccept}
              disabled={name.trim().length === 0 || command.trim().length === 0}
              className="gap-1"
            >
              <CheckIcon className="size-3" />
              Accept
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ProposeActionCard);
