/**
 * ProviderRegistryLive - Aggregates provider-specific snapshot services.
 *
 * @module ProviderRegistryLive
 */
import { baseProviderKind, type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { ClaudeProviderLive, makeClaudeProfileProvider } from "./ClaudeProvider";
import { CodexProviderLive, makeCodexProfileProvider } from "./CodexProvider";
import { checkCursorProviderStatus, CursorProviderLive } from "./CursorProvider";
import { GeminiProviderLive } from "./GeminiProvider";
import { ClaudeProvider } from "../Services/ClaudeProvider";
import { CodexProvider } from "../Services/CodexProvider";
import { CursorProvider } from "../Services/CursorProvider";
import { GeminiProvider } from "../Services/GeminiProvider";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry";
import type { ServerProviderShape } from "../Services/ServerProvider";
import { discoverClaudeProfiles, mergeClaudeProfiles } from "../claudeProfileDiscovery";
import { discoverCodexProfiles, mergeCodexProfiles } from "../codexProfileDiscovery";
import { mergeCursorProfiles, resolveCursorSettingsForProvider } from "../cursorProfileDiscovery";
import { ServerSettingsService } from "../../serverSettings";
import { ChildProcessSpawner } from "effect/unstable/process";

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const codexProvider = yield* CodexProvider;
    const claudeProvider = yield* ClaudeProvider;
    const geminiProvider = yield* GeminiProvider;
    const cursorProvider = yield* CursorProvider;
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    // ── Discover provider profiles ─────────────────────────────────
    const discoveredCodex = yield* discoverCodexProfiles();
    const discoveredClaude = yield* discoverClaudeProfiles();
    const settings = yield* serverSettings.getSettings;
    const codexProfiles = mergeCodexProfiles(discoveredCodex, settings.providers.codexProfiles);
    const claudeProfiles = mergeClaudeProfiles(discoveredClaude, settings.providers.claudeProfiles);

    const profileProviders: Array<{ kind: ProviderKind; provider: ServerProviderShape }> = [];
    for (const profile of codexProfiles) {
      const provider = yield* makeCodexProfileProvider(profile);
      profileProviders.push({ kind: profile.providerKind, provider });
    }
    for (const profile of claudeProfiles) {
      const provider = yield* makeClaudeProfileProvider(profile);
      profileProviders.push({ kind: profile.providerKind, provider });
    }

    // ── Aggregate all providers ────────────────────────────────────

    const allProviders: Array<{ kind: ProviderKind; provider: ServerProviderShape }> = [
      { kind: "codex", provider: codexProvider },
      { kind: "claudeAgent", provider: claudeProvider },
      { kind: "gemini", provider: geminiProvider },
      { kind: "cursor", provider: cursorProvider },
      ...profileProviders,
    ];

    const loadProviders = () =>
      Effect.gen(function* () {
        const staticProviders = yield* Effect.all(
          allProviders.map(({ provider }) => provider.getSnapshot),
          { concurrency: "unbounded" },
        );
        const latestSettings = yield* serverSettings.getSettings;
        const cursorProfiles = mergeCursorProfiles(latestSettings.providers.cursorProfiles);
        const cursorProfileProviders = yield* Effect.all(
          cursorProfiles.map((profile) =>
            checkCursorProviderStatus({
              providerKind: profile.providerKind,
              displayName: profile.displayName,
              settingsOverride: resolveCursorSettingsForProvider(
                latestSettings,
                profile.providerKind,
              ),
            }).pipe(
              Effect.provideService(ServerSettingsService, serverSettings),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            ),
          ),
          { concurrency: "unbounded" },
        );
        return [...staticProviders, ...cursorProfileProviders];
      });

    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(yield* loadProviders());

    const syncProviders = Effect.fn("syncProviders")(function* (options?: {
      readonly publish?: boolean;
    }) {
      const previousProviders = yield* Ref.get(providersRef);
      const providers = yield* loadProviders();
      yield* Ref.set(providersRef, providers);

      if (options?.publish !== false && haveProvidersChanged(previousProviders, providers)) {
        yield* PubSub.publish(changesPubSub, providers);
      }

      return providers;
    });

    // Subscribe to changes from all providers
    for (const { provider } of allProviders) {
      yield* Stream.runForEach(provider.streamChanges, () => syncProviders()).pipe(
        Effect.forkScoped,
      );
    }
    yield* Stream.runForEach(serverSettings.streamChanges, () => syncProviders()).pipe(
      Effect.forkScoped,
    );

    const refresh = Effect.fn("refresh")(function* (provider?: ProviderKind) {
      if (provider) {
        const entry = allProviders.find(({ kind }) => kind === provider);
        if (entry) {
          yield* entry.provider.refresh;
        } else if (baseProviderKind(provider) === "codex") {
          yield* codexProvider.refresh;
        } else if (baseProviderKind(provider) === "claudeAgent") {
          // Refresh the default Claude provider for unknown Claude profiles
          yield* claudeProvider.refresh;
        } else if (baseProviderKind(provider) === "cursor") {
          yield* cursorProvider.refresh;
        }
      } else {
        yield* Effect.all(
          allProviders.map(({ provider: p }) => p.refresh),
          { concurrency: "unbounded" },
        );
      }
      return yield* syncProviders();
    });

    return {
      getProviders: syncProviders({ publish: false }).pipe(
        Effect.tapError(Effect.logError),
        Effect.orElseSucceed(() => []),
      ),
      refresh: (provider?: ProviderKind) =>
        refresh(provider).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => []),
        ),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
).pipe(
  Layer.provideMerge(CodexProviderLive),
  Layer.provideMerge(ClaudeProviderLive),
  Layer.provideMerge(GeminiProviderLive),
  Layer.provideMerge(CursorProviderLive),
);
