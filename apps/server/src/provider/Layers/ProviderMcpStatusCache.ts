/**
 * ProviderMcpStatusCacheLive - In-memory project-scoped MCP status cache.
 *
 * @module ProviderMcpStatusCacheLive
 */
import {
  baseProviderKind,
  makeProviderKind,
  type ProjectId,
  type ProviderKind,
  type ResolvedMcpProviderSnapshot,
} from "@t3tools/contracts";
import { Effect, Layer, Option, PubSub, Ref, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import {
  ProviderMcpStatusCache,
  type ProviderMcpStatusCacheShape,
} from "../Services/ProviderMcpStatusCache.ts";
import { discoverClaudeProfiles } from "../claudeProfileDiscovery.ts";

const CACHE_TTL_MS = 30_000;
const PROFILE_PROBE_TIMEOUT_MS = 15_000;
const PROFILE_PROBE_CONCURRENCY = 2;

const projectCacheKey = (projectId: ProjectId, cwd: string): string => `${projectId}\0${cwd}`;
const snapshotCacheKey = (projectId: ProjectId, cwd: string, provider: ProviderKind): string =>
  `${projectCacheKey(projectId, cwd)}\0${provider}`;

function isFresh(snapshot: ResolvedMcpProviderSnapshot, now = Date.now()): boolean {
  if (snapshot.status === "loading" || snapshot.status === "error" || snapshot.refreshing)
    return false;
  if (!snapshot.updatedAt) return false;
  return now - Date.parse(snapshot.updatedAt) < CACHE_TTL_MS;
}

function snapshotArray(
  map: Map<string, ResolvedMcpProviderSnapshot>,
): ReadonlyArray<ResolvedMcpProviderSnapshot> {
  return Array.from(map.values()).toSorted(
    (left, right) =>
      String(left.projectId ?? "").localeCompare(String(right.projectId ?? "")) ||
      String(left.cwd ?? "").localeCompare(String(right.cwd ?? "")) ||
      left.provider.localeCompare(right.provider),
  );
}

function projectSnapshots(
  map: Map<string, ResolvedMcpProviderSnapshot>,
  projectId: ProjectId,
  cwd: string,
): ReadonlyArray<ResolvedMcpProviderSnapshot> {
  const prefix = `${projectCacheKey(projectId, cwd)}\0`;
  return Array.from(map.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, snapshot]) => snapshot)
    .toSorted((left, right) => left.provider.localeCompare(right.provider));
}

