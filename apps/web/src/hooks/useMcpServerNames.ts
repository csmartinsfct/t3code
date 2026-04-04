import { asProviderInput, type ProviderKind } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { readNativeApi } from "../nativeApi";
import { useMcpConfigRevision } from "../rpc/serverState";

const EMPTY: readonly string[] = [];

/**
 * Resolve the MCP server names that should be available for a given provider
 * and working directory.  Calls the `server.resolveMcpServers` RPC and caches
 * results keyed on `(provider, cwd)`.
 *
 * Re-fetches automatically when the server signals that MCP config files
 * changed on disk (via the `mcpConfigRevision` counter).
 */
export function useMcpServerNames(
  provider: ProviderKind | undefined,
  cwd: string | undefined,
): readonly string[] {
  const [serverNames, setServerNames] = useState<readonly string[]>(EMPTY);
  const revision = useMcpConfigRevision();

  useEffect(() => {
    if (!provider) {
      setServerNames(EMPTY);
      return;
    }
    const api = readNativeApi();
    if (!api) {
      setServerNames(EMPTY);
      return;
    }
    let cancelled = false;
    api.server
      .resolveMcpServers({ provider: asProviderInput(provider), ...(cwd ? { cwd } : {}) })
      .then((result) => {
        if (!cancelled) setServerNames(result.serverNames.length > 0 ? result.serverNames : EMPTY);
      })
      .catch((error) => {
        console.error("[useMcpServerNames] RPC failed:", error);
        if (!cancelled) setServerNames(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, cwd, revision]);

  return serverNames;
}
