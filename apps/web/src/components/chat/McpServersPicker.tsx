import { memo, useState } from "react";
import {
  CheckCheckIcon,
  CheckIcon,
  LoaderCircleIcon,
  LogInIcon,
  PlugIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { ManageMcpServerAction, ResolvedMcpServer } from "@t3tools/contracts";

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
  canManageServers?: boolean;
  pendingActionsByServerName?: Readonly<Record<string, ManageMcpServerAction>>;
  actionError?: string | null;
  onRetry?: () => void;
  onServerAction?: (serverName: string, action: ManageMcpServerAction) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const liveServers = props.servers ?? [];
  const hasLiveServers = liveServers.length > 0;
  const hasServers = props.serverNames.length > 0 || hasLiveServers;
  const groupedServers = groupMcpServersByScope(liveServers);
  const pendingActionsByServerName = props.pendingActionsByServerName ?? {};
  const approvalCandidates =
    props.canManageServers && props.onServerAction
      ? liveServers.filter((server) => actionForMcpServer(server) === "approve")
      : [];
  const isInitialLoading = props.status === "loading" && !hasServers;
  const isError = props.status === "error";

  const approveAll = async () => {
    if (!props.onServerAction || approvalCandidates.length === 0) return;
    setApprovingAll(true);
    try {
      for (const server of approvalCandidates) {
        if (pendingActionsByServerName[server.name]) continue;
        await props.onServerAction(server.name, "approve");
      }
    } catch {
      // The hook owns the visible error state; keep this click handler quiet.
    } finally {
      setApprovingAll(false);
    }
  };

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
          <div className="flex items-center gap-1">
            {approvalCandidates.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="h-6 gap-1 px-1.5 text-muted-foreground/85 hover:text-foreground"
                title="Approve all pending Cursor MCP servers"
                aria-label="Approve all pending Cursor MCP servers"
                disabled={approvingAll}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void approveAll();
                }}
              >
                {approvingAll ? (
                  <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin" />
                ) : (
                  <CheckCheckIcon aria-hidden="true" className="size-3" />
                )}
                <span>Approve all</span>
              </Button>
            ) : null}
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
        </div>
        {props.actionError ? (
          <div className="max-w-[22rem] px-2 pb-1.5 text-amber-500/90 text-xs">
            {props.actionError}
          </div>
        ) : null}
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
                    <McpServerStatusRow
                      key={`${group.scope}:${server.name}`}
                      server={server}
                      canManage={props.canManageServers === true}
                      pendingAction={pendingActionsByServerName[server.name]}
                      onServerAction={props.onServerAction}
                    />
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

function McpServerStatusRow(props: {
  server: ResolvedMcpServer;
  canManage: boolean;
  pendingAction: ManageMcpServerAction | undefined;
  onServerAction:
    | ((serverName: string, action: ManageMcpServerAction) => Promise<void>)
    | undefined;
}) {
  const { pendingAction, server } = props;
  const connected = server.status === "connected";
  const action = props.canManage ? actionForMcpServer(server) : null;
  const statusLabel = server.status && !connected && action === null ? server.status : null;
  const toolCount =
    typeof server.toolCount === "number" && server.toolCount > 0 ? `${server.toolCount} tools` : "";
  const titleParts = [server.name, server.status, toolCount, server.error].filter(Boolean);
  const needsAttention = action !== null || pendingAction !== undefined;

  return (
    <div
      className="flex min-w-[15rem] max-w-[22rem] items-center gap-2 px-2 py-1.5 text-sm"
      title={titleParts.join(" - ")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected ? "bg-emerald-400/80" : needsAttention ? "bg-amber-400/85" : "bg-rose-400/75",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{server.name}</span>
      {statusLabel ? (
        <span className="max-w-32 shrink truncate rounded-sm bg-muted/45 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/75">
          {statusLabel}
        </span>
      ) : null}
      {action ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-6 gap-1 px-1.5"
          disabled={pendingAction !== undefined || props.onServerAction === undefined}
          title={action === "login" ? `Log in to ${server.name}` : `Approve ${server.name}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void props.onServerAction?.(server.name, action).catch(() => undefined);
          }}
        >
          {pendingAction ? (
            <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin" />
          ) : action === "login" ? (
            <LogInIcon aria-hidden="true" className="size-3" />
          ) : (
            <CheckIcon aria-hidden="true" className="size-3" />
          )}
          <span>{action === "login" ? "Login" : "Approve"}</span>
        </Button>
      ) : null}
    </div>
  );
}

function actionForMcpServer(server: ResolvedMcpServer): ManageMcpServerAction | null {
  const status = server.status?.toLowerCase() ?? "";
  const error = server.error?.toLowerCase() ?? "";
  const searchable = `${status} ${error}`;
  if (
    searchable.includes("needs-auth") ||
    searchable.includes("needs auth") ||
    searchable.includes("needs-login") ||
    searchable.includes("needs login") ||
    searchable.includes("login required") ||
    searchable.includes("not authenticated") ||
    searchable.includes("unauthenticated") ||
    searchable.includes("oauth")
  ) {
    return "login";
  }
  if (
    searchable.includes("needs-approval") ||
    searchable.includes("needs approval") ||
    searchable.includes("approval required") ||
    searchable.includes("not approved")
  ) {
    return "approve";
  }
  return null;
}
