import { Effect } from "effect";
import {
  baseProviderKind,
  type ProviderKind,
  type ResolveProviderCapabilitiesInput,
} from "@t3tools/contracts";

import { resolveCodexProviderCapabilities } from "./codexCapabilities";

export const resolveProviderCapabilities = Effect.fn("resolveProviderCapabilities")(function* (
  input: ResolveProviderCapabilitiesInput & {
    binaryPathByProvider: Partial<Record<ProviderKind, string>>;
    homePathByProvider: Partial<Record<ProviderKind, string | undefined>>;
  },
) {
  if (baseProviderKind(input.provider) !== "codex") {
    return { capabilities: [] };
  }
  const binaryPath = input.binaryPathByProvider[input.provider] ?? input.binaryPathByProvider.codex;
  if (!binaryPath) return { capabilities: [] };
  const homePath = input.homePathByProvider[input.provider] ?? input.homePathByProvider.codex;
  return yield* resolveCodexProviderCapabilities({
    provider: input.provider,
    cwd: input.cwd,
    binaryPath,
    ...(homePath ? { homePath } : {}),
  });
});
