import type {
  ProviderKind,
  ModelCapabilities,
  CodexSettings,
  ServerSettings,
  ServerProvider,
  ServerProviderModel,
  ServerProviderAuth,
  ServerProviderState,
} from "@t3tools/contracts";
import {
  Cache,
  Duration,
  Effect,
  Equal,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "../codexCliVersion";
import {
  adjustCodexModelsForAccount,
  codexAuthSubLabel,
  codexAuthSubType,
  type CodexAccountSnapshot,
} from "../codexAccount";
import { probeCodexAccount } from "../codexAppServer";
import { CodexProvider } from "../Services/CodexProvider";
import type { ServerProviderShape } from "../Services/ServerProvider";
import { ServerSettingsService } from "../../serverSettings";
import { ServerSettingsError } from "@t3tools/contracts";
import {
  defaultCodexHomePath,
  resolveCodexHomePath,
  type DiscoveredCodexProfile,
} from "../codexProfileDiscovery";

const PROVIDER = "codex" as const;
const OPENAI_AUTH_PROVIDERS = new Set(["openai"]);
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      supportsPlan: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      supportsPlan: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      supportsPlan: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      supportsPlan: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      supportsPlan: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.2",
    name: "GPT-5.2",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      supportsPlan: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

export function getCodexModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ?? {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      supportsPlan: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    }
  );
}

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message: "Codex CLI authentication status command is unavailable in this Codex version.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: "ready", auth: { status: "authenticated" } };
  }
  if (parsedAuth.auth === false) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message:
        "Could not verify Codex authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    return { status: "ready", auth: { status: "authenticated" } };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : "Could not verify Codex authentication status.",
  };
}

export const readCodexConfigModelProvider = Effect.fn("readCodexConfigModelProvider")(function* (
  homePath?: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsService = yield* ServerSettingsService;
  const codexHome =
    homePath ||
    (yield* settingsService.getSettings.pipe(
      Effect.map((settings) => resolveCodexHomePath(settings)),
    ));
  const configPath = path.join(codexHome, "config.toml");

  const content = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (content === undefined) {
    return undefined;
  }

  let inTopLevel = true;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;

    const match = trimmed.match(/^model_provider\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return undefined;
});

const hasCustomModelProviderForHome = (homePath?: string) =>
  readCodexConfigModelProvider(homePath).pipe(
    Effect.map((provider) => provider !== undefined && !OPENAI_AUTH_PROVIDERS.has(provider)),
    Effect.orElseSucceed(() => false),
  );

export const hasCustomModelProvider = hasCustomModelProviderForHome();

interface CodexProviderCheckOptions {
  readonly providerKind?: ProviderKind;
  readonly displayName?: string;
  readonly settingsOverride?: CodexSettings;
}

const resolveCodexSettings = Effect.fn("resolveCodexSettings")(function* (
  options?: CodexProviderCheckOptions,
) {
  if (options?.settingsOverride) {
    return options.settingsOverride;
  }
  return yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.codex),
  );
});

const providerModelsFromCodexSettings = (
  codexSettings: CodexSettings,
): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, codexSettings.customModels);

const withResolvedCodexHomePath = (codexSettings: CodexSettings): CodexSettings => ({
  ...codexSettings,
  homePath: codexSettings.homePath || defaultCodexHomePath(),
});

const effectiveProfileCodexSettings = (
  settings: ServerSettings,
  profile: DiscoveredCodexProfile,
): CodexSettings => {
  const configured = settings.providers.codexProfiles.find(
    (candidate) => candidate.profileId === profile.profileId,
  );
  return {
    enabled: configured?.enabled ?? settings.providers.codex.enabled,
    binaryPath: configured?.binaryPath || settings.providers.codex.binaryPath,
    homePath: configured?.homePath || profile.homePath,
    customModels: configured?.customModels ?? settings.providers.codex.customModels,
  };
};

export const hasCustomModelProviderForSettings = (codexSettings: CodexSettings) =>
  readCodexConfigModelProvider(codexSettings.homePath || undefined).pipe(
    Effect.map((provider) => provider !== undefined && !OPENAI_AUTH_PROVIDERS.has(provider)),
    Effect.orElseSucceed(() => false),
  );

const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;

const probeCodexCapabilities = (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
}) =>
  Effect.tryPromise((signal) => probeCodexAccount({ ...input, signal })).pipe(
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map((result) => {
      if (Result.isFailure(result)) return undefined;
      return Option.isSome(result.success) ? result.success.value : undefined;
    }),
  );

