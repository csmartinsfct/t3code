import { memo, useCallback, useMemo, useState } from "react";
import {
  CheckCheckIcon,
  CheckIcon,
  LoaderCircleIcon,
  LogInIcon,
  PlugIcon,
  RefreshCwIcon,
} from "lucide-react";
import type {
  ManageMcpServerAction,
  OverlayMenuAction,
  OverlayMenuItem,
  ResolvedMcpServer,
} from "@t3tools/contracts";

import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";

const EMPTY_PENDING_MCP_ACTIONS: Readonly<Record<string, ManageMcpServerAction>> = {};
const EMPTY_MCP_SERVERS: readonly ResolvedMcpServer[] = [];

/**
 * Read-only popover that lists the MCP server names available for the current
 * project/provider.
 */
export const McpServersPicker = memo(function McpServersPicker({
  status,
  refreshing,
  serverNames,
  servers,
  error,
  compact,
  canManageServers,
  pendingActionsByServerName: pendingActions,
  actionError,
  onRetry,
  onServerAction,
}: {
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
  const liveServers = servers ?? EMPTY_MCP_SERVERS;
  const hasLiveServers = liveServers.length > 0;
  const hasServers = serverNames.length > 0 || hasLiveServers;
  const groupedServers = useMemo(() => groupMcpServersByScope(liveServers), [liveServers]);
  const pendingActionsByServerName = pendingActions ?? EMPTY_PENDING_MCP_ACTIONS;
  const approvalCandidates = useMemo(
    () =>
      canManageServers && onServerAction
        ? liveServers.filter((server) => actionForMcpServer(server) === "approve")
        : [],
    [canManageServers, liveServers, onServerAction],
  );
  const isLoading = status === "loading" || refreshing === true;
  const isInitialLoading = status === "loading" && !hasServers;
  const isError = status === "error";

  const approveAll = useCallback(async () => {
    if (!onServerAction || approvalCandidates.length === 0) return;
    setApprovingAll(true);
    try {
      for (const server of approvalCandidates) {
        if (pendingActionsByServerName[server.name]) continue;
        await onServerAction(server.name, "approve");
      }
    } catch {
      // The hook owns the visible error state; keep this click handler quiet.
    } finally {
      setApprovingAll(false);
    }
  }, [approvalCandidates, onServerAction, pendingActionsByServerName]);

  const { overlayItems, overlaySelectionById } = useMemo(() => {
    const items: OverlayMenuItem[] = [];
    const selectionById = new Map<string, () => void>();
    const headerActions: OverlayMenuAction[] = [];

    if (approvalCandidates.length > 1) {
      const approveAllId = "mcp:approve-all";
      headerActions.push({
        id: approveAllId,
        label: "Approve all",
        ariaLabel: "Approve all pending Cursor MCP servers",
        icon: approvingAll ? "LoaderCircle" : "CheckCheck",
        iconClassName: "size-3",
        disabled: approvingAll,
        loading: approvingAll,
      });
      selectionById.set(approveAllId, () => void approveAll());
    }

    if (onRetry) {
      const refreshId = "mcp:refresh";
      headerActions.push({
        id: refreshId,
        ariaLabel: "Refresh MCP status",
        icon: "RefreshCw",
        iconClassName: cn("size-3.5", refreshing && "animate-spin opacity-70"),
        disabled: refreshing === true,
      });
      selectionById.set(refreshId, () => onRetry());
    }

    items.push({
      id: "mcp-header",
      label: "MCP Servers",
      labelOnly: true,
      actions: headerActions,
    });

    if (actionError) {
      items.push({
        id: "mcp-action-error",
        label: actionError,
        statusTone: "warning",
        selectDisabled: true,
      });
    }

    if (isError) {
      items.push({
        id: "mcp-error",
        label: error?.trim() || "Unable to load MCP status.",
        statusTone: "warning",
        selectDisabled: true,
      });
    } else if (hasLiveServers) {
      groupedServers.forEach((group) => {
        items.push({
          id: `mcp-scope-${group.scope}`,
          label: group.scope,
          labelOnly: true,
        });

        for (const server of group.servers) {
          const healthy = isHealthyMcpStatus(server.status);
          const action = canManageServers ? actionForMcpServer(server) : null;
          const pendingAction = pendingActionsByServerName[server.name];
          const statusLabel = server.status && !healthy && action === null ? server.status : null;
          const toolCount =
            typeof server.toolCount === "number" && server.toolCount > 0
              ? `${server.toolCount} tools`
              : undefined;
          const needsAttention = action !== null || pendingAction !== undefined;
          const secondaryAction = action
            ? createMcpOverlayAction({
                serverName: server.name,
                action,
                pendingAction,
                onServerAction,
              })
            : undefined;

          if (secondaryAction && action && onServerAction && pendingAction === undefined) {
            selectionById.set(secondaryAction.id, () => {
              void onServerAction(server.name, action).catch(() => undefined);
            });
          }

          items.push({
            id: `mcp-server-${server.name}`,
            label: server.name,
            description: server.error || toolCount,
            badge: statusLabel ?? undefined,
            statusTone: healthy ? "success" : needsAttention ? "warning" : "danger",
            selectDisabled: true,
            secondaryAction,
          });
        }
      });
    } else if (hasServers) {
      for (const name of serverNames) {
        items.push({
          id: `mcp-server-name-${name}`,
          label: name,
          selectDisabled: true,
        });
      }
    } else if (isLoading) {
      items.push({
        id: "mcp-loading",
        label: "Loading",
        statusTone: "muted",
        selectDisabled: true,
        secondaryAction: {
          id: "mcp-loading-spinner",
          ariaLabel: "Loading MCP status",
          icon: "LoaderCircle",
          iconClassName: "size-3.5",
          loading: true,
          disabled: true,
        },
      });
    } else {
      items.push({
        id: "mcp-empty",
        label: "No MCP servers",
        selectDisabled: true,
      });
    }

    return { overlayItems: items, overlaySelectionById: selectionById };
  }, [
    approvalCandidates.length,
    approveAll,
    approvingAll,
    actionError,
    canManageServers,
    error,
    groupedServers,
    hasLiveServers,
    hasServers,
    isError,
    isLoading,
    onRetry,
    onServerAction,
    pendingActionsByServerName,
    refreshing,
    serverNames,
  ]);

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      overlayItems={overlayItems}
      overlayMenuAlign="start"
      overlayOnSelect={(id) => overlaySelectionById.get(id)?.()}
      overlayOnAction={(id) => overlaySelectionById.get(id)?.()}
    >
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
            title={isInitialLoading ? "Loading MCP status" : "MCP servers"}
          />
        }
      >
        <PlugIcon aria-hidden="true" className="size-4" />
        {!compact ? <span className="sr-only sm:not-sr-only">MCP</span> : null}
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
            {onRetry ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground/65 hover:text-foreground"
                title="Refresh MCP status"
                aria-label="Refresh MCP status"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRetry();
                }}
              >
                <RefreshCwIcon
                  aria-hidden="true"
                  className={cn("size-3.5", refreshing && "animate-spin opacity-70")}
                />
              </Button>
            ) : null}
          </div>
        </div>
        {actionError ? (
          <div className="max-w-[22rem] px-2 pb-1.5 text-amber-500/90 text-xs">{actionError}</div>
        ) : null}
        {isError ? (
          <div className="max-w-[22rem] px-2 py-1.5 text-amber-500/90 text-sm">
            {error?.trim() || "Unable to load MCP status."}
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
                      canManage={canManageServers === true}
                      pendingAction={pendingActionsByServerName[server.name]}
                      onServerAction={onServerAction}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : hasServers ? (
          serverNames.map((name) => (
            <div key={name} className="px-2 py-1.5 text-sm">
              {name}
            </div>
          ))
        ) : isLoading ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-sm">
            <span>Loading</span>
            <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
          </div>
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
  const healthy = isHealthyMcpStatus(server.status);
  const action = props.canManage ? actionForMcpServer(server) : null;
  const statusLabel = server.status && !healthy && action === null ? server.status : null;
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
          healthy ? "bg-emerald-400/80" : needsAttention ? "bg-amber-400/85" : "bg-rose-400/75",
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

function isHealthyMcpStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase().trim() ?? "";
  return normalized === "connected" || normalized === "ready" || normalized === "loaded";
}

function createMcpOverlayAction(props: {
  serverName: string;
  action: ManageMcpServerAction;
  pendingAction: ManageMcpServerAction | undefined;
  onServerAction:
    | ((serverName: string, action: ManageMcpServerAction) => Promise<void>)
    | undefined;
}): OverlayMenuAction {
  const pending = props.pendingAction !== undefined;
  const isLogin = props.action === "login";
  const label = isLogin ? "Login" : "Approve";

  return {
    id: `mcp-server-action:${props.serverName}:${props.action}`,
    label,
    ariaLabel: isLogin ? `Log in to ${props.serverName}` : `Approve ${props.serverName}`,
    icon: pending ? "LoaderCircle" : isLogin ? "LogIn" : "Check",
    iconClassName: "size-3",
    disabled: pending || props.onServerAction === undefined,
    loading: pending,
  };
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