function selectedSnapshot(input: {
  readonly snapshots: ReadonlyArray<ResolvedMcpProviderSnapshot>;
  readonly selectedProvider: ProviderKind;
  readonly projectId: ProjectId;
  readonly cwd: string;
}): ResolvedMcpProviderSnapshot {
  return (
    input.snapshots.find((snapshot) => snapshot.provider === input.selectedProvider) ?? {
      provider: input.selectedProvider,
      projectId: input.projectId,
      cwd: input.cwd,
      status: "error",
      serverNames: [],
      error: `Claude provider '${input.selectedProvider}' is not enabled.`,
      updatedAt: new Date().toISOString(),
    }
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const ProviderMcpStatusCacheLive = Layer.effect(
  ProviderMcpStatusCache,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const serverSettings = yield* ServerSettingsService;
    const snapshotsRef = yield* Ref.make<Map<string, ResolvedMcpProviderSnapshot>>(new Map());
    const inFlightProjectsRef = yield* Ref.make<Set<string>>(new Set());
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ResolvedMcpProviderSnapshot>>(),
      PubSub.shutdown,
    );

    const publish = Effect.gen(function* () {
      const snapshots = yield* Ref.get(snapshotsRef).pipe(Effect.map(snapshotArray));
      yield* PubSub.publish(changesPubSub, snapshots);
    });

    const enabledClaudeProviders = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const configuredProfiles = settings.providers.claudeProfiles;
      const configuredProfileIds = new Set(configuredProfiles.map((profile) => profile.profileId));
      const discoveredProfiles = yield* discoverClaudeProfiles();
      const providers: ProviderKind[] = [];

      if (settings.providers.claudeAgent.enabled) {
        providers.push("claudeAgent");
      }

      for (const profile of configuredProfiles) {
        if (profile.enabled) {
          providers.push(makeProviderKind("claudeAgent", profile.profileId));
        }
      }

      for (const profile of discoveredProfiles) {
        if (!configuredProfileIds.has(profile.profileId)) {
          providers.push(profile.providerKind);
        }
      }

      return Array.from(new Set(providers));
    }).pipe(
      Effect.tapError(Effect.logError),
      Effect.orElseSucceed(() => []),
    );

    const writeProjectSnapshots = (input: {
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly providers: ReadonlyArray<ProviderKind>;
      readonly makeSnapshot: (
        provider: ProviderKind,
        existing: ResolvedMcpProviderSnapshot | undefined,
      ) => ResolvedMcpProviderSnapshot;
    }) =>
      Ref.update(snapshotsRef, (map) => {
        const next = new Map(map);
        const projectKey = projectCacheKey(input.projectId, input.cwd);
        for (const key of Array.from(next.keys())) {
          if (key.startsWith(`${projectKey}\0`)) {
            const provider = key.slice(projectKey.length + 1) as ProviderKind;
            if (!input.providers.includes(provider)) {
              next.delete(key);
            }
          }
        }
        for (const provider of input.providers) {
          const key = snapshotCacheKey(input.projectId, input.cwd, provider);
          next.set(key, input.makeSnapshot(provider, next.get(key)));
        }
        return next;
      });

    const setProfileSnapshot = (snapshot: ResolvedMcpProviderSnapshot) =>
      Ref.update(snapshotsRef, (map) => {
        if (!snapshot.projectId || !snapshot.cwd) return map;
        const next = new Map(map);
        next.set(snapshotCacheKey(snapshot.projectId, snapshot.cwd, snapshot.provider), snapshot);
        return next;
      }).pipe(Effect.andThen(publish));

    const setProfileError = (input: {
      readonly provider: ProviderKind;
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly error: string;
    }) =>
      Ref.update(snapshotsRef, (map) => {
        const next = new Map(map);
        const key = snapshotCacheKey(input.projectId, input.cwd, input.provider);
        const existing = next.get(key);
        const hasSettledSnapshot = existing?.updatedAt !== undefined;
        next.set(key, {
          provider: input.provider,
          projectId: input.projectId,
          cwd: input.cwd,
          status: "error",
          serverNames: hasSettledSnapshot ? existing.serverNames : [],
          servers: hasSettledSnapshot ? (existing.servers ?? []) : [],
          updatedAt: hasSettledSnapshot ? existing.updatedAt : new Date().toISOString(),
          error: input.error,
        });
        return next;
      }).pipe(Effect.andThen(publish));

    const finishProjectRefresh = (projectId: ProjectId, cwd: string) =>
      Ref.update(snapshotsRef, (map) => {
        const next = new Map(map);
        for (const snapshot of projectSnapshots(next, projectId, cwd)) {
          if (!snapshot.refreshing) continue;
          const { refreshing: _refreshing, ...rest } = snapshot;
          next.set(snapshotCacheKey(projectId, cwd, snapshot.provider), {
            ...rest,
          });
        }
        return next;
      }).pipe(Effect.andThen(publish));

    const refreshProject = (input: {
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly providers: ReadonlyArray<ProviderKind>;
      readonly reloadPlugins?: boolean;
    }) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          input.providers,
          (provider) =>
            Effect.gen(function* () {
              const result = yield* (
                providerService.probeMcpServers
                  ? providerService.probeMcpServers({
                      provider,
                      cwd: input.cwd,
                      ...(input.reloadPlugins === true ? { reloadPlugins: true } : {}),
                    })
                  : Effect.succeed([])
              ).pipe(Effect.timeoutOption(PROFILE_PROBE_TIMEOUT_MS));
              if (Option.isNone(result)) {
                yield* setProfileError({
                  provider,
                  projectId: input.projectId,
                  cwd: input.cwd,
                  error: "Timed out while loading Claude MCP status.",
                });
                return;
              }
              const servers = result.value;
              yield* setProfileSnapshot({
                provider,
                projectId: input.projectId,
                cwd: input.cwd,
                status: "ready",
                serverNames: servers.map((server) => server.name),
                servers: [...servers],
                updatedAt: new Date().toISOString(),
              });
            }).pipe(
              Effect.catch((error: unknown) =>
                setProfileError({
                  provider,
                  projectId: input.projectId,
                  cwd: input.cwd,
                  error: errorMessage(error),
                }),
              ),
            ),
          { concurrency: PROFILE_PROBE_CONCURRENCY, discard: true },
        );
        yield* finishProjectRefresh(input.projectId, input.cwd);
      }).pipe(
        Effect.ensuring(
          Ref.update(inFlightProjectsRef, (set) => {
            const next = new Set(set);
            next.delete(projectCacheKey(input.projectId, input.cwd));
            return next;
          }),
        ),
      );

    const ensureClaudeProject: ProviderMcpStatusCacheShape["ensureClaudeProject"] = (input) =>
      Effect.gen(function* () {
        if (baseProviderKind(input.selectedProvider) !== "claudeAgent") {
          const empty: ResolvedMcpProviderSnapshot = {
            provider: input.selectedProvider,
            projectId: input.projectId,
            cwd: input.cwd,
            status: "ready",
            serverNames: [],
            servers: [],
            updatedAt: new Date().toISOString(),
          };
          return { selected: empty, snapshots: [empty] };
        }

        const providers = yield* enabledClaudeProviders;
        const now = Date.now();
        const projectKey = projectCacheKey(input.projectId, input.cwd);
        const existingMap = yield* Ref.get(snapshotsRef);
        const existingSnapshots = projectSnapshots(existingMap, input.projectId, input.cwd);
        const hasAllProviders = providers.every((provider) =>
          existingSnapshots.some((snapshot) => snapshot.provider === provider),
        );
        const needsRefresh =
          input.forceRefresh === true ||
          !hasAllProviders ||
          existingSnapshots.some((snapshot) => !isFresh(snapshot, now));

        if (!hasAllProviders) {
          yield* writeProjectSnapshots({
            projectId: input.projectId,
            cwd: input.cwd,
            providers,
            makeSnapshot: (provider, existing) =>
              existing ?? {
                provider,
                projectId: input.projectId,
                cwd: input.cwd,
                status: "loading",
                serverNames: [],
                servers: [],
              },
          });
          yield* publish;
        } else if (needsRefresh) {
          yield* writeProjectSnapshots({
            projectId: input.projectId,
            cwd: input.cwd,
            providers,
            makeSnapshot: (provider, existing) =>
              existing
                ? { ...existing, refreshing: true }
                : {
                    provider,
                    projectId: input.projectId,
                    cwd: input.cwd,
                    status: "loading",
                    refreshing: true,
                    serverNames: [],
                    servers: [],
                  },
          });
          yield* publish;
        }

        if (needsRefresh && providers.length > 0) {
          const shouldStart = yield* Ref.modify(inFlightProjectsRef, (set) => {
            if (set.has(projectKey)) return [false, set] as const;
            const next = new Set(set);
            next.add(projectKey);
            return [true, next] as const;
          });
          if (shouldStart) {
            yield* Effect.forkDetach(
              refreshProject({
                projectId: input.projectId,
                cwd: input.cwd,
                providers,
                ...(input.forceRefresh === true ? { reloadPlugins: true } : {}),
              }),
            );
          }
        }

        const nextSnapshots = projectSnapshots(
          yield* Ref.get(snapshotsRef),
          input.projectId,
          input.cwd,
        );
        return {
          selected: selectedSnapshot({
            snapshots: nextSnapshots,
            selectedProvider: input.selectedProvider,
            projectId: input.projectId,
            cwd: input.cwd,
          }),
          snapshots: nextSnapshots,
        };
      });

    const invalidateAll: ProviderMcpStatusCacheShape["invalidateAll"] = (_reason) =>
      Ref.set(snapshotsRef, new Map()).pipe(Effect.andThen(publish));

    yield* Stream.runDrain(
      serverSettings.streamChanges.pipe(Stream.mapEffect(() => invalidateAll("provider-settings"))),
    ).pipe(Effect.forkScoped);

    return {
      ensureClaudeProject,
      invalidateAll,
      get getAll() {
        return Ref.get(snapshotsRef).pipe(Effect.map(snapshotArray));
      },
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderMcpStatusCacheShape;
  }),
);
