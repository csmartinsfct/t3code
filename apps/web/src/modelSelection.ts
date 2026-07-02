import {
  baseProviderKind,
  type BaseProviderKind,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  modelSelectionProviderKind,
  type ModelSelection,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  makeProviderModelSelection,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { getComposerProviderState } from "./components/chat/composerProviderRegistry";
import { DEFAULT_UNIFIED_SETTINGS, UnifiedSettings } from "@t3tools/contracts/settings";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./providerModels";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;

export type ProviderCustomModelConfig = {
  provider: BaseProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<BaseProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
  gemini: {
    provider: "gemini",
    title: "Gemini",
    description: "Save additional Gemini model slugs for the picker and `/model` command.",
    placeholder: "your-gemini-model-slug",
    example: "gemini-3.1-pro-preview",
  },
  cursor: {
    provider: "cursor",
    title: "Cursor",
    description: "Save additional Cursor model slugs for the picker and `/model` command.",
    placeholder: "your-cursor-model-slug",
    example: "claude-sonnet-5",
  },
};

export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

export function isSecondaryInferenceProvider(provider: ProviderKind): boolean {
  return baseProviderKind(provider) !== "cursor";
}

export function getSecondaryInferenceProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  return providers.filter((provider) => isSecondaryInferenceProvider(provider.provider));
}

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(
    ({ slug, name, isCustom }) => ({
      slug,
      name,
      isCustom,
    }),
  );
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();
  const builtInModelSlugs = new Set(
    getProviderModels(providers, provider)
      .filter((model) => !model.isCustom)
      .map((model) => model.slug),
  );

  const customModels = settings.providers[baseProviderKind(provider)].customModels;
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

export function getCustomModelOptionsByProvider(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedProvider?: ProviderKind | null,
  selectedModel?: string | null,
): Record<BaseProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const selectedBaseProvider = selectedProvider ? baseProviderKind(selectedProvider) : null;

  return {
    codex: getAppModelOptions(
      settings,
      providers,
      "codex",
      selectedBaseProvider === "codex" ? selectedModel : undefined,
    ).map(({ slug, name }) => ({ slug, name })),
    claudeAgent: getAppModelOptions(
      settings,
      providers,
      "claudeAgent",
      selectedBaseProvider === "claudeAgent" ? selectedModel : undefined,
    ).map(({ slug, name }) => ({ slug, name })),
    gemini: getAppModelOptions(
      settings,
      providers,
      "gemini",
      selectedBaseProvider === "gemini" ? selectedModel : undefined,
    ).map(({ slug, name }) => ({ slug, name })),
    cursor: getAppModelOptions(
      settings,
      providers,
      "cursor",
      selectedBaseProvider === "cursor" ? selectedModel : undefined,
    ).map(({ slug, name }) => ({ slug, name })),
  };
}

export function makeAppModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ModelSelection["options"],
): ModelSelection {
  return makeProviderModelSelection(provider, model, options);
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    provider: "codex" as const,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
  };
  const requestedProvider = modelSelectionProviderKind(selection);
  const provider = resolveSelectableProvider(providers, requestedProvider);

  // When the provider changed due to fallback (e.g. selected provider was disabled),
  // don't carry over the old provider's model — use the fallback provider's default.
  const selectedModel = provider === requestedProvider ? selection.model : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: {
      [baseProviderKind(provider)]: provider === requestedProvider ? selection.options : undefined,
    },
  });

  return makeAppModelSelection(provider, model, modelOptionsForDispatch);
}

export function resolveSecondaryInferenceModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection;
  const secondarySettings =
    selection && baseProviderKind(modelSelectionProviderKind(selection)) === "cursor"
      ? {
          ...settings,
          textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
        }
      : settings;

  return resolveAppModelSelectionState(
    secondarySettings,
    getSecondaryInferenceProviders(providers),
  );
}
