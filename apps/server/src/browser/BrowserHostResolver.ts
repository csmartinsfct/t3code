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

interface ResolverState {
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
  readonly dispose: () => Effect.Effect<void, never>;
}

export class BrowserHostResolver extends ServiceMap.Service<
  BrowserHostResolver,
  BrowserHostResolverShape
>()("t3/browser/BrowserHostResolver") {}

interface CreateBrowserHostResolverOptions {
  // stateDir is unused by the resolver itself but kept on the options shape so
  // getCachedBrowserHostResolver can scope its cache per data dir (broker
  // URL/token rotation invalidates per stateDir).
  readonly stateDir: string;
  readonly browser: BrowserManagerServiceShape;
  readonly descriptors: ReadonlyMap<BrowserHostToolName, PlaywrightCommandDescriptor>;
  readonly electronBroker?: CdpBroker;
  readonly electronBrokerCacheKey?: string;
}

export async function createBrowserHostResolver({
  browser,
  descriptors,
  electronBroker,
}: CreateBrowserHostResolverOptions): Promise<BrowserHostResolverShape> {
  let state: ResolverState = {
    electronHosts: new Map<ProjectId, ElectronWebContentsBrowserHost>(),
  };

  const updateState = (f: (current: ResolverState) => ResolverState): void => {
    state = f(state);
  };

  const makePlaywrightHost = (projectId: ProjectId) =>
    new PlaywrightBrowserHost(projectId, browser, descriptors) as unknown as BrowserHost;

  const electronHostOptions = electronBroker === undefined ? undefined : { broker: electronBroker };

  // Always-on per project (T3CO-421): in desktop builds (electronBroker
  // defined) every project resolves to the Electron WebContentsView host. The
  // host is created lazily on first access and memoized for the life of the
  // resolver so @ref maps, snapshot/console buffers, and CDP subscriptions
  // survive between HTTP requests. In server-only builds the resolver returns
  // a fresh PlaywrightBrowserHost — no disk persistence, no recovery state.
  const get: BrowserHostResolverShape["get"] = (projectId) =>
    Effect.try({
      try: (): BrowserHost => {
        if (electronBroker === undefined) return makePlaywrightHost(projectId);
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
        new BrowserHostResolverError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

  const dispose: BrowserHostResolverShape["dispose"] = () =>
    Effect.promise(async () => {
      const hosts = Array.from(state.electronHosts.values());
      updateState((current) => ({ ...current, electronHosts: new Map() }));
      await Promise.allSettled(hosts.map((host) => host.dispose()));
    });

  return {
    get,
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