const runCodexCommand = Effect.fn("runCodexCommand")(function* (
  args: ReadonlyArray<string>,
  codexSettings: CodexSettings,
) {
  const command = ChildProcess.make(codexSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(codexSettings.homePath ? { CODEX_HOME: codexSettings.homePath } : {}),
    },
  });
  return yield* spawnAndCollect(codexSettings.binaryPath, command);
});

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  resolveAccount?: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
  }) => Effect.Effect<CodexAccountSnapshot | undefined>,
  options?: CodexProviderCheckOptions,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService
> {
  const codexSettings = withResolvedCodexHomePath(yield* resolveCodexSettings(options));
  const providerKind = options?.providerKind ?? PROVIDER;
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromCodexSettings(codexSettings);

  if (!codexSettings.enabled) {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runCodexCommand(["--version"], codexSettings).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Codex CLI (`codex`) is not installed or not on PATH."
          : `Failed to execute Codex CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Codex CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion =
    parseCodexCliVersion(`${version.stdout}\n${version.stderr}`) ??
    parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Codex CLI is installed but failed to run. ${detail}`
          : "Codex CLI is installed but failed to run.",
      },
    });
  }

  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: formatCodexCliUpgradeMessage(parsedVersion),
      },
    });
  }

  if (yield* hasCustomModelProviderForSettings(codexSettings)) {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "ready",
        auth: { status: "unknown" },
        message: "Using a custom Codex model provider; OpenAI login check skipped.",
      },
    });
  }

  const authProbe = yield* runCodexCommand(["login", "status"], codexSettings).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );
  const account = resolveAccount
    ? yield* resolveAccount({
        binaryPath: codexSettings.binaryPath,
        homePath: codexSettings.homePath,
      })
    : undefined;
  const resolvedModels = adjustCodexModelsForAccount(models, account);

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models: resolvedModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message:
          error instanceof Error
            ? `Could not verify Codex authentication status: ${error.message}.`
            : "Could not verify Codex authentication status.",
      },
    });
  }

  if (Option.isNone(authProbe.success)) {
    return buildServerProvider({
      provider: providerKind,
      ...(options?.displayName ? { displayName: options.displayName } : {}),
      enabled: codexSettings.enabled,
      checkedAt,
      models: resolvedModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Codex authentication status. Timed out while running command.",
      },
    });
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value);
  const authType = codexAuthSubType(account);
  const authLabel = codexAuthSubLabel(account);
  return buildServerProvider({
    provider: providerKind,
    ...(options?.displayName ? { displayName: options.displayName } : {}),
    enabled: codexSettings.enabled,
    checkedAt,
    models: resolvedModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: parsed.status,
      auth: {
        ...parsed.auth,
        ...(authType ? { type: authType } : {}),
        ...(authLabel ? { label: authLabel } : {}),
      },
      ...(parsed.message ? { message: parsed.message } : {}),
    },
  });
});

export function makeCodexProfileProvider(
  profile: DiscoveredCodexProfile,
): Effect.Effect<
  ServerProviderShape,
  ServerSettingsError,
  | ServerSettingsService
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
> {
  return Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const accountProbeCache = yield* Cache.make({
      capacity: 4,
      timeToLive: Duration.minutes(5),
      lookup: (key: string) => {
        const [binaryPath, homePath] = JSON.parse(key) as [string, string | undefined];
        return probeCodexCapabilities({
          binaryPath,
          ...(homePath ? { homePath } : {}),
        });
      },
    });

    const getSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => effectiveProfileCodexSettings(settings, profile)),
      Effect.orDie,
    );

    const checkProvider = getSettings.pipe(
      Effect.flatMap((settingsOverride) =>
        checkCodexProviderStatus(
          (input) =>
            Cache.get(accountProbeCache, JSON.stringify([input.binaryPath, input.homePath])),
          {
            providerKind: profile.providerKind,
            displayName: profile.displayName,
            settingsOverride,
          },
        ),
      ),
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CodexSettings>({
      getSettings,
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => effectiveProfileCodexSettings(settings, profile)),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  });
}

export const CodexProviderLive = Layer.effect(
  CodexProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const accountProbeCache = yield* Cache.make({
      capacity: 4,
      timeToLive: Duration.minutes(5),
      lookup: (key: string) => {
        const [binaryPath, homePath] = JSON.parse(key) as [string, string | undefined];
        return probeCodexCapabilities({
          binaryPath,
          ...(homePath ? { homePath } : {}),
        });
      },
    });

    const checkProvider = checkCodexProviderStatus((input) =>
      Cache.get(accountProbeCache, JSON.stringify([input.binaryPath, input.homePath])),
    ).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CodexSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.codex),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.codex),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
