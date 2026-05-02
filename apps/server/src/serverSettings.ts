/**
 * ServerSettings - Server-authoritative settings service.
 *
 * Owns persistence, validation, and change notification of settings that affect
 * server-side behavior (binary paths, streaming mode, env mode, custom models,
 * text generation model selection, managed run inference model selection).
 *
 * Follows the same pattern as `keybindings.ts`: JSON file + Cache + PubSub +
 * Semaphore + FileSystem.watch for concurrency and external edit detection.
 *
 * @module ServerSettings
 */
import {
  type BaseProviderKind,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  ADMIN_PROMPT_IDS,
  ORCHESTRATION_PROMPT_IDS,
  type ModelSelection,
  ServerSettings,
  ServerSettingsError,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  Cache,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Equal,
  PubSub,
  Ref,
  Schema,
  SchemaIssue,
  Scope,
  ServiceMap,
  Stream,
  Cause,
} from "effect";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "./config";
import { type DeepPartial, deepMerge } from "@t3tools/shared/Struct";
import { fromLenientJson } from "@t3tools/shared/schemaJson";

export interface ServerSettingsShape {
  /** Start the settings runtime and attach file watching. */
  readonly start: Effect.Effect<void, ServerSettingsError>;

  /** Await settings runtime readiness. */
  readonly ready: Effect.Effect<void, ServerSettingsError>;

  /** Read the current settings. */
  readonly getSettings: Effect.Effect<ServerSettings, ServerSettingsError>;

  /** Patch settings and persist. Returns the new full settings object. */
  readonly updateSettings: (
    patch: ServerSettingsPatch,
  ) => Effect.Effect<ServerSettings, ServerSettingsError>;

  /** Stream of settings change events. */
  readonly streamChanges: Stream.Stream<ServerSettings>;
}

export class ServerSettingsService extends ServiceMap.Service<
  ServerSettingsService,
  ServerSettingsShape
>()("t3/serverSettings/ServerSettingsService") {
  static readonly layerTest = (overrides: DeepPartial<ServerSettings> = {}) =>
    Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const currentSettingsRef = yield* Ref.make<ServerSettings>(
          resolvePromptSettings(
            deepMerge(DEFAULT_SERVER_SETTINGS, overrides as unknown as DeepPartial<ServerSettings>),
          ),
        );

        return {
          start: Effect.void,
          ready: Effect.void,
          getSettings: Ref.get(currentSettingsRef).pipe(Effect.map(resolvePromptSettings)),
          updateSettings: (patch) =>
            Ref.get(currentSettingsRef).pipe(
              Effect.map((currentSettings) => {
                const normalizedPatch = applyPromptResetPatch(currentSettings, patch);
                return resolvePromptSettings(
                  deepMerge(
                    currentSettings,
                    normalizedPatch as unknown as DeepPartial<ServerSettings>,
                  ),
                );
              }),
              Effect.tap((nextSettings) => Ref.set(currentSettingsRef, nextSettings)),
            ),
          streamChanges: Stream.empty,
        } satisfies ServerSettingsShape;
      }),
    );
}

const ServerSettingsJson = fromLenientJson(ServerSettings);

const PROVIDER_ORDER: readonly BaseProviderKind[] = ["codex", "claudeAgent", "gemini", "cursor"];

function resolveModelSelectionProvider(
  settings: ServerSettings,
  selection: ModelSelection,
): ModelSelection {
  if (settings.providers[selection.provider].enabled) {
    return selection;
  }

  const fallback = PROVIDER_ORDER.find((p) => settings.providers[p].enabled);
  if (!fallback) {
    return selection;
  }

  return {
    provider: fallback,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[fallback],
  } as ModelSelection;
}

/**
 * Ensure model-selection settings point to enabled providers.
 * If the selected provider is disabled, fall back to the first enabled
 * provider with its default model. This is applied at read-time so the
 * persisted preference is preserved for when a provider is re-enabled.
 */
