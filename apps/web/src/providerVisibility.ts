import type { ServerProvider } from "@t3tools/contracts";

export function isHiddenCursorProfileProvider(
  provider: Pick<ServerProvider, "provider"> | string,
): boolean {
  const providerKind = typeof provider === "string" ? provider : provider.provider;
  return providerKind.startsWith("cursor:");
}

export function isUserVisibleProvider(provider: Pick<ServerProvider, "provider">): boolean {
  return !isHiddenCursorProfileProvider(provider);
}
