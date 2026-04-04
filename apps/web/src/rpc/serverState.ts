import { useAtomSubscribe, useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EditorId,
  type ProviderKind,
  type ProviderRateLimitsSnapshot,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerConfigUpdatedPayload,
  type ServerLifecycleWelcomePayload,
  type ServerProvider,
  type ServerProviderUpdatedPayload,
  type ServerSettings,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { WsRpcClient } from "../wsRpcClient";
import { appAtomRegistry, resetAppAtomRegistryForTests } from "./atomRegistry";

export type ServerConfigUpdateSource = ServerConfigStreamEvent["type"];

export interface ServerConfigUpdatedNotification {
  readonly id: number;
  readonly payload: ServerConfigUpdatedPayload;
  readonly source: ServerConfigUpdateSource;
}

type ServerStateClient = Pick<
  WsRpcClient["server"],
  "getConfig" | "subscribeConfig" | "subscribeLifecycle"
>;

function makeStateAtom<A>(label: string, initialValue: A) {
  return Atom.make(initialValue).pipe(Atom.keepAlive, Atom.withLabel(label));
}

function toServerConfigUpdatedPayload(config: ServerConfig): ServerConfigUpdatedPayload {
  return {
    issues: config.issues,
    providers: config.providers,
    settings: config.settings,
  };
}

const EMPTY_AVAILABLE_EDITORS: ReadonlyArray<EditorId> = [];
const EMPTY_KEYBINDINGS: ServerConfig["keybindings"] = [];
const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];

const selectAvailableEditors = (config: ServerConfig | null): ReadonlyArray<EditorId> =>
  config?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;
const selectKeybindings = (config: ServerConfig | null) => config?.keybindings ?? EMPTY_KEYBINDINGS;
const selectKeybindingsConfigPath = (config: ServerConfig | null) =>
  config?.keybindingsConfigPath ?? null;
const selectObservability = (config: ServerConfig | null) => config?.observability ?? null;
const selectProviders = (config: ServerConfig | null) =>
  config?.providers ?? EMPTY_SERVER_PROVIDERS;
const selectSettings = (config: ServerConfig | null): ServerSettings =>
  config?.settings ?? DEFAULT_SERVER_SETTINGS;

export const welcomeAtom = makeStateAtom<ServerLifecycleWelcomePayload | null>(
  "server-welcome",
  null,
);
export const serverConfigAtom = makeStateAtom<ServerConfig | null>("server-config", null);
export const serverConfigUpdatedAtom = makeStateAtom<ServerConfigUpdatedNotification | null>(
  "server-config-updated",
  null,
);
export const providersUpdatedAtom = makeStateAtom<ServerProviderUpdatedPayload | null>(
  "server-providers-updated",
  null,
);
export const providerRateLimitsAtom = makeStateAtom<ReadonlyArray<ProviderRateLimitsSnapshot>>(
  "provider-rate-limits",
  [],
);

export function getServerConfig(): ServerConfig | null {
  return appAtomRegistry.get(serverConfigAtom);
}

export function getServerConfigUpdatedNotification(): ServerConfigUpdatedNotification | null {
  return appAtomRegistry.get(serverConfigUpdatedAtom);
}

export function setServerConfigSnapshot(config: ServerConfig): void {
  resolveServerConfig(config);
  emitProvidersUpdated({ providers: config.providers });
  emitServerConfigUpdated(toServerConfigUpdatedPayload(config), "snapshot");
}

export function applyServerConfigEvent(event: ServerConfigStreamEvent): void {
  switch (event.type) {
    case "snapshot": {
      setServerConfigSnapshot(event.config);
      return;
    }
    case "keybindingsUpdated": {
      const latestServerConfig = getServerConfig();
      if (!latestServerConfig) {
        return;
      }
      const nextConfig = {
        ...latestServerConfig,
        issues: event.payload.issues,
      } satisfies ServerConfig;
      resolveServerConfig(nextConfig);
      emitServerConfigUpdated(toServerConfigUpdatedPayload(nextConfig), event.type);
      return;
    }
    case "providerStatuses": {
      applyProvidersUpdated(event.payload);
      return;
    }
    case "settingsUpdated": {
      applySettingsUpdated(event.payload.settings);
      return;
    }
    case "mcpConfigChanged": {
      mcpConfigRevision++;
      for (const listener of mcpConfigRevisionListeners) {
        listener();
      }
      return;
    }
    case "rateLimitsUpdated": {
      appAtomRegistry.set(providerRateLimitsAtom, event.payload.rateLimits);
      return;
    }
  }
}

export function applyProvidersUpdated(payload: ServerProviderUpdatedPayload): void {
  const latestServerConfig = getServerConfig();
  emitProvidersUpdated(payload);

  if (!latestServerConfig) {
    return;
  }

  const nextConfig = {
    ...latestServerConfig,
    providers: payload.providers,
  } satisfies ServerConfig;
  resolveServerConfig(nextConfig);
  emitServerConfigUpdated(toServerConfigUpdatedPayload(nextConfig), "providerStatuses");
}

export function applySettingsUpdated(settings: ServerSettings): void {
  const latestServerConfig = getServerConfig();
  if (!latestServerConfig) {
    return;
  }

  const nextConfig = {
    ...latestServerConfig,
    settings,
  } satisfies ServerConfig;
  resolveServerConfig(nextConfig);
  emitServerConfigUpdated(toServerConfigUpdatedPayload(nextConfig), "settingsUpdated");
}

export function emitWelcome(payload: ServerLifecycleWelcomePayload): void {
  appAtomRegistry.set(welcomeAtom, payload);
}