function resolveModelSelectionProviders(settings: ServerSettings): ServerSettings {
  const nextTextGeneration = resolveModelSelectionProvider(
    settings,
    settings.textGenerationModelSelection,
  );
  const nextManagedRunInference = resolveModelSelectionProvider(
    settings,
    settings.managedRunInferenceModelSelection,
  );
  const nextOrchImplementer = resolveModelSelectionProvider(
    settings,
    settings.orchestrationImplementerModelSelection,
  );
  const nextOrchReviewer = resolveModelSelectionProvider(
    settings,
    settings.orchestrationReviewerModelSelection,
  );
  if (
    Equal.equals(nextTextGeneration, settings.textGenerationModelSelection) &&
    Equal.equals(nextManagedRunInference, settings.managedRunInferenceModelSelection) &&
    Equal.equals(nextOrchImplementer, settings.orchestrationImplementerModelSelection) &&
    Equal.equals(nextOrchReviewer, settings.orchestrationReviewerModelSelection)
  ) {
    return settings;
  }

  return {
    ...settings,
    textGenerationModelSelection: nextTextGeneration,
    managedRunInferenceModelSelection: nextManagedRunInference,
    orchestrationImplementerModelSelection: nextOrchImplementer,
    orchestrationReviewerModelSelection: nextOrchReviewer,
  };
}

function resolvePromptSettings(settings: ServerSettings): ServerSettings {
  const promptDefaults = DEFAULT_SERVER_SETTINGS.promptDefaults;
  const resolvedPrompts = {
    orchestration: {
      ...promptDefaults.orchestration,
      ...settings.prompts.orchestration,
    },
    admin: {
      ...promptDefaults.admin,
      ...settings.prompts.admin,
    },
  } satisfies ServerSettings["prompts"];

  if (
    Equal.equals(resolvedPrompts, settings.prompts) &&
    Equal.equals(promptDefaults, settings.promptDefaults)
  ) {
    return settings;
  }

  return {
    ...settings,
    prompts: resolvedPrompts,
    promptDefaults,
  };
}

function applyPromptResetPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettingsPatch {
  let nextPatch = patch;

  // Handle orchestration null-resets
  const orchestrationPatch = patch.prompts?.orchestration;
  if (orchestrationPatch && Object.values(orchestrationPatch).some((d) => d === null)) {
    const nextOrchestrationPatch = Object.fromEntries(
      ORCHESTRATION_PROMPT_IDS.flatMap((promptId) => {
        const document = orchestrationPatch[promptId];
        if (document === undefined) return [];
        return [[promptId, document ?? current.promptDefaults.orchestration[promptId]]];
      }),
    ) as NonNullable<NonNullable<ServerSettingsPatch["prompts"]>["orchestration"]>;

    nextPatch = {
      ...nextPatch,
      prompts: { ...nextPatch.prompts, orchestration: nextOrchestrationPatch },
    };
  }

  // Handle admin null-resets
  const adminPatch = patch.prompts?.admin;
  if (adminPatch && Object.values(adminPatch).some((d) => d === null)) {
    const nextAdminPatch = Object.fromEntries(
      ADMIN_PROMPT_IDS.flatMap((promptId) => {
        const document = adminPatch[promptId];
        if (document === undefined) return [];
        return [[promptId, document ?? current.promptDefaults.admin[promptId]]];
      }),
    ) as NonNullable<NonNullable<ServerSettingsPatch["prompts"]>["admin"]>;

    nextPatch = {
      ...nextPatch,
      prompts: { ...nextPatch.prompts, admin: nextAdminPatch },
    };
  }

  return nextPatch;
}

function isAtomicServerSettingsPath(path: ReadonlyArray<string>): boolean {
  if (path.length === 1) {
    return (
      path[0] === "textGenerationModelSelection" ||
      path[0] === "managedRunInferenceModelSelection" ||
      path[0] === "orchestrationImplementerModelSelection" ||
      path[0] === "orchestrationReviewerModelSelection"
    );
  }

  if (path.length === 3 && (path[0] === "prompts" || path[0] === "promptDefaults")) {
    if (path[1] === "orchestration") {
      return (ORCHESTRATION_PROMPT_IDS as ReadonlyArray<string>).includes(path[2]!);
    }
    if (path[1] === "admin") {
      return (ADMIN_PROMPT_IDS as ReadonlyArray<string>).includes(path[2]!);
    }
  }

  return false;
}

function stripDefaultServerSettings(
  current: unknown,
  defaults: unknown,
  path: ReadonlyArray<string> = [],
): unknown | undefined {
  if (isAtomicServerSettingsPath(path)) {
    return Equal.equals(current, defaults) ? undefined : current;
  }

  if (Array.isArray(current) || Array.isArray(defaults)) {
    return Equal.equals(current, defaults) ? undefined : current;
  }

  if (
    current !== null &&
    defaults !== null &&
    typeof current === "object" &&
    typeof defaults === "object"
  ) {
    const currentRecord = current as Record<string, unknown>;
    const defaultsRecord = defaults as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(currentRecord)) {
      const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key], [
        ...path,
        key,
      ]);
      if (stripped !== undefined) {
        next[key] = stripped;
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  return Object.is(current, defaults) ? undefined : current;
}

