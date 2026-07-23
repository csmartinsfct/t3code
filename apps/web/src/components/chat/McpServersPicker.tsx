import { memo, useCallback, useMemo, useState } from "react";
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
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { cn } from "~/lib/utils";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

const EMPTY_PENDING_MCP_ACTIONS: Readonly<Record<string, ManageMcpServerAction>> = {};
const EMPTY_MCP_SERVERS: readonly ResolvedMcpServer[] = [];
const MCP_SERVERS_PICKER_OVERLAY_ROUTE_KEY = "mcp-servers-picker-menu";

type McpServersPickerRouteEvent =
  | { type: "approve-all" }
  | { type: "refresh" }
  | { type: "server-action"; serverName: string; action: ManageMcpServerAction };

interface McpServersMenuContentProps {
  actionError?: string | null | undefined;
  approvingAll: boolean;
  canManageServers?: boolean | undefined;
  error?: string | null | undefined;
  groupedServers: readonly McpServerGroup[];
  hasLiveServers: boolean;
  hasServers: boolean;
  isError: boolean;
  isLoading: boolean;
  onApproveAll?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onServerAction?:
    | ((serverName: string, action: ManageMcpServerAction) => Promise<void> | void)
    | undefined;
  pendingActionsByServerName: Readonly<Record<string, ManageMcpServerAction>>;
  refreshing?: boolean | undefined;
  serverNames: readonly string[];
}

type McpServerGroup = {
  scope: string;
  servers: ResolvedMcpServer[];
};

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

  const handleRouteEvent = useCallback(
    (type: string, payload: unknown) => {
      const event = readMcpServersPickerRouteEvent(type, payload);
      if (!event) return;
      if (event.type === "approve-all") {
        void approveAll();
        return;
      }
      if (event.type === "refresh") {
        onRetry?.();
        return;
      }
      void onServerAction?.(event.serverName, event.action).catch(() => undefined);
    },
    [approveAll, onRetry, onServerAction],
  );
  const route = useRoutedPopoverSurface<HTMLButtonElement>({
    routeKey: MCP_SERVERS_PICKER_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "start",
    params: {
      actionError,
      approvingAll,
      canManageServers,
      error,
      hasRetry: onRetry !== undefined,
      hasServerAction: onServerAction !== undefined,
      pendingActionsByServerName,
      refreshing,
      serverNames,
      servers: liveServers,
      status,
    },
    onEvent: handleRouteEvent,
  });

  return (
    <Menu open={route.domOpen} onOpenChange={route.onOpenChange}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80 not-hover:data-pressed:bg-transparent! not-hover:data-popup-open:bg-transparent!",
              isInitialLoading &&
                "cursor-default text-muted-foreground/35 hover:text-muted-foreground/35",
              isError && "text-amber-500/85 hover:text-amber-400",
            )}
            aria-label="MCP servers"
            title={isInitialLoading ? "Loading MCP status" : "MCP servers"}
          />
        }
        onFocusCapture={route.updateAnchor}
        onMouseOverCapture={route.updateAnchor}
        ref={route.triggerRef}
      >
        <PlugIcon aria-hidden="true" className="size-4" />
        {!compact ? <span className="sr-only sm:not-sr-only">MCP</span> : null}
      </MenuTrigger>
      <MenuPopup align="start">
        <McpServersMenuContent
          actionError={actionError}
          approvingAll={approvingAll}
          canManageServers={canManageServers}
          error={error}
          groupedServers={groupedServers}
          hasLiveServers={hasLiveServers}
          hasServers={hasServers}
          isError={isError}
          isLoading={isLoading}
          onApproveAll={approvalCandidates.length > 1 ? approveAll : undefined}
          onRetry={onRetry}
          onServerAction={onServerAction}
          pendingActionsByServerName={pendingActionsByServerName}
          refreshing={refreshing}
          serverNames={serverNames}
        />
      </MenuPopup>
    </Menu>
  );
});

function McpServersMenuContent({
  actionError,
  approvingAll,
  canManageServers,
  error,
  groupedServers,
  hasLiveServers,
  hasServers,
  isError,
  isLoading,
  onApproveAll,
  onRetry,
  onServerAction,
  pendingActionsByServerName,
  refreshing,
  serverNames,
}: McpServersMenuContentProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-2 py-1.5">
        <div className="font-medium text-muted-foreground text-xs">MCP Servers</div>
        <div className="flex items-center gap-1">
          {onApproveAll ? (
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
                onApproveAll();
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
              className="size-6 text-muted-foreground/65 hover:text-foreground focus-visible:ring-offset-transparent"
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
      ) : null}
      {hasLiveServers ? (
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
      ) : isError ? null : (
        <div className="px-2 py-1.5 text-muted-foreground text-sm">No MCP servers</div>
      )}
    </>
  );
}