export function onWelcome(listener: (payload: ServerLifecycleWelcomePayload) => void): () => void {
  return subscribeLatest(welcomeAtom, listener);
}

export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload, source: ServerConfigUpdateSource) => void,
): () => void {
  return subscribeLatest(serverConfigUpdatedAtom, (notification) => {
    listener(notification.payload, notification.source);
  });
}

export function onProvidersUpdated(
  listener: (payload: ServerProviderUpdatedPayload) => void,
): () => void {
  return subscribeLatest(providersUpdatedAtom, listener);
}

export function startServerStateSync(client: ServerStateClient): () => void {
  let disposed = false;
  const cleanups = [
    client.subscribeLifecycle((event) => {
      if (event.type === "welcome") {
        emitWelcome(event.payload);
      }
    }),
    client.subscribeConfig((event) => {
      applyServerConfigEvent(event);
    }),
  ];

  if (getServerConfig() === null) {
    void client
      .getConfig()
      .then((config) => {
        if (disposed || getServerConfig() !== null) {
          return;
        }
        setServerConfigSnapshot(config);
      })
      .catch(() => undefined);
  }

  return () => {
    disposed = true;
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

export function resetServerStateForTests() {
  resetAppAtomRegistryForTests();
  nextServerConfigUpdatedNotificationId = 1;
}

let nextServerConfigUpdatedNotificationId = 1;

// ---------------------------------------------------------------------------
// MCP config revision counter — incremented when the server signals that MCP
// config files changed on disk.  The `useMcpConfigRevision` hook lets
// components re-fetch MCP data reactively.
// ---------------------------------------------------------------------------
let mcpConfigRevision = 0;
const mcpConfigRevisionListeners = new Set<() => void>();

function subscribeMcpConfigRevision(listener: () => void): () => void {
  mcpConfigRevisionListeners.add(listener);
  return () => {
    mcpConfigRevisionListeners.delete(listener);
  };
}

function getMcpConfigRevisionSnapshot(): number {
  return mcpConfigRevision;
}

export function useMcpConfigRevision(): number {
  return useSyncExternalStore(subscribeMcpConfigRevision, getMcpConfigRevisionSnapshot);
}

function resolveServerConfig(config: ServerConfig): void {
  appAtomRegistry.set(serverConfigAtom, config);
}

function emitProvidersUpdated(payload: ServerProviderUpdatedPayload): void {
  appAtomRegistry.set(providersUpdatedAtom, payload);
}

function emitServerConfigUpdated(
  payload: ServerConfigUpdatedPayload,
  source: ServerConfigUpdateSource,
): void {
  appAtomRegistry.set(serverConfigUpdatedAtom, {
    id: nextServerConfigUpdatedNotificationId++,
    payload,
    source,
  });
}

function subscribeLatest<A>(
  atom: Atom.Atom<A | null>,
  listener: (value: NonNullable<A>) => void,
): () => void {
  return appAtomRegistry.subscribe(
    atom,
    (value) => {
      if (value === null) {
        return;
      }
      listener(value as NonNullable<A>);
    },
    { immediate: true },
  );
}

function useLatestAtomSubscription<A>(
  atom: Atom.Atom<A | null>,
  listener: (value: NonNullable<A>) => void,
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  const stableListener = useCallback((value: A | null) => {
    if (value === null) {
      return;
    }
    listenerRef.current(value as NonNullable<A>);
  }, []);

  useAtomSubscribe(atom, stableListener, { immediate: true });
}

export function useServerConfig(): ServerConfig | null {
  return useAtomValue(serverConfigAtom);
}

export function useServerSettings(): ServerSettings {
  return useAtomValue(serverConfigAtom, selectSettings);
}

export function useServerProviders(): ReadonlyArray<ServerProvider> {
  return useAtomValue(serverConfigAtom, selectProviders);
}

export function useServerKeybindings(): ServerConfig["keybindings"] {
  return useAtomValue(serverConfigAtom, selectKeybindings);
}

export function useServerAvailableEditors(): ReadonlyArray<EditorId> {
  return useAtomValue(serverConfigAtom, selectAvailableEditors);
}

export function useServerKeybindingsConfigPath(): string | null {
  return useAtomValue(serverConfigAtom, selectKeybindingsConfigPath);
}

export function useServerObservability(): ServerConfig["observability"] | null {
  return useAtomValue(serverConfigAtom, selectObservability);
}

export function useServerWelcomeSubscription(
  listener: (payload: ServerLifecycleWelcomePayload) => void,
): void {
  useLatestAtomSubscription(welcomeAtom, listener);
}

export function useServerConfigUpdatedSubscription(
  listener: (notification: ServerConfigUpdatedNotification) => void,
): void {
  useLatestAtomSubscription(serverConfigUpdatedAtom, listener);
}

// ---------------------------------------------------------------------------
// Provider rate-limits
// ---------------------------------------------------------------------------

const EMPTY_RATE_LIMITS: ReadonlyArray<ProviderRateLimitsSnapshot> = [];

export function useProviderRateLimits(): ReadonlyArray<ProviderRateLimitsSnapshot> {
  return useAtomValue(providerRateLimitsAtom) ?? EMPTY_RATE_LIMITS;
}

export function useProviderRateLimit(
  provider: ProviderKind | null,
): ProviderRateLimitsSnapshot | null {
  const all = useProviderRateLimits();
  return useMemo(() => {
    if (!provider) return null;
    return all.find((entry) => entry.provider === provider) ?? null;
  }, [all, provider]);
}
