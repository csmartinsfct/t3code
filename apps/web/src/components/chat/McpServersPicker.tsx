import { memo, useState } from "react";
import { PlugIcon, RefreshCwIcon } from "lucide-react";
import type { ResolvedMcpServer } from "@t3tools/contracts";

import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";

/**
 * Read-only popover that lists the MCP server names available for the current
 * project/provider.
 */
export const McpServersPicker = memo(function McpServersPicker(props: {
  status: "loading" | "ready" | "error";
  refreshing?: boolean;
  serverNames: readonly string[];
  servers?: readonly ResolvedMcpServer[];
  error?: string | null;
  compact?: boolean;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const liveServers = props.servers ?? [];
  const hasLiveServers = liveServers.length > 0;
  const hasServers = props.serverNames.length > 0 || hasLiveServers;
  const groupedServers = groupMcpServersByScope(liveServers);
  const isInitialLoading = props.status === "loading" && !hasServers;
  const isError = props.status === "error";

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80",
              isInitialLoading &&
                "cursor-default text-muted-foreground/35 hover:text-muted-foreground/35",
              isError && "text-amber-500/85 hover:text-amber-400",
            )}
            aria-label="MCP servers"
            disabled={isInitialLoading}
            title={isInitialLoading ? "Loading MCP status" : "MCP servers"}
          />
        }
      >
        <PlugIcon aria-hidden="true" className="size-4" />
        {!props.compact ? <span className="sr-only sm:not-sr-only">MCP</span> : null}
      </MenuTrigger>
      <MenuPopup align="start">
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div className="font-medium text-muted-foreground text-xs">MCP Servers</div>
          {props.onRetry ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground/65 hover:text-foreground"
              title="Retry MCP status"
              aria-label="Retry MCP status"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onRetry?.();
              }}
            >
              <RefreshCwIcon
                aria-hidden="true"
                className={cn("size-3.5", props.refreshing && "animate-spin opacity-70")}
              />
            </Button>
          ) : null}
        </div>
        {isError ? (
          <div className="max-w-[22rem] px-2 py-1.5 text-amber-500/90 text-sm">
            {props.error?.trim() || "Unable to load MCP status."}
          </div>
        ) : hasLiveServers ? (
          <div className="space-y-2 py-0.5">
            {groupedServers.map((group) => (
              <div key={group.scope}>
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
                  {group.scope}
                </div>
                <div className="space-y-0.5">
                  {group.servers.map((server) => (
                    <McpServerStatusRow key={`${group.scope}:${server.name}`} server={server} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : hasServers ? (
          props.serverNames.map((name) => (
            <div key={name} className="px-2 py-1.5 text-sm">
              {name}
            </div>
          ))
        ) : (
          <div className="px-2 py-1.5 text-muted-foreground text-sm">No MCP servers</div>
        )}
      </MenuPopup>
    </Menu>
  );
});

function groupMcpServersByScope(servers: readonly ResolvedMcpServer[]): Array<{
  scope: string;
  servers: ResolvedMcpServer[];
}> {
  const byScope = new Map<string, ResolvedMcpServer[]>();
  for (const server of servers) {
    const scope = server.scope?.trim() || "session";
    const group = byScope.get(scope);
    if (group) {
      group.push(server);
    } else {
      byScope.set(scope, [server]);
    }
  }
  return Array.from(byScope, ([scope, group]) => ({
    scope,
    servers: group.toSorted((a, b) => a.name.localeCompare(b.name)),
  })).toSorted((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || a.scope.localeCompare(b.scope));
}

function scopeRank(scope: string): number {
  switch (scope) {
    case "project":
      return 0;
    case "local":
      return 1;
    case "user":
      return 2;
    case "claudeai":
      return 3;
    case "managed":
      return 4;
    default:
      return 5;
  }
}

function McpServerStatusRow(props: { server: ResolvedMcpServer }) {
  const { server } = props;
  const connected = server.status === "connected";
  const statusLabel = server.status && !connected ? server.status : null;
  const toolCount =
    typeof server.toolCount === "number" && server.toolCount > 0 ? `${server.toolCount} tools` : "";
  const titleParts = [server.name, server.status, toolCount, server.error].filter(Boolean);

  return (
    <div
      className="flex min-w-[15rem] max-w-[22rem] items-center gap-2 px-2 py-1.5 text-sm"
      title={titleParts.join(" - ")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected ? "bg-emerald-400/80" : "bg-rose-400/75",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{server.name}</span>
      {statusLabel ? (
        <span className="shrink-0 rounded-sm bg-muted/45 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/75">
          {statusLabel}
        </span>
      ) : null}
    </div>
  );
}
