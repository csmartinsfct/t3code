import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as nodePath from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { Data, Effect, Layer, ServiceMap } from "effect";

import { ServerConfig } from "../config.ts";
import type { BrowserHost, BrowserHostToolName } from "./BrowserHost.ts";
import type { CdpBroker } from "./CdpBroker.ts";
import { ElectronWebContentsBrowserHost } from "./hosts/ElectronWebContentsHost/browserHost.ts";
import {
  PlaywrightBrowserHost,
  type PlaywrightCommandDescriptor,
} from "./hosts/PlaywrightHost/PlaywrightBrowserHost.ts";
import type { BrowserManagerServiceShape } from "./Services/BrowserManager.ts";
import { BrowserManagerService } from "./Services/BrowserManager.ts";

export type PersistedBrowserHostKind = "playwright" | "electron";

interface HostJson {
  readonly host: PersistedBrowserHostKind;
}

interface ResolverState {
  readonly persisted: Map<ProjectId, PersistedBrowserHostKind>;
  readonly announcedElectronProjects: Set<ProjectId>;
  readonly reannounceInProgress: boolean;
  // @ref maps, snapshot/console/network/dialog buffers, tab registry, and CDP
  // subscription iterators all live on the host instance. Memoize per project
  // so refs survive between HTTP requests and subscriptions don't leak. See
  // T3CO-350 for the full list of state that would otherwise be lost.
  readonly electronHosts: Map<ProjectId, ElectronWebContentsBrowserHost>;
}

export class BrowserHostResolverError extends Data.TaggedError("BrowserHostResolverError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface BrowserHostResolverShape {
  readonly get: (projectId: ProjectId) => Effect.Effect<BrowserHost, BrowserHostResolverError>;
  readonly persistElectronHost: (
    projectId: ProjectId,
  ) => Effect.Effect<void, BrowserHostResolverError>;
  readonly announceElectronHosts: (
    projectIds: readonly ProjectId[],
  ) => Effect.Effect<void, BrowserHostResolverError>;
  readonly beginRestartRecovery: () => Effect.Effect<void, never>;
  readonly completeRestartRecovery: (
    projectIds: readonly ProjectId[],
  ) => Effect.Effect<void, BrowserHostResolverError>;
  readonly dispose: () => Effect.Effect<void, never>;
}

export class BrowserHostResolver extends ServiceMap.Service<
  BrowserHostResolver,
  BrowserHostResolverShape
>()("t3/browser/BrowserHostResolver") {}

function hostRoot(stateDir: string): string {
  return nodePath.join(stateDir, "browser");
}

function hostJsonPath(stateDir: string, projectId: ProjectId): string {
  return nodePath.join(hostRoot(stateDir), projectId, "host.json");
}

function parseHostJson(raw: string): PersistedBrowserHostKind | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<HostJson>;
    return parsed.host === "electron" || parsed.host === "playwright" ? parsed.host : undefined;
  } catch {
    return undefined;
  }
}

async function readPersistedHosts(
  stateDir: string,
): Promise<Map<ProjectId, PersistedBrowserHostKind>> {
  const root = hostRoot(stateDir);
  const hosts = new Map<ProjectId, PersistedBrowserHostKind>();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return hosts;
    throw err;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const projectId = ProjectId.makeUnsafe(entry.name);
        try {
          const host = parseHostJson(await fs.readFile(hostJsonPath(stateDir, projectId), "utf8"));
          if (host) hosts.set(projectId, host);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }),
  );
  return hosts;
}