function groupMcpServersByScope(servers: readonly ResolvedMcpServer[]): McpServerGroup[] {
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
    | ((serverName: string, action: ManageMcpServerAction) => Promise<void> | void)
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
            void Promise.resolve(props.onServerAction?.(server.name, action)).catch(
              () => undefined,
            );
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

function isManageMcpServerAction(value: unknown): value is ManageMcpServerAction {
  return value === "approve" || value === "login" || value === "disable";
}

function readMcpServersPickerRouteEvent(
  type: string,
  payload: unknown,
): McpServersPickerRouteEvent | null {
  if (type === "approve-all") return { type };
  if (type === "refresh") return { type };
  if (type !== "server-action" || !payload || typeof payload !== "object") return null;
  const candidate = payload as { action?: unknown; serverName?: unknown };
  if (typeof candidate.serverName !== "string" || !isManageMcpServerAction(candidate.action)) {
    return null;
  }
  return {
    type,
    action: candidate.action,
    serverName: candidate.serverName,
  };
}

function readBooleanParam(value: unknown): boolean {
  return value === true;
}

function readOptionalStringParam(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readMcpStatusParam(value: unknown): "loading" | "ready" | "error" {
  return value === "loading" || value === "error" ? value : "ready";
}

function readStringArrayParam(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readResolvedMcpServersParam(value: unknown): ResolvedMcpServer[] {
  if (!Array.isArray(value)) return [];
  const servers: ResolvedMcpServer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<ResolvedMcpServer>;
    if (typeof candidate.name !== "string") continue;
    servers.push({
      name: candidate.name,
      ...(typeof candidate.status === "string" ? { status: candidate.status } : {}),
      ...(typeof candidate.scope === "string" ? { scope: candidate.scope } : {}),
      ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
      ...(typeof candidate.toolCount === "number" ? { toolCount: candidate.toolCount } : {}),
      ...(candidate.serverInfo !== undefined ? { serverInfo: candidate.serverInfo } : {}),
      ...(candidate.config !== undefined ? { config: candidate.config } : {}),
      ...(Array.isArray(candidate.tools) ? { tools: candidate.tools } : {}),
    });
  }
  return servers;
}

function readPendingMcpActionsParam(value: unknown): Record<string, ManageMcpServerAction> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const pendingActions: Record<string, ManageMcpServerAction> = {};
  for (const [serverName, action] of Object.entries(value)) {
    if (isManageMcpServerAction(action)) pendingActions[serverName] = action;
  }
  return pendingActions;
}

registerOverlayRoute<{
  actionError?: unknown;
  approvingAll?: unknown;
  canManageServers?: unknown;
  error?: unknown;
  hasRetry?: unknown;
  hasServerAction?: unknown;
  pendingActionsByServerName?: unknown;
  refreshing?: unknown;
  serverNames?: unknown;
  servers?: unknown;
  status?: unknown;
}>(
  MCP_SERVERS_PICKER_OVERLAY_ROUTE_KEY,
  function McpServersPickerOverlayRoute({ controller, message }) {
    const status = readMcpStatusParam(message.params.status);
    const refreshing = readBooleanParam(message.params.refreshing);
    const serverNames = readStringArrayParam(message.params.serverNames);
    const liveServers = readResolvedMcpServersParam(message.params.servers);
    const hasLiveServers = liveServers.length > 0;
    const hasServers = serverNames.length > 0 || hasLiveServers;
    const groupedServers = groupMcpServersByScope(liveServers);
    const pendingActionsByServerName = readPendingMcpActionsParam(
      message.params.pendingActionsByServerName,
    );
    const canManageServers = readBooleanParam(message.params.canManageServers);
    const hasServerAction = readBooleanParam(message.params.hasServerAction);
    const approvalCandidates =
      canManageServers && hasServerAction
        ? liveServers.filter((server) => actionForMcpServer(server) === "approve")
        : [];
    const isLoading = status === "loading" || refreshing;
    const isError = status === "error";

    return (
      <OverlayRouteMenu>
        <OverlayRouteMenuPopup align="start">
          <McpServersMenuContent
            actionError={readOptionalStringParam(message.params.actionError)}
            approvingAll={readBooleanParam(message.params.approvingAll)}
            canManageServers={canManageServers}
            error={readOptionalStringParam(message.params.error)}
            groupedServers={groupedServers}
            hasLiveServers={hasLiveServers}
            hasServers={hasServers}
            isError={isError}
            isLoading={isLoading}
            onApproveAll={
              approvalCandidates.length > 1
                ? () => controller.bridge.emitEvent("approve-all", {})
                : undefined
            }
            onRetry={
              readBooleanParam(message.params.hasRetry)
                ? () => controller.bridge.emitEvent("refresh", {})
                : undefined
            }
            onServerAction={
              hasServerAction
                ? (serverName, action) =>
                    controller.bridge.emitEvent("server-action", { serverName, action })
                : undefined
            }
            pendingActionsByServerName={pendingActionsByServerName}
            refreshing={refreshing}
            serverNames={serverNames}
          />
        </OverlayRouteMenuPopup>
      </OverlayRouteMenu>
    );
  },
);
