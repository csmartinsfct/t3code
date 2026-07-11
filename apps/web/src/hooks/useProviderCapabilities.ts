import { useEffect, useRef, useState } from "react";

import {
  baseProviderKind,
  type ProviderCapabilityEntry,
  type ProviderKind,
} from "@t3tools/contracts";
import { readNativeApi } from "../nativeApi";

const EMPTY: readonly ProviderCapabilityEntry[] = [];
const POLL_INTERVAL_MS = 5_000;

export function useProviderCapabilities(input: {
  provider: ProviderKind | undefined;
  cwd: string | undefined;
}): readonly ProviderCapabilityEntry[] {
  const [capabilities, setCapabilities] = useState<readonly ProviderCapabilityEntry[]>(EMPTY);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!input.provider || !input.cwd) {
      setCapabilities(EMPTY);
      return;
    }

    let cancelled = false;
    const fetchCapabilities = () => {
      const api = readNativeApi();
      if (!api || cancelled) return;
      api.server
        .resolveProviderCapabilities({
          provider: baseProviderKind(input.provider!),
          cwd: input.cwd!,
        })
        .then((result) => {
          if (!cancelled) setCapabilities(result.capabilities);
        })
        .catch((error) => {
          console.error("[useProviderCapabilities] RPC failed:", error);
          if (!cancelled) setCapabilities(EMPTY);
        });
    };

    fetchCapabilities();
    intervalRef.current = setInterval(fetchCapabilities, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [input.provider, input.cwd]);

  return capabilities;
}
