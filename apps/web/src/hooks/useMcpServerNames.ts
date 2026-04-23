import {
  asProviderInput,
  baseProviderKind,
  type ProjectId,
  type ProviderKind,
  type ResolvedMcpProviderSnapshot,
  type ResolvedMcpServer,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readNativeApi } from "../nativeApi";
import {
  applyMcpStatusSnapshots,
  useMcpConfigRevision,
  useMcpStatusInvalidationRevision,
  useMcpStatusSnapshot,
} from "../rpc/serverState";

const EMPTY: readonly string[] = [];
const EMPTY_SERVERS: readonly ResolvedMcpServer[] = [];

export interface ResolvedMcpServersState {
  readonly status: "loading" | "ready" | "error";
  readonly refreshing: boolean;
  readonly serverNames: readonly string[];
  readonly servers: readonly ResolvedMcpServer[];
  readonly error: string | null;
  readonly retry: () => void;
}

function emptyState(retry: () => void): ResolvedMcpServersState {
  return {
    status: "ready",
    refreshing: false,
    serverNames: EMPTY,
    servers: EMPTY_SERVERS,
    error: null,
    retry,
  };
}

function selectedClaudeSnapshot(input: {
  readonly provider: ProviderKind;
  readonly projectId: ProjectId | undefined;
  readonly cwd: string;
  readonly result: {
    readonly status: "loading" | "ready" | "error";
    readonly refreshing?: boolean | undefined;
    readonly serverNames: readonly string[];
    readonly servers?: readonly ResolvedMcpServer[] | undefined;
    readonly updatedAt?: string | undefined;
    readonly error?: string | undefined;
  };
}): ResolvedMcpProviderSnapshot {
  return {
    provider: input.provider,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    cwd: input.cwd,
    status: input.result.status,
    ...(input.result.refreshing !== undefined ? { refreshing: input.result.refreshing } : {}),
    serverNames: input.result.serverNames,
    ...(input.result.servers !== undefined ? { servers: input.result.servers } : {}),
    ...(input.result.updatedAt !== undefined ? { updatedAt: input.result.updatedAt } : {}),
    ...(input.result.error !== undefined ? { error: input.result.error } : {}),
  };
}

/**
 * Resolve MCP servers for the current provider/project.
 *
 * Claude is backed by a shared project-scoped live SDK status cache; Codex and
 * Gemini continue to use their filesystem/config readers.
 */
export function useMcpServers(input: {
  readonly provider: ProviderKind | undefined;
  readonly projectId: ProjectId | undefined;
  readonly cwd: string | undefined;
  readonly refreshKey?: string | null | undefined;
}): ResolvedMcpServersState {
  const { provider, projectId, cwd, refreshKey } = input;
  const isClaude = provider ? baseProviderKind(provider) === "claudeAgent" : false;
  const snapshot = useMcpStatusSnapshot(
    isClaude ? projectId : undefined,
    isClaude ? cwd : undefined,
    isClaude ? provider : undefined,
  );
  const [revisionNonce, setRevisionNonce] = useState(0);
  const [plainState, setPlainState] = useState<ResolvedMcpServersState>(() =>
    emptyState(() => undefined),
  );
  const lastForcedRevisionNonce = useRef(0);
  const revision = useMcpConfigRevision();
  const statusInvalidationRevision = useMcpStatusInvalidationRevision();

  const retry = useCallback(() => {
    setRevisionNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!provider || !cwd) {
      setPlainState(emptyState(retry));
      return;
    }
    if (isClaude && !projectId) {
      setPlainState({
        status: "error",
        refreshing: false,
        serverNames: EMPTY,
        servers: EMPTY_SERVERS,
        error: "Claude MCP status requires a project.",
        retry,
      });
      return;
    }
    const api = readNativeApi();
    if (!api) {
      setPlainState(emptyState(retry));
      return;
    }

    let cancelled = false;
    const forceRefresh = revisionNonce > 0 && lastForcedRevisionNonce.current !== revisionNonce;
    if (forceRefresh) {
      lastForcedRevisionNonce.current = revisionNonce;
    }
    api.server
      .resolveMcpServers({
        provider: asProviderInput(provider),
        ...(projectId ? { projectId } : {}),
        cwd,
        ...(forceRefresh ? { forceRefresh: true } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        if (isClaude) {
          const selectedSnapshot = selectedClaudeSnapshot({
            provider,
            projectId,
            cwd,
            result,
          });
          applyMcpStatusSnapshots(
            result.profiles ? [...result.profiles, selectedSnapshot] : [selectedSnapshot],
          );
          return;
        }
        setPlainState({
          status: result.status,
          refreshing: result.refreshing === true,
          serverNames: result.serverNames.length > 0 ? result.serverNames : EMPTY,
          servers: result.servers && result.servers.length > 0 ? result.servers : EMPTY_SERVERS,
          error: result.error ?? null,
          retry,
        });
      })
      .catch((error) => {
        console.error("[useMcpServers] RPC failed:", error);
        if (!cancelled) {
          if (isClaude && provider && projectId && cwd) {
            applyMcpStatusSnapshots([
              {
                provider,
                projectId,
                cwd,
                status: "error",
                serverNames: EMPTY,
                error: error instanceof Error ? error.message : String(error),
              },
            ]);
            return;
          }
          setPlainState({
            status: "error",
            refreshing: false,
            serverNames: EMPTY,
            servers: EMPTY_SERVERS,
            error: error instanceof Error ? error.message : String(error),
            retry,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    provider,
    projectId,
    cwd,
    isClaude,
    revision,
    statusInvalidationRevision,
    refreshKey,
    revisionNonce,
    retry,
  ]);

  return useMemo(() => {
    if (!isClaude) {
      return plainState;
    }
    if (!provider || !projectId || !cwd) {
      return emptyState(retry);
    }
    if (!snapshot) {
      return {
        status: "loading",
        refreshing: false,
        serverNames: EMPTY,
        servers: EMPTY_SERVERS,
        error: null,
        retry,
      };
    }
    return {
      status: snapshot.status,
      refreshing: snapshot.refreshing === true,
      serverNames: snapshot.serverNames.length > 0 ? snapshot.serverNames : EMPTY,
      servers: snapshot.servers && snapshot.servers.length > 0 ? snapshot.servers : EMPTY_SERVERS,
      error: snapshot.error ?? null,
      retry,
    };
  }, [isClaude, plainState, provider, projectId, cwd, retry, snapshot]);
}

export function useMcpServerNames(
  provider: ProviderKind | undefined,
  cwd: string | undefined,
): readonly string[] {
  return useMcpServers({ provider, projectId: undefined, cwd }).serverNames;
}