async function readPersistedHost(
  stateDir: string,
  projectId: ProjectId,
): Promise<PersistedBrowserHostKind | undefined> {
  try {
    return parseHostJson(await fs.readFile(hostJsonPath(stateDir, projectId), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeHostJson(
  stateDir: string,
  projectId: ProjectId,
  host: PersistedBrowserHostKind,
): Promise<void> {
  const file = hostJsonPath(stateDir, projectId);
  await fs.mkdir(nodePath.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ host } satisfies HostJson, null, 2)}\n`, "utf8");
}

interface CreateBrowserHostResolverOptions {
  readonly stateDir: string;
  readonly browser: BrowserManagerServiceShape;
  readonly descriptors: ReadonlyMap<BrowserHostToolName, PlaywrightCommandDescriptor>;
  readonly electronBroker?: CdpBroker;
  readonly electronBrokerCacheKey?: string;
}

export async function createBrowserHostResolver({
  stateDir,
  browser,
  descriptors,
  electronBroker,
}: CreateBrowserHostResolverOptions): Promise<BrowserHostResolverShape> {
  const persisted = await readPersistedHosts(stateDir);
  let state: ResolverState = {
    persisted,
    announcedElectronProjects: new Set<ProjectId>(),
    reannounceInProgress: Array.from(persisted.values()).some((host) => host === "electron"),
    electronHosts: new Map<ProjectId, ElectronWebContentsBrowserHost>(),
  };

  const updateState = (f: (current: ResolverState) => ResolverState): void => {
    state = f(state);
  };

  const makePlaywrightHost = (projectId: ProjectId) =>
    new PlaywrightBrowserHost(projectId, browser, descriptors) as unknown as BrowserHost;

  const electronHostOptions = electronBroker === undefined ? undefined : { broker: electronBroker };

  const get: BrowserHostResolverShape["get"] = (projectId) =>
    Effect.tryPromise({
      try: async () => {
        let persisted = state.persisted.get(projectId);
        if (!persisted) {
          persisted = await readPersistedHost(stateDir, projectId);
          if (persisted) {
            const persistedHost = persisted;
            updateState((current) => {
              const nextPersisted = new Map(current.persisted);
              nextPersisted.set(projectId, persistedHost);
              return { ...current, persisted: nextPersisted };
            });
          }
        }
        if (persisted !== "electron") return makePlaywrightHost(projectId);

        if (
          !electronBroker &&
          state.reannounceInProgress &&
          !state.announcedElectronProjects.has(projectId)
        ) {
          throw new BrowserHostResolverError({
            message:
              "Embedded browser host is recovering after a server restart; retry once the desktop process re-announces active browser views.",
          });
        }
        const cached = state.electronHosts.get(projectId);
        if (cached) return cached as unknown as BrowserHost;
        const host = new ElectronWebContentsBrowserHost(projectId, electronHostOptions);
        updateState((current) => {
          const electronHosts = new Map(current.electronHosts);
          electronHosts.set(projectId, host);
          return { ...current, electronHosts };
        });
        return host as unknown as BrowserHost;
      },
      catch: (cause) =>
        cause instanceof BrowserHostResolverError
          ? cause
          : new BrowserHostResolverError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
    });

  const persistElectronHost: BrowserHostResolverShape["persistElectronHost"] = (projectId) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => writeHostJson(stateDir, projectId, "electron"),
        catch: (cause) =>
          new BrowserHostResolverError({
            message: `failed to persist Electron browser host for ${projectId}: ${String(cause)}`,
            cause,
          }),
      });
      updateState((current) => {
        const persisted = new Map(current.persisted);
        persisted.set(projectId, "electron");
        const announcedElectronProjects = new Set(current.announcedElectronProjects);
        announcedElectronProjects.add(projectId);
        return { ...current, persisted, announcedElectronProjects };
      });
    });

  const announceElectronHosts: BrowserHostResolverShape["announceElectronHosts"] = (projectIds) =>
    Effect.sync(() => {
      updateState((current) => {
        const announcedElectronProjects = new Set(current.announcedElectronProjects);
        const persisted = new Map(current.persisted);
        for (const projectId of projectIds) {
          announcedElectronProjects.add(projectId);
          persisted.set(projectId, "electron");
        }
        return { ...current, persisted, announcedElectronProjects };
      });
    });

  const beginRestartRecovery = () =>
    Effect.sync(() => {
      updateState((current) => ({
        ...current,
        announcedElectronProjects: new Set<ProjectId>(),
        reannounceInProgress: true,
      }));
    });

  const completeRestartRecovery: BrowserHostResolverShape["completeRestartRecovery"] = (
    projectIds,
  ) =>
    Effect.gen(function* () {
      yield* announceElectronHosts(projectIds);
      yield* Effect.sync(() => {
        updateState((current) => ({ ...current, reannounceInProgress: false }));
      });
    });

  const dispose: BrowserHostResolverShape["dispose"] = () =>
    Effect.promise(async () => {
      const hosts = Array.from(state.electronHosts.values());
      updateState((current) => ({ ...current, electronHosts: new Map() }));
      await Promise.allSettled(hosts.map((host) => host.dispose()));
    });

  return {
    get,
    persistElectronHost,
    announceElectronHosts,
    beginRestartRecovery,
    completeRestartRecovery,
    dispose,
  } satisfies BrowserHostResolverShape;
}

const cachedResolvers = new Map<string, Promise<BrowserHostResolverShape>>();

export function getCachedBrowserHostResolver(
  options: CreateBrowserHostResolverOptions,
): Promise<BrowserHostResolverShape> {
  const cacheKey = `${options.stateDir}\0${options.electronBrokerCacheKey ?? "no-electron-broker"}`;
  const existing = cachedResolvers.get(cacheKey);
  if (existing) return existing;

  // Broker URL/token cycle: a new entry for the same stateDir under a
  // different key supersedes the old one. Dispose the old resolver so its
  // cached Electron hosts close their CDP subscriptions instead of leaking.
  const stateDirPrefix = `${options.stateDir}\0`;
  for (const [staleKey, stalePromise] of cachedResolvers) {
    if (staleKey === cacheKey) continue;
    if (!staleKey.startsWith(stateDirPrefix)) continue;
    cachedResolvers.delete(staleKey);
    void stalePromise
      .then((resolver) => Effect.runPromise(resolver.dispose()))
      .catch(() => undefined);
  }

  const resolver = createBrowserHostResolver(options).catch((cause: unknown) => {
    cachedResolvers.delete(cacheKey);
    throw cause;
  });
  cachedResolvers.set(cacheKey, resolver);
  return resolver;
}

export function makeBrowserHostResolverLive(
  descriptors: ReadonlyMap<BrowserHostToolName, PlaywrightCommandDescriptor>,
) {
  return Layer.effect(
    BrowserHostResolver,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const browser = yield* BrowserManagerService;
      return yield* Effect.tryPromise({
        try: () =>
          createBrowserHostResolver({
            stateDir: config.stateDir,
            browser,
            descriptors,
          }),
        catch: (cause) =>
          new BrowserHostResolverError({
            message: `failed to create browser host resolver: ${String(cause)}`,
            cause,
          }),
      });
    }),
  );
}