const makeServerSettings = Effect.gen(function* () {
  const { settingsPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const writeSemaphore = yield* Semaphore.make(1);
  const cacheKey = "settings" as const;
  const changesPubSub = yield* PubSub.unbounded<ServerSettings>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ServerSettingsError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const emitChange = (settings: ServerSettings) =>
    PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          detail: "failed to check settings file existence",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          detail: "failed to read settings file",
          cause,
        }),
    ),
  );

  const loadSettingsFromDisk = Effect.gen(function* () {
    if (!(yield* readConfigExists)) {
      return DEFAULT_SERVER_SETTINGS;
    }

    const raw = yield* readRawConfig;
    const decoded = Schema.decodeUnknownExit(ServerSettingsJson)(raw);
    if (decoded._tag === "Failure") {
      yield* Effect.logWarning("failed to parse settings.json, using defaults", {
        path: settingsPath,
        issues: Cause.pretty(decoded.cause),
      });
      return DEFAULT_SERVER_SETTINGS;
    }
    return resolvePromptSettings(decoded.value);
  });

  const settingsCache = yield* Cache.make<typeof cacheKey, ServerSettings, ServerSettingsError>({
    capacity: 1,
    lookup: () => loadSettingsFromDisk,
  });

  const getSettingsFromCache = Cache.get(settingsCache, cacheKey);

  const writeSettingsAtomically = (settings: ServerSettings) => {
    const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    const sparseSettings = stripDefaultServerSettings(settings, DEFAULT_SERVER_SETTINGS) ?? {};

    return Effect.succeed(`${JSON.stringify(sparseSettings, null, 2)}\n`).pipe(
      Effect.tap(() => fs.makeDirectory(pathService.dirname(settingsPath), { recursive: true })),
      Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => fs.rename(tempPath, settingsPath)),
      Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            detail: "failed to write settings file",
            cause,
          }),
      ),
    );
  };

  const revalidateAndEmit = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(settingsCache, cacheKey);
      const settings = yield* getSettingsFromCache;
      yield* emitChange(settings);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const settingsDir = pathService.dirname(settingsPath);
    const settingsFile = pathService.basename(settingsPath);
    const settingsPathResolved = pathService.resolve(settingsPath);

    yield* fs.makeDirectory(settingsDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            detail: "failed to prepare settings directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    // Debounce watch events so the file is fully written before we read it.
    // Editors emit multiple events per save (truncate, write, rename) and
    // `fs.watch` can fire before the content has been flushed to disk.
    const debouncedSettingsEvents = fs.watch(settingsDir).pipe(
      Stream.filter((event) => {
        return (
          event.path === settingsFile ||
          event.path === settingsPath ||
          pathService.resolve(settingsDir, event.path) === settingsPathResolved
        );
      }),
      Stream.debounce(Duration.millis(100)),
    );

    yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true]);
    if (!shouldStart) {
      return yield* Deferred.await(startedDeferred);
    }

    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* Cache.invalidate(settingsCache, cacheKey);
      yield* getSettingsFromCache;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    start,
    ready: Deferred.await(startedDeferred),
    getSettings: getSettingsFromCache.pipe(
      Effect.map(resolveModelSelectionProviders),
      Effect.map(resolvePromptSettings),
    ),
    updateSettings: (patch) =>
      writeSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* getSettingsFromCache;
          const normalizedPatch = applyPromptResetPatch(current, patch);
          const next = yield* Schema.decodeEffect(ServerSettings)(
            deepMerge(current, normalizedPatch as unknown as DeepPartial<ServerSettings>),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ServerSettingsError({
                  settingsPath: "<memory>",
                  detail: `failed to normalize server settings: ${SchemaIssue.makeFormatterDefault()(cause.issue)}`,
                  cause,
                }),
            ),
          );
          const resolvedNext = resolvePromptSettings(next);
          yield* writeSettingsAtomically(resolvedNext);
          yield* Cache.set(settingsCache, cacheKey, resolvedNext);
          yield* emitChange(resolvedNext);
          return resolvePromptSettings(resolveModelSelectionProviders(resolvedNext));
        }),
      ),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub).pipe(
        Stream.map(resolveModelSelectionProviders),
        Stream.map(resolvePromptSettings),
      );
    },
  } satisfies ServerSettingsShape;
});

export const ServerSettingsLive = Layer.effect(ServerSettingsService, makeServerSettings);
