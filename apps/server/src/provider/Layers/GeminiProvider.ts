import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  GeminiSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
} from "@t3tools/contracts";
import { ServerSettingsError } from "@t3tools/contracts";
import { Effect, Equal, Layer, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerSettingsService } from "../../serverSettings";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot";
import { GeminiProvider } from "../Services/GeminiProvider";

const PROVIDER = "gemini" as const;
const GEMINI_CLI_HOME_DIRNAME = ".gemini";

const GEMINI_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  supportsPlan: true,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "auto-gemini-3",
    name: "Auto (Gemini 3)",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "auto-gemini-2.5",
    name: "Auto (Gemini 2.5)",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash-Lite Preview",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    isCustom: false,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  },
];

export function getGeminiModelCapabilities(model: string | null | undefined): ModelCapabilities {
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

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveGeminiHomePath(settings: GeminiSettings): string {
  return (
    settings.homePath.trim() ||
    process.env.GEMINI_CLI_HOME ||
    join(homedir(), GEMINI_CLI_HOME_DIRNAME)
  );
}

function selectedAuthTypeFromSettings(geminiHomePath: string): string | null {
  const settings = readJsonFile(join(geminiHomePath, "settings.json"));
  if (!isRecord(settings)) {
    return null;
  }
  const security = settings.security;
  const auth = isRecord(security) ? security.auth : undefined;
  const selectedType = isRecord(auth) ? auth.selectedType : undefined;
  return typeof selectedType === "string" && selectedType.trim() ? selectedType : null;
}

function cachedGoogleAccountLabel(geminiHomePath: string): string | null {
  const accounts = readJsonFile(join(geminiHomePath, "google_accounts.json"));
  if (Array.isArray(accounts)) {
    const first = accounts.find((account) => isRecord(account));
    for (const key of ["email", "account", "login"]) {
      const value = isRecord(first) ? first[key] : undefined;
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  if (isRecord(accounts)) {
    for (const key of ["email", "account", "login", "active"]) {
      const value = accounts[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  return null;
}

export function resolveGeminiAuthFromEnvironment(settings: GeminiSettings): ServerProviderAuth {
  const geminiHomePath = resolveGeminiHomePath(settings);
  const selectedAuthType = selectedAuthTypeFromSettings(geminiHomePath);
  const hasOAuthCredentials = existsSync(join(geminiHomePath, "oauth_creds.json"));
  const googleAccountLabel = cachedGoogleAccountLabel(geminiHomePath);

  if (process.env.GEMINI_API_KEY) {
    return {
      status: "authenticated",
      type: "api-key",
      label: selectedAuthType === "USE_GEMINI" ? "Gemini API key" : "GEMINI_API_KEY",
    };
  }

  if (selectedAuthType === "USE_GEMINI") {
    return {
      status: "unauthenticated",
      type: "api-key",
      label: "Missing GEMINI_API_KEY",
    };
  }

  if (selectedAuthType === "LOGIN_WITH_GOOGLE") {
    return hasOAuthCredentials
      ? {
          status: "authenticated",
          type: "google-login",
          label: googleAccountLabel ?? "Cached Google sign-in",
        }
      : {
          status: "unauthenticated",
          type: "google-login",
          label: "Run `gemini auth`",
        };
  }

  if (selectedAuthType === "USE_VERTEX_AI") {
    const hasVertexProjectLocation =
      Boolean(process.env.GOOGLE_CLOUD_PROJECT) && Boolean(process.env.GOOGLE_CLOUD_LOCATION);
    if (hasVertexProjectLocation || process.env.GOOGLE_API_KEY) {
      return {
        status: "authenticated",
        type: "vertex-ai",
        label: hasVertexProjectLocation ? "Vertex AI project" : "GOOGLE_API_KEY",
      };
    }
    return {
      status: "unauthenticated",
      type: "vertex-ai",
      label: "Missing Vertex AI environment",
    };
  }

  if (selectedAuthType === "COMPUTE_ADC") {
    return {
      status:
        process.env.GEMINI_CLI_USE_COMPUTE_ADC === "true" || process.env.CLOUD_SHELL === "true"
          ? "authenticated"
          : "unknown",
      type: "compute-adc",
      label: "Compute ADC",
    };
  }

  if (process.env.GOOGLE_API_KEY) {
    return { status: "authenticated", type: "api-key", label: "GOOGLE_API_KEY" };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      status: "unknown",
      type: "google-application-credentials",
      label: "Google Application Credentials",
    };
  }

  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID) {
    return { status: "unknown", type: "google-cloud", label: "Google Cloud project" };
  }

  if (hasOAuthCredentials) {
    return {
      status: "unknown",
      type: "google-login",
      label: googleAccountLabel ?? "Cached Google sign-in",
    };
  }

  if (selectedAuthType) {
    return {
      status: "unknown",
      type: selectedAuthType.toLowerCase().replaceAll("_", "-"),
      label: selectedAuthType,
    };
  }

  return {
    status: "unauthenticated",
    label: "Run `gemini auth` or set GEMINI_API_KEY.",
  };
}

const runGeminiCommand = Effect.fn("runGeminiCommand")(function* (args: ReadonlyArray<string>) {
  const geminiSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.gemini),
  );
  const command = ChildProcess.make(geminiSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(geminiSettings.homePath ? { GEMINI_CLI_HOME: geminiSettings.homePath } : {}),
    },
  });
  return yield* spawnAndCollect(geminiSettings.binaryPath, command);
});

export const checkGeminiProviderStatus = Effect.fn("checkGeminiProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const geminiSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.gemini),
    );
    const checkedAt = new Date().toISOString();
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      geminiSettings.customModels,
    );

    if (!geminiSettings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Gemini is disabled in T3 Code settings.",
        },
      });
    }

    const versionProbe = yield* runGeminiCommand(["--version"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: geminiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Gemini CLI not found. Install Gemini CLI or set the binary path in settings."
            : error instanceof Error
              ? error.message
              : "Unable to run Gemini CLI.",
        },
      });
    }

    if (versionProbe.success._tag === "None") {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: geminiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Timed out while checking Gemini CLI.",
        },
      });
    }

    const versionResult = versionProbe.success.value;
    if (versionResult.code !== 0) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: geminiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
          status: "error",
          auth: { status: "unknown" },
          message: detailFromResult(versionResult) ?? "Gemini CLI version check failed.",
        },
      });
    }

    const auth = resolveGeminiAuthFromEnvironment(geminiSettings);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: geminiSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
        status: "ready",
        auth,
        ...(auth.status === "unknown"
          ? {
              message:
                "Gemini CLI is installed. Authentication was not verified; cached Google sign-in may still work.",
            }
          : auth.status === "unauthenticated"
            ? {
                message:
                  "Gemini CLI is installed but authentication is missing. Run `gemini auth` or set GEMINI_API_KEY.",
              }
            : {}),
      },
    });
  },
);

export const GeminiProviderLive = Layer.effect(
  GeminiProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const checkProvider = checkGeminiProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    return yield* makeManagedServerProvider<GeminiSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.gemini),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.gemini),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
