import type {
  CursorSettings,
  ModelCapabilities,
  ProviderKind,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
} from "@t3tools/contracts";
import { ServerSettingsError } from "@t3tools/contracts";
import { Effect, Equal, Layer, Result, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerSettingsService } from "../../serverSettings";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot";
import { CursorProvider } from "../Services/CursorProvider";
import type { ServerProviderShape } from "../Services/ServerProvider";
import {
  resolveCursorSettingsForProvider,
  type ResolvedCursorProfile,
} from "../cursorProfileDiscovery";
import {
  cursorAcpModelLabel,
  CURSOR_ACP_BUILT_IN_MODELS,
  normalizeCursorModelForAcp,
} from "../cursorModelIds";

const PROVIDER = "cursor" as const;

const CURSOR_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  supportsPlan: true,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = CURSOR_ACP_BUILT_IN_MODELS.map(
  (model) => ({
    slug: model.slug,
    name: model.name,
    isCustom: false,
    capabilities: CURSOR_MODEL_CAPABILITIES,
  }),
);

interface CursorProviderCheckOptions {
  readonly providerKind?: ProviderKind;
  readonly displayName?: string;
  readonly settingsOverride?: CursorSettings;
}

interface CursorAboutJson {
  readonly cliVersion?: unknown;
  readonly subscriptionTier?: unknown;
  readonly userEmail?: unknown;
  readonly model?: unknown;
}

function parseCursorVersion(output: string): string | null {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? null;
}

function accountLabelFromAbout(about: CursorAboutJson): string {
  const tier = typeof about.subscriptionTier === "string" ? about.subscriptionTier.trim() : "";
  return tier ? `Cursor ${tier}` : "Cursor login";
}

export function parseCursorAboutJson(output: string): CursorAboutJson | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as CursorAboutJson)
      : null;
  } catch {
    return null;
  }
}

export function parseCursorAuthFromStatusOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
} {
  const output = `${result.stdout}\n${result.stderr}`;
  const lower = output.toLowerCase();

  if (
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("not authenticated") ||
    lower.includes("run `agent login`") ||
    lower.includes("run agent login") ||
    lower.includes("cursor-agent login")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated", type: "cursor-login", label: "Run `agent login`" },
      message: "Cursor CLI is not authenticated. Run `agent login` and try again.",
    };
  }

  if (lower.includes("logged in as") || lower.includes("authenticated")) {
    return {
      status: "ready",
      auth: {
        status: "authenticated",
        type: "cursor-login",
        label: "Cursor login",
      },
    };
  }

  if (result.code === 0) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message: "Cursor CLI status succeeded, but authentication could not be verified.",
    };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Cursor authentication status. ${detail}`
      : "Could not verify Cursor authentication status.",
  };
}

export function parseCursorModelsOutput(output: string): ReadonlyArray<ServerProviderModel> {
  const models: ServerProviderModel[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Available models" || trimmed.startsWith("Tip:")) continue;

    const match = trimmed.match(/^([^\s]+)\s+-\s+(.+)$/);
    if (!match) continue;

    const rawSlug = match[1]?.trim();
    const rawName = match[2]?.trim();
    if (!rawSlug || !rawName) continue;
    const slug = normalizeCursorModelForAcp(rawSlug);
    if (seen.has(slug)) continue;
    seen.add(slug);
    models.push({
      slug,
      name: cursorAcpModelLabel(slug),
      isCustom: false,
      capabilities: CURSOR_MODEL_CAPABILITIES,
    });
  }

  return models;
}

function mergeCursorModels(
  cliModels: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const merged: ServerProviderModel[] = [];
  const seen = new Set<string>();
  const sourceModels =
    cliModels.length > 0
      ? [...BUILT_IN_MODELS.filter((model) => model.slug === "composer-2"), ...cliModels]
      : BUILT_IN_MODELS;

  for (const model of sourceModels) {
    if (seen.has(model.slug)) continue;
    seen.add(model.slug);
    merged.push(model);
  }

  const withCustom = providerModelsFromSettings(merged, PROVIDER, customModels);
  return withCustom;
}

function buildCursorEnv(settings: CursorSettings): Record<string, string> {
  return {
    ...process.env,
    ...settings.env,
    ...(settings.homePath ? { HOME: settings.homePath } : {}),
    ...(settings.configDir ? { CURSOR_CONFIG_DIR: settings.configDir } : {}),
    ...(settings.dataDir ? { CURSOR_DATA_DIR: settings.dataDir } : {}),
  };
}

function makeCursorCommand(settings: CursorSettings, args: ReadonlyArray<string>) {
  const launchCommand = settings.launchCommand.filter((part) => part.trim().length > 0);
  const command = launchCommand.at(0) ?? settings.binaryPath;
  const commandArgs = launchCommand.length > 0 ? [...launchCommand.slice(1), ...args] : [...args];
  return ChildProcess.make(command, commandArgs, {
    shell: process.platform === "win32",
    env: buildCursorEnv(settings),
  });
}

const runCursorCommand = Effect.fn("runCursorCommand")(function* (
  args: ReadonlyArray<string>,
  settings: CursorSettings,
) {
  const launchCommand = settings.launchCommand.filter((part) => part.trim().length > 0);
  const commandLabel = launchCommand.at(0) ?? settings.binaryPath;
  return yield* spawnAndCollect(commandLabel, makeCursorCommand(settings, args));
});

const resolveCursorSettings = Effect.fn("resolveCursorSettings")(function* (
  options?: CursorProviderCheckOptions,
) {
  if (options?.settingsOverride) {
    return options.settingsOverride;
  }
  return yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.cursor),
  );
});

function disabledProvider(
  providerKind: ProviderKind,
  displayName: string | undefined,
  checkedAt: string,
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider {
  return buildServerProvider({
    provider: providerKind,
    ...(displayName ? { displayName } : {}),
    enabled: false,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Cursor is disabled in T3 Code settings.",
    },
  });
}

export const checkCursorProviderStatus = Effect.fn("checkCursorProviderStatus")(function* (
  options?: CursorProviderCheckOptions,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const cursorSettings = yield* resolveCursorSettings(options);
  const providerKind = options?.providerKind ?? PROVIDER;
  const checkedAt = new Date().toISOString();
  let models = mergeCursorModels([], cursorSettings.customModels);

  if (!cursorSettings.enabled) {
    return disabledProvider(providerKind, options?.displayName, checkedAt, models);
  }

  const versionProbe = yield* runCursorCommand(["--version"], cursorSettings).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Cursor CLI not found. Install Cursor CLI or set the binary path in settings."
          : error instanceof Error
            ? error.message
            : "Unable to run Cursor CLI.",
      },
    });
  }

  if (versionProbe.success._tag === "None") {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Timed out while checking Cursor CLI.",
      },
    });
  }

  const versionResult = versionProbe.success.value;
  if (versionResult.code !== 0) {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parseCursorVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
        status: "error",
        auth: { status: "unknown" },
        message: detailFromResult(versionResult) ?? "Cursor CLI version check failed.",
      },
    });
  }

  const modelsProbe = yield* runCursorCommand(["models"], cursorSettings).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );
  const modelWarning = (() => {
    if (Result.isFailure(modelsProbe)) {
      return modelsProbe.failure instanceof Error
        ? modelsProbe.failure.message
        : "Unable to list Cursor models.";
    }
    if (modelsProbe.success._tag === "None") {
      return "Timed out while listing Cursor models.";
    }
    const result = modelsProbe.success.value;
    if (result.code !== 0) {
      return detailFromResult(result) ?? "Cursor model listing failed.";
    }
    const parsedModels = parseCursorModelsOutput(result.stdout);
    models = mergeCursorModels(parsedModels, cursorSettings.customModels);
    return null;
  })();

  const aboutProbe = yield* runCursorCommand(["about", "--format", "json"], cursorSettings).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  let authStatus: Exclude<ServerProviderState, "disabled"> = "warning";
  let auth: ServerProviderAuth = { status: "unknown" };
  let authMessage: string | undefined;

  if (Result.isSuccess(aboutProbe) && aboutProbe.success._tag === "Some") {
    const aboutResult = aboutProbe.success.value;
    const about = aboutResult.code === 0 ? parseCursorAboutJson(aboutResult.stdout) : null;
    if (about) {
      authStatus = "ready";
      auth = {
        status: "authenticated",
        type: "cursor-login",
        label: accountLabelFromAbout(about),
      };
    } else if (aboutResult.code !== 0) {
      authStatus = "warning";
      auth = { status: "unknown" };
      authMessage = detailFromResult(aboutResult) ?? "Cursor about probe failed.";
    }
  } else if (Result.isFailure(aboutProbe)) {
    authMessage =
      aboutProbe.failure instanceof Error
        ? aboutProbe.failure.message
        : "Cursor about probe failed.";
  } else {
    authMessage = "Timed out while checking Cursor account status.";
  }

  if (auth.status === "unknown") {
    const statusProbe = yield* runCursorCommand(["status"], cursorSettings).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isSuccess(statusProbe) && statusProbe.success._tag === "Some") {
      const parsedStatus = parseCursorAuthFromStatusOutput(statusProbe.success.value);
      authStatus = parsedStatus.status;
      auth = parsedStatus.auth;
      authMessage = parsedStatus.message ?? authMessage;
    } else if (Result.isSuccess(statusProbe) && statusProbe.success._tag === "None") {
      authMessage = authMessage ?? "Timed out while checking Cursor authentication status.";
    }
  }

  const warningMessages = [authMessage, modelWarning].filter(
    (message): message is string => typeof message === "string" && message.length > 0,
  );
  const status =
    authStatus === "ready" && warningMessages.length > 0 ? ("warning" as const) : authStatus;

  return buildServerProvider({
    provider: providerKind,
    ...(options?.displayName ? { displayName: options.displayName } : {}),
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parseCursorVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
      status,
      auth,
      ...(warningMessages.length > 0 ? { message: warningMessages.join(" ") } : {}),
    },
  });
});

export const CursorProviderLive = Layer.effect(
  CursorProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const checkProvider = checkCursorProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    return yield* makeManagedServerProvider<CursorSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.cursor),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.cursor),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);

export function makeCursorProfileProvider(
  profile: ResolvedCursorProfile,
): Effect.Effect<
  ServerProviderShape,
  ServerSettingsError,
  ServerSettingsService | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  return Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const getProfileSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => resolveCursorSettingsForProvider(settings, profile.providerKind)),
      Effect.orDie,
    );
    const checkProvider = getProfileSettings.pipe(
      Effect.flatMap((settingsOverride) =>
        checkCursorProviderStatus({
          providerKind: profile.providerKind,
          displayName: profile.displayName,
          settingsOverride,
        }),
      ),
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CursorSettings>({
      getSettings: getProfileSettings,
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => resolveCursorSettingsForProvider(settings, profile.providerKind)),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  });
}
