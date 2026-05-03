import {
  ArchiveIcon,
  ArchiveX,
  Trash2Icon,
  ChevronDownIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  modelSelectionProviderKind,
  type BaseProviderKind,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type TicketSummary,
  type TicketingStreamEvent,
  ThreadId,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_REVIEW_ITERATIONS_UI_MAX,
} from "@t3tools/contracts/settings";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { Equal } from "effect";
import { APP_VERSION } from "../../branding";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import {
  MAX_CUSTOM_MODEL_LENGTH,
  getCustomModelOptionsByProvider,
  getSecondaryInferenceProviders,
  isSecondaryInferenceProvider,
  makeAppModelSelection,
  resolveAppModelSelectionState,
  resolveSecondaryInferenceModelSelectionState,
} from "../../modelSelection";
import { ensureNativeApi, readNativeApi } from "../../nativeApi";
import { useStore } from "../../store";
import { formatRelativeTime, formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  useServerAvailableEditors,
  useServerKeybindingsConfigPath,
  useServerObservability,
  useServerProviders,
} from "../../rpc/serverState";
import { clampReviewIterations } from "./settingsPanelHelpers";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

type InstallProviderSettings = {
  provider: BaseProviderKind;
  title: string;
  binaryPlaceholder: string;
  binaryDescription: ReactNode;
  homePathKey?: "codexHomePath" | "geminiHomePath";
  homePlaceholder?: string;
  homeDescription?: ReactNode;
  _profileProviderKind?: ProviderKind;
};

const PROVIDER_SETTINGS: readonly InstallProviderSettings[] = [
  {
    provider: "codex",
    title: "Codex",
    binaryPlaceholder: "Codex binary path",
    binaryDescription: "Path to the Codex binary",
    homePathKey: "codexHomePath",
    homePlaceholder: "CODEX_HOME",
    homeDescription: "Optional custom Codex home and config directory.",
  },
  {
    provider: "claudeAgent",
    title: "Claude",
    binaryPlaceholder: "Claude binary path",
    binaryDescription: "Path to the Claude binary",
  },
  {
    provider: "gemini",
    title: "Gemini",
    binaryPlaceholder: "Gemini binary path",
    binaryDescription: "Path to the Gemini CLI binary",
    homePathKey: "geminiHomePath",
    homePlaceholder: "GEMINI_CLI_HOME",
    homeDescription: "Optional custom Gemini CLI home and config directory.",
  },
  {
    provider: "cursor",
    title: "Cursor",
    binaryPlaceholder: "Cursor agent binary path",
    binaryDescription: "Path to the Cursor Agent CLI binary",
  },
] as const;

const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        provider.message ?? "This provider is installed but disabled for new sessions in T3 Code.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  return {
    headline: "Available",
    detail: provider.message ?? "Installed and ready, but authentication could not be verified.",
  };
}

function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

function useRelativeTimeTick(intervalMs = 1_000) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick();
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  );
}

export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  id,
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  id?: string;
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div id={id} className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {status ? <div className="pt-1 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsPageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">{children}</div>
    </div>
  );
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();

  const updateState = updateStateQuery.data ?? null;

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: error instanceof Error ? error.message : "Download failed.",
          });
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(
          updateState ?? { availableVersion: null, downloadedVersion: null },
        ),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "Install failed.",
          });
        });
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        setDesktopUpdateStateQueryData(queryClient, result.state);
        if (!result.checked) {
          toastManager.add({
            type: "error",
            title: "Could not check for updates",
            description:
              result.state.message ?? "Automatic updates are not available in this build.",
          });
        }
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not check for updates",
          description: error instanceof Error ? error.message : "Update check failed.",
        });
      });
  }, [queryClient, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : "Current version of the application.";

  return (
    <SettingsRow
      title={<AboutVersionTitle />}
      description={description}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant={action === "install" ? "default" : "outline"}
                disabled={buttonDisabled}
                onClick={handleButtonClick}
              >
                {buttonLabel}
              </Button>
            }
          />
          {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
        </Tooltip>
      }
    />
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { resetSettings } = useUpdateSettings();

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const areProviderSettingsDirty =
    PROVIDER_SETTINGS.some((providerSettings) => {
      const currentSettings = settings.providers[providerSettings.provider];
      const defaultSettings = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider];
      return !Equal.equals(currentSettings, defaultSettings);
    }) ||
    !Equal.equals(
      settings.providers.cursorProfiles,
      DEFAULT_UNIFIED_SETTINGS.providers.cursorProfiles,
    );

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(settings.maxReviewIterations !== DEFAULT_UNIFIED_SETTINGS.maxReviewIterations
        ? ["Automated review cycles"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.resumeAgentsOnStartup !== DEFAULT_UNIFIED_SETTINGS.resumeAgentsOnStartup
        ? ["Startup resume"]
        : []),
      ...(settings.idleSessionTimeoutMinutes !== DEFAULT_UNIFIED_SETTINGS.idleSessionTimeoutMinutes
        ? ["Idle session timeout"]
        : []),
      ...(settings.threadContentCacheMaxGB !== DEFAULT_UNIFIED_SETTINGS.threadContentCacheMaxGB
        ? ["Thread content cache"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(areProviderSettingsDirty ? ["Providers"] : []),
    ],
    [
      areProviderSettingsDirty,
      isGitWritingModelDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.defaultThreadEnvMode,
      settings.diffWordWrap,
      settings.enableAssistantStreaming,
      settings.idleSessionTimeoutMinutes,
      settings.maxReviewIterations,
      settings.resumeAgentsOnStartup,
      settings.threadContentCacheMaxGB,
      settings.timestampFormat,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readNativeApi();
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetSettings();
    onRestored?.();
  }, [changedSettingLabels, onRestored, resetSettings, setTheme]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

export function GeneralSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [openingPathByTarget, setOpeningPathByTarget] = useState({
    keybindings: false,
    logsDirectory: false,
  });
  const [openPathErrorByTarget, setOpenPathErrorByTarget] = useState<
    Partial<Record<"keybindings" | "logsDirectory", string | null>>
  >({});
  const [openProviderDetails, setOpenProviderDetails] = useState<Record<string, boolean>>({
    codex: Boolean(
      settings.providers.codex.binaryPath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.binaryPath ||
      settings.providers.codex.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.homePath ||
      settings.providers.codex.customModels.length > 0,
    ),
    claudeAgent: Boolean(
      settings.providers.claudeAgent.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.claudeAgent.binaryPath ||
      settings.providers.claudeAgent.customModels.length > 0,
    ),
    gemini: Boolean(
      settings.providers.gemini.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.gemini.binaryPath ||
      settings.providers.gemini.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.gemini.homePath ||
      settings.providers.gemini.customModels.length > 0,
    ),
    cursor: Boolean(
      settings.providers.cursor.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.cursor.binaryPath ||
      settings.providers.cursor.launchCommand.length > 0 ||
      settings.providers.cursor.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.cursor.homePath ||
      settings.providers.cursor.configDir !== DEFAULT_UNIFIED_SETTINGS.providers.cursor.configDir ||
      settings.providers.cursor.dataDir !== DEFAULT_UNIFIED_SETTINGS.providers.cursor.dataDir ||
      !Equal.equals(settings.providers.cursor.env, DEFAULT_UNIFIED_SETTINGS.providers.cursor.env) ||
      settings.providers.cursor.customModels.length > 0,
    ),
    ...Object.fromEntries(
      settings.providers.cursorProfiles.map((profile) => [
        `cursor:${profile.profileId}`,
        Boolean(
          profile.launchCommand.length > 0 ||
          profile.homePath ||
          profile.configDir ||
          profile.dataDir ||
          Object.keys(profile.env).length > 0 ||
          profile.customModels.length > 0,
        ),
      ]),
    ),
  });
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Partial<Record<ProviderKind, string>>
  >({
    codex: "",
    claudeAgent: "",
    gemini: "",
    cursor: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);
  const modelListRefs = useRef<Partial<Record<ProviderKind, HTMLDivElement | null>>>({});
  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void ensureNativeApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const availableEditors = useServerAvailableEditors();
  const observability = useServerObservability();
  const serverProviders = useServerProviders();
  const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
  const diagnosticsDescription = (() => {
    const exports: string[] = [];
    if (observability?.otlpTracesEnabled && observability.otlpTracesUrl) {
      exports.push(`traces to ${observability.otlpTracesUrl}`);
    }
    if (observability?.otlpMetricsEnabled && observability.otlpMetricsUrl) {
      exports.push(`metrics to ${observability.otlpMetricsUrl}`);
    }
    const mode = observability?.localTracingEnabled ? "Local trace file" : "Terminal logs only";
    return exports.length > 0 ? `${mode}. OTLP exporting ${exports.join(" and ")}.` : `${mode}.`;
  })();

  const secondaryInferenceProviders = getSecondaryInferenceProviders(serverProviders);
  const textGenerationModelSelection = resolveSecondaryInferenceModelSelectionState(
    settings,
    serverProviders,
  );
  const textGenProvider = modelSelectionProviderKind(textGenerationModelSelection);
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    textGenProvider,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const managedRunInferenceModelSelection = resolveSecondaryInferenceModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: settings.managedRunInferenceModelSelection,
    },
    serverProviders,
  );
  const managedRunInferenceProvider = modelSelectionProviderKind(managedRunInferenceModelSelection);
  const managedRunInferenceModel = managedRunInferenceModelSelection.model;
  const managedRunInferenceModelOptions = managedRunInferenceModelSelection.options;
  const managedRunInferenceOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    managedRunInferenceProvider,
    managedRunInferenceModel,
  );
  const isManagedRunInferenceModelDirty = !Equal.equals(
    settings.managedRunInferenceModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.managedRunInferenceModelSelection ?? null,
  );
  const orchestrationImplementerSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: settings.orchestrationImplementerModelSelection,
    },
    serverProviders,
  );
  const orchImplProvider = modelSelectionProviderKind(orchestrationImplementerSelection);
  const orchImplModel = orchestrationImplementerSelection.model;
  const orchImplModelOptions = orchestrationImplementerSelection.options;
  const orchImplOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    orchImplProvider,
    orchImplModel,
  );
  const isOrchImplModelDirty = !Equal.equals(
    settings.orchestrationImplementerModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.orchestrationImplementerModelSelection ?? null,
  );
  const orchestrationReviewerSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: settings.orchestrationReviewerModelSelection,
    },
    serverProviders,
  );
  const orchRevProvider = modelSelectionProviderKind(orchestrationReviewerSelection);
  const orchRevModel = orchestrationReviewerSelection.model;
  const orchRevModelOptions = orchestrationReviewerSelection.options;
  const orchRevOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    orchRevProvider,
    orchRevModel,
  );
  const isOrchRevModelDirty = !Equal.equals(
    settings.orchestrationReviewerModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.orchestrationReviewerModelSelection ?? null,
  );

  const openInPreferredEditor = useCallback(
    (target: "keybindings" | "logsDirectory", path: string | null, failureMessage: string) => {
      if (!path) return;
      setOpenPathErrorByTarget((existing) => ({ ...existing, [target]: null }));
      setOpeningPathByTarget((existing) => ({ ...existing, [target]: true }));

      const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
      if (!editor) {
        setOpenPathErrorByTarget((existing) => ({
          ...existing,
          [target]: "No available editors found.",
        }));
        setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        return;
      }

      void ensureNativeApi()
        .shell.openInEditor(path, editor)
        .catch((error) => {
          setOpenPathErrorByTarget((existing) => ({
            ...existing,
            [target]: error instanceof Error ? error.message : failureMessage,
          }));
        })
        .finally(() => {
          setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        });
    },
    [availableEditors],
  );

  const openKeybindingsFile = useCallback(() => {
    openInPreferredEditor("keybindings", keybindingsConfigPath, "Unable to open keybindings file.");
  }, [keybindingsConfigPath, openInPreferredEditor]);

  const openLogsDirectory = useCallback(() => {
    openInPreferredEditor("logsDirectory", logsDirectoryPath, "Unable to open logs folder.");
  }, [logsDirectoryPath, openInPreferredEditor]);

  const openKeybindingsError = openPathErrorByTarget.keybindings ?? null;
  const openDiagnosticsError = openPathErrorByTarget.logsDirectory ?? null;
  const isOpeningKeybindings = openingPathByTarget.keybindings;
  const isOpeningLogsDirectory = openingPathByTarget.logsDirectory;

  const addCustomModel = useCallback(
    (provider: BaseProviderKind, stateKey: ProviderKind = provider) => {
      const customModelInput = customModelInputByProvider[stateKey] ?? "";
      const customModels = settings.providers[provider].customModels;
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [stateKey]: "Enter a model slug.",
        }));
        return;
      }
      if (
        serverProviders
          .find((candidate) => candidate.provider === provider)
          ?.models.some((option) => !option.isCustom && option.slug === normalized)
      ) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [stateKey]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [stateKey]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [stateKey]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: [...customModels, normalized],
          },
        },
      });
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [stateKey]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [stateKey]: null,
      }));

      const el = modelListRefs.current[stateKey];
      if (!el) return;
      const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      requestAnimationFrame(scrollToEnd);
      const observer = new MutationObserver(() => {
        scrollToEnd();
        observer.disconnect();
      });
      observer.observe(el, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 2_000);
    },
    [customModelInputByProvider, serverProviders, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: BaseProviderKind, slug: string, stateKey: ProviderKind = provider) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: settings.providers[provider].customModels.filter(
              (model) => model !== slug,
            ),
          },
        },
      });
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [stateKey]: null,
      }));
    },
    [settings, updateSettings],
  );

  // Build provider cards from static settings + discovered profiles
  const allProviderSettings = useMemo(() => {
    const base = [...PROVIDER_SETTINGS];
    // Add entries for discovered provider profiles from server providers
    for (const sp of serverProviders) {
      const kind = sp.provider as string;
      if (kind === "codex" || kind === "claudeAgent" || kind === "gemini" || kind === "cursor") {
        continue;
      }
      if (kind.startsWith("codex:")) {
        base.push({
          provider: "codex" as BaseProviderKind,
          title: sp.displayName ?? sp.provider,
          binaryPlaceholder: "Codex binary path",
          binaryDescription: "Path to the Codex binary",
          homePathKey: "codexHomePath",
          homePlaceholder: "CODEX_HOME",
          homeDescription: "Codex profile home directory",
          _profileProviderKind: sp.provider as ProviderKind,
        });
      } else if (kind.startsWith("claudeAgent:")) {
        base.push({
          provider: "claudeAgent" as BaseProviderKind,
          title: sp.displayName ?? sp.provider,
          binaryPlaceholder: "Claude binary path",
          binaryDescription: "Path to the Claude binary",
          _profileProviderKind: sp.provider as ProviderKind,
        });
      } else if (kind.startsWith("cursor:")) {
        continue;
      }
    }
    return base;
  }, [serverProviders]);

  const providerCards = allProviderSettings.map((providerSettings) => {
    const effectiveProviderKind =
      (providerSettings as { _profileProviderKind?: ProviderKind })._profileProviderKind ??
      providerSettings.provider;
    const liveProvider = serverProviders.find(
      (candidate) => candidate.provider === effectiveProviderKind,
    );
    const providerConfig = settings.providers[providerSettings.provider];
    const defaultProviderConfig = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider];
    const homePathValue =
      providerSettings.homePathKey && "homePath" in providerConfig ? providerConfig.homePath : "";
    const statusKey = liveProvider?.status ?? (providerConfig.enabled ? "warning" : "disabled");
    const summary = getProviderSummary(liveProvider);
    const models: ReadonlyArray<ServerProviderModel> =
      liveProvider?.models ??
      providerConfig.customModels.map((slug) => ({
        slug,
        name: slug,
        isCustom: true,
        capabilities: null,
      }));

    return {
      provider: providerSettings.provider,
      providerKind: effectiveProviderKind,
      title: providerSettings.title,
      binaryPlaceholder: providerSettings.binaryPlaceholder,
      binaryDescription: providerSettings.binaryDescription,
      homePathKey: providerSettings.homePathKey,
      homePlaceholder: providerSettings.homePlaceholder,
      homeDescription: providerSettings.homeDescription,
      homePathValue,
      binaryPathValue: providerConfig.binaryPath,
      isDirty: !Equal.equals(providerConfig, defaultProviderConfig),
      liveProvider,
      models,
      providerConfig,
      statusStyle: PROVIDER_STATUS_STYLES[statusKey],
      summary,
      versionLabel: getProviderVersionLabel(liveProvider?.version),
    };
  });

  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;
  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          title="Theme"
          description="Choose how T3 Code looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label="Wrap diff lines by default"
            />
          }
        />

        <SettingsRow
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              onCheckedChange={(checked) =>
                updateSettings({ enableAssistantStreaming: Boolean(checked) })
              }
              aria-label="Stream assistant messages"
            />
          }
        />

        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Resume agents on startup"
          description="Automatically recover previously working threads and orchestration runs after the server restarts."
          resetAction={
            settings.resumeAgentsOnStartup !== DEFAULT_UNIFIED_SETTINGS.resumeAgentsOnStartup ? (
              <SettingResetButton
                label="startup resume"
                onClick={() =>
                  updateSettings({
                    resumeAgentsOnStartup: DEFAULT_UNIFIED_SETTINGS.resumeAgentsOnStartup,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.resumeAgentsOnStartup}
              onCheckedChange={(checked) =>
                updateSettings({ resumeAgentsOnStartup: Boolean(checked) })
              }
              aria-label="Resume agents on startup"
            />
          }
        />

        <SettingsRow
          title="Archive confirmation"
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label="Confirm thread archiving"
            />
          }
        />

        <SettingsRow
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />

        <SettingsRow
          title="Text generation model"
          description="Configure the model used for generated commit messages, PR titles, and similar Git text."
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={textGenProvider}
                model={textGenModel}
                lockedProvider={null}
                providers={secondaryInferenceProviders}
                providerFilter={isSecondaryInferenceProvider}
                modelOptionsByProvider={gitModelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(provider, model),
                      },
                      secondaryInferenceProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={
                  serverProviders.find((provider) => provider.provider === textGenProvider)
                    ?.models ?? []
                }
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveSecondaryInferenceModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(
                          textGenProvider,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />

        <SettingsRow
          title="Run inference model"
          description="Configure the model used to infer runtime services for managed runs before health validation begins."
          resetAction={
            isManagedRunInferenceModelDirty ? (
              <SettingResetButton
                label="run inference model"
                onClick={() =>
                  updateSettings({
                    managedRunInferenceModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.managedRunInferenceModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={managedRunInferenceProvider}
                model={managedRunInferenceModel}
                lockedProvider={null}
                providers={secondaryInferenceProviders}
                providerFilter={isSecondaryInferenceProvider}
                modelOptionsByProvider={managedRunInferenceOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    managedRunInferenceModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(provider, model),
                      },
                      secondaryInferenceProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={managedRunInferenceProvider}
                models={
                  serverProviders.find(
                    (provider) => provider.provider === managedRunInferenceProvider,
                  )?.models ?? []
                }
                model={managedRunInferenceModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={managedRunInferenceModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    managedRunInferenceModelSelection: resolveSecondaryInferenceModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(
                          managedRunInferenceProvider,
                          managedRunInferenceModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="Resource Management">
        <SettingsRow
          title="Conversation cache"
          description="How much memory the app uses to keep visited conversations ready. Older conversations are reloaded when you return to them. Set to 0 to keep everything in memory."
          resetAction={
            settings.threadContentCacheMaxGB !==
            DEFAULT_UNIFIED_SETTINGS.threadContentCacheMaxGB ? (
              <SettingResetButton
                label="conversation cache"
                onClick={() =>
                  updateSettings({
                    threadContentCacheMaxGB: DEFAULT_UNIFIED_SETTINGS.threadContentCacheMaxGB,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={String(settings.threadContentCacheMaxGB)}
              onValueChange={(value) => updateSettings({ threadContentCacheMaxGB: Number(value) })}
            >
              <SelectTrigger className="w-full sm:w-36" aria-label="Conversation cache">
                <SelectValue>
                  {settings.threadContentCacheMaxGB === 0
                    ? "Unlimited"
                    : `${settings.threadContentCacheMaxGB} GB`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="0">
                  Unlimited
                </SelectItem>
                <SelectItem hideIndicator value="1">
                  1 GB
                </SelectItem>
                <SelectItem hideIndicator value="2">
                  2 GB
                </SelectItem>
                <SelectItem hideIndicator value="4">
                  4 GB
                </SelectItem>
                <SelectItem hideIndicator value="8">
                  8 GB
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Idle session timeout"
          description="How long an inactive agent session stays alive before being shut down. Stopped sessions can be resumed but need a moment to restart."
          resetAction={
            settings.idleSessionTimeoutMinutes !==
            DEFAULT_UNIFIED_SETTINGS.idleSessionTimeoutMinutes ? (
              <SettingResetButton
                label="idle session timeout"
                onClick={() =>
                  updateSettings({
                    idleSessionTimeoutMinutes: DEFAULT_UNIFIED_SETTINGS.idleSessionTimeoutMinutes,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={String(settings.idleSessionTimeoutMinutes)}
              onValueChange={(value) =>
                updateSettings({ idleSessionTimeoutMinutes: Number(value) })
              }
            >
              <SelectTrigger className="w-full sm:w-36" aria-label="Idle session timeout">
                <SelectValue>
                  {settings.idleSessionTimeoutMinutes === 0
                    ? "Never"
                    : settings.idleSessionTimeoutMinutes < 60
                      ? `${settings.idleSessionTimeoutMinutes} min`
                      : `${settings.idleSessionTimeoutMinutes / 60} hr`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="0">
                  Never
                </SelectItem>
                <SelectItem hideIndicator value="30">
                  30 minutes
                </SelectItem>
                <SelectItem hideIndicator value="60">
                  1 hour
                </SelectItem>
                <SelectItem hideIndicator value="120">
                  2 hours
                </SelectItem>
                <SelectItem hideIndicator value="240">
                  4 hours
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Orchestration">
        <SettingsRow
          title="Implementer model"
          description="Configure the model used for implementation work during ticket orchestration."
          resetAction={
            isOrchImplModelDirty ? (
              <SettingResetButton
                label="implementer model"
                onClick={() =>
                  updateSettings({
                    orchestrationImplementerModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.orchestrationImplementerModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={orchImplProvider}
                model={orchImplModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={orchImplOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    orchestrationImplementerModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(provider, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={orchImplProvider}
                models={
                  serverProviders.find((provider) => provider.provider === orchImplProvider)
                    ?.models ?? []
                }
                model={orchImplModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={orchImplModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    orchestrationImplementerModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(
                          orchImplProvider,
                          orchImplModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />

        <SettingsRow
          title="Reviewer model"
          description="Configure the model used for automated code review during orchestration."
          resetAction={
            isOrchRevModelDirty ? (
              <SettingResetButton
                label="reviewer model"
                onClick={() =>
                  updateSettings({
                    orchestrationReviewerModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.orchestrationReviewerModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={orchRevProvider}
                model={orchRevModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={orchRevOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    orchestrationReviewerModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(provider, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={orchRevProvider}
                models={
                  serverProviders.find((provider) => provider.provider === orchRevProvider)
                    ?.models ?? []
                }
                model={orchRevModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={orchRevModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    orchestrationReviewerModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: makeAppModelSelection(
                          orchRevProvider,
                          orchRevModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />

        <SettingsRow
          id="automated-review-cycles"
          title="Automated review cycles"
          description="Set how many automated review-requested fix cycles orchestration can attempt. 0 disables automated review."
          resetAction={
            settings.maxReviewIterations !== DEFAULT_UNIFIED_SETTINGS.maxReviewIterations ? (
              <SettingResetButton
                label="automated review cycles"
                onClick={() =>
                  updateSettings({
                    maxReviewIterations: DEFAULT_UNIFIED_SETTINGS.maxReviewIterations,
                  })
                }
              />
            ) : null
          }
          control={
            <label className="flex items-center gap-2">
              <Input
                aria-label="Maximum automated review iterations"
                className="w-24"
                min={0}
                max={MAX_REVIEW_ITERATIONS_UI_MAX}
                step={1}
                type="number"
                value={settings.maxReviewIterations}
                onChange={(event) => {
                  const rawValue = Number(event.target.value);
                  if (!Number.isFinite(rawValue)) {
                    return;
                  }
                  const nextValue = clampReviewIterations(rawValue);
                  updateSettings({ maxReviewIterations: nextValue });
                }}
              />
              <span className="text-xs text-muted-foreground">
                0-{MAX_REVIEW_ITERATIONS_UI_MAX}
              </span>
            </label>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Providers"
        headerAction={
          <div className="flex items-center gap-1.5">
            <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={isRefreshingProviders}
                    onClick={() => void refreshProviders()}
                    aria-label="Refresh provider status"
                  >
                    {isRefreshingProviders ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                }
              />
              <TooltipPopup side="top">Refresh provider status</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {providerCards.map((providerCard) => {
          const customModelInput = customModelInputByProvider[providerCard.providerKind] ?? "";
          const customModelError = customModelErrorByProvider[providerCard.providerKind] ?? null;
          const providerDisplayName = providerCard.title;

          return (
            <div
              key={providerCard.providerKind}
              className="border-t border-border first:border-t-0"
            >
              <div className="px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-h-5 items-center gap-1.5">
                      <span
                        className={cn("size-2 shrink-0 rounded-full", providerCard.statusStyle.dot)}
                      />
                      <h3 className="text-sm font-medium text-foreground">{providerDisplayName}</h3>
                      {providerCard.versionLabel ? (
                        <code className="text-xs text-muted-foreground">
                          {providerCard.versionLabel}
                        </code>
                      ) : null}
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                        {providerCard.isDirty ? (
                          <SettingResetButton
                            label={`${providerDisplayName} provider settings`}
                            onClick={() => {
                              updateSettings({
                                providers: {
                                  ...settings.providers,
                                  [providerCard.provider]:
                                    DEFAULT_UNIFIED_SETTINGS.providers[providerCard.provider],
                                },
                              });
                              setCustomModelErrorByProvider((existing) => ({
                                ...existing,
                                [providerCard.providerKind]: null,
                              }));
                            }}
                          />
                        ) : null}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {providerCard.summary.headline}
                      {providerCard.summary.detail ? ` - ${providerCard.summary.detail}` : null}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setOpenProviderDetails((existing) => ({
                          ...existing,
                          [providerCard.providerKind]: !existing[providerCard.providerKind],
                        }))
                      }
                      aria-label={`Toggle ${providerDisplayName} details`}
                    >
                      <ChevronDownIcon
                        className={cn(
                          "size-3.5 transition-transform",
                          openProviderDetails[providerCard.providerKind] && "rotate-180",
                        )}
                      />
                    </Button>
                    <Switch
                      checked={providerCard.providerConfig.enabled}
                      onCheckedChange={(checked) => {
                        const isDisabling = !checked;
                        const shouldClearModelSelection =
                          isDisabling && textGenProvider === providerCard.provider;
                        updateSettings({
                          providers: {
                            ...settings.providers,
                            [providerCard.provider]: {
                              ...settings.providers[providerCard.provider],
                              enabled: Boolean(checked),
                            },
                          },
                          ...(shouldClearModelSelection
                            ? {
                                textGenerationModelSelection:
                                  DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                              }
                            : {}),
                        });
                      }}
                      aria-label={`Enable ${providerDisplayName}`}
                    />
                  </div>
                </div>
              </div>

              <Collapsible
                open={openProviderDetails[providerCard.providerKind] ?? false}
                onOpenChange={(open) =>
                  setOpenProviderDetails((existing) => ({
                    ...existing,
                    [providerCard.providerKind]: open,
                  }))
                }
              >
                <CollapsibleContent>
                  <div className="space-y-0">
                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <label
                        htmlFor={`provider-install-${providerCard.providerKind}-binary-path`}
                        className="block"
                      >
                        <span className="text-xs font-medium text-foreground">
                          {providerDisplayName} binary path
                        </span>
                        <Input
                          id={`provider-install-${providerCard.providerKind}-binary-path`}
                          className="mt-1.5"
                          value={providerCard.binaryPathValue}
                          onChange={(event) =>
                            updateSettings({
                              providers: {
                                ...settings.providers,
                                [providerCard.provider]: {
                                  ...settings.providers[providerCard.provider],
                                  binaryPath: event.target.value,
                                },
                              },
                            })
                          }
                          placeholder={providerCard.binaryPlaceholder}
                          spellCheck={false}
                        />
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {providerCard.binaryDescription}
                        </span>
                      </label>
                    </div>

                    {providerCard.homePathKey ? (
                      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                        <label
                          htmlFor={`provider-install-${providerCard.homePathKey}`}
                          className="block"
                        >
                          <span className="text-xs font-medium text-foreground">
                            {providerDisplayName} home path
                          </span>
                          <Input
                            id={`provider-install-${providerCard.homePathKey}`}
                            className="mt-1.5"
                            value={providerCard.homePathValue}
                            onChange={(event) =>
                              updateSettings({
                                providers: {
                                  ...settings.providers,
                                  [providerCard.provider]: {
                                    ...settings.providers[providerCard.provider],
                                    homePath: event.target.value,
                                  },
                                },
                              })
                            }
                            placeholder={providerCard.homePlaceholder}
                            spellCheck={false}
                          />
                          {providerCard.homeDescription ? (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {providerCard.homeDescription}
                            </span>
                          ) : null}
                        </label>
                      </div>
                    ) : null}

                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <div className="text-xs font-medium text-foreground">Models</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {providerCard.models.length} model
                        {providerCard.models.length === 1 ? "" : "s"} available.
                      </div>
                      <div
                        ref={(el) => {
                          modelListRefs.current[providerCard.providerKind] = el;
                        }}
                        className="mt-2 max-h-40 overflow-y-auto pb-1"
                      >
                        {providerCard.models.map((model) => {
                          const caps = model.capabilities;
                          const capLabels: string[] = [];
                          if (caps?.supportsFastMode) capLabels.push("Fast mode");
                          if (caps?.supportsThinkingToggle) capLabels.push("Thinking");
                          if (
                            caps?.reasoningEffortLevels &&
                            caps.reasoningEffortLevels.length > 0
                          ) {
                            capLabels.push("Reasoning");
                          }
                          const hasDetails = capLabels.length > 0 || model.name !== model.slug;

                          return (
                            <div
                              key={`${providerCard.provider}:${model.slug}`}
                              className="flex items-center gap-2 py-1"
                            >
                              <span className="min-w-0 truncate text-xs text-foreground/90">
                                {model.name}
                              </span>
                              {hasDetails ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <button
                                        type="button"
                                        className="shrink-0 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                                        aria-label={`Details for ${model.name}`}
                                      />
                                    }
                                  >
                                    <InfoIcon className="size-3" />
                                  </TooltipTrigger>
                                  <TooltipPopup side="top" className="max-w-56">
                                    <div className="space-y-1">
                                      <code className="block text-[11px] text-foreground">
                                        {model.slug}
                                      </code>
                                      {capLabels.length > 0 ? (
                                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                          {capLabels.map((label) => (
                                            <span
                                              key={label}
                                              className="text-[10px] text-muted-foreground"
                                            >
                                              {label}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  </TooltipPopup>
                                </Tooltip>
                              ) : null}
                              {model.isCustom ? (
                                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                  <span className="text-[10px] text-muted-foreground">custom</span>
                                  <button
                                    type="button"
                                    className="text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label={`Remove ${model.slug}`}
                                    onClick={() =>
                                      removeCustomModel(
                                        providerCard.provider,
                                        model.slug,
                                        providerCard.providerKind,
                                      )
                                    }
                                  >
                                    <XIcon className="size-3" />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Input
                          id={`custom-model-${providerCard.providerKind}`}
                          value={customModelInput}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCustomModelInputByProvider((existing) => ({
                              ...existing,
                              [providerCard.providerKind]: value,
                            }));
                            if (customModelError) {
                              setCustomModelErrorByProvider((existing) => ({
                                ...existing,
                                [providerCard.providerKind]: null,
                              }));
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            addCustomModel(providerCard.provider, providerCard.providerKind);
                          }}
                          placeholder={
                            providerCard.provider === "codex"
                              ? "gpt-6.7-codex-ultra-preview"
                              : providerCard.provider === "gemini"
                                ? "gemini-3.1-pro-preview"
                                : providerCard.provider === "cursor"
                                  ? "claude-sonnet-4-6"
                                  : "claude-sonnet-5-0"
                          }
                          spellCheck={false}
                        />
                        <Button
                          className="shrink-0"
                          variant="outline"
                          onClick={() =>
                            addCustomModel(providerCard.provider, providerCard.providerKind)
                          }
                        >
                          <PlusIcon className="size-3.5" />
                          Add
                        </Button>
                      </div>

                      {customModelError ? (
                        <p className="mt-2 text-xs text-destructive">{customModelError}</p>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsRow
          title="Keybindings"
          description="Open the persisted `keybindings.json` file to edit advanced bindings directly."
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openKeybindingsError ? (
                <span className="mt-1 block text-destructive">{openKeybindingsError}</span>
              ) : (
                <span className="mt-1 block">Opens in your preferred editor.</span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath || isOpeningKeybindings}
              onClick={openKeybindingsFile}
            >
              {isOpeningKeybindings ? "Opening..." : "Open file"}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="About">
        {isElectron ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description="Current version of the application."
          />
        )}
        <SettingsRow
          title="Diagnostics"
          description={diagnosticsDescription}
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </span>
              {openDiagnosticsError ? (
                <span className="mt-1 block text-destructive">{openDiagnosticsError}</span>
              ) : null}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!logsDirectoryPath || isOpeningLogsDirectory}
              onClick={openLogsDirectory}
            >
              {isOpeningLogsDirectory ? "Opening..." : "Open logs folder"}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const { unarchiveThread, deleteThreadBatch, confirmAndDeleteThread } = useThreadActions();
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const archivedGroups = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project] as const));
    return [...projectById.values()]
      .map((project) => ({
        project,
        threads: threads
          .filter((thread) => thread.projectId === project.id && thread.archivedAt !== null)
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [projects, threads]);

  const allArchivedThreadIds = useMemo(
    () => archivedGroups.flatMap(({ threads: t }) => t.map((thread) => thread.id)),
    [archivedGroups],
  );

  const handleDeleteAllArchived = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    const count = allArchivedThreadIds.length;
    if (count === 0) return;

    const confirmed = await api.dialogs.confirm(
      [
        `Delete ${count} archived thread${count === 1 ? "" : "s"}?`,
        "This permanently clears conversation history for these threads.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setIsDeletingAll(true);
    try {
      await deleteThreadBatch(allArchivedThreadIds);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to delete archived threads",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsDeletingAll(false);
    }
  }, [allArchivedThreadIds, deleteThreadBatch]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadId);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to unarchive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (clicked === "delete") {
        await confirmAndDeleteThread(threadId);
      }
    },
    [confirmAndDeleteThread, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <ArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived threads</EmptyTitle>
              <EmptyDescription>Archived threads will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection
            title="Archived threads"
            headerAction={
              <Button
                type="button"
                variant="destructive-outline"
                size="sm"
                className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                disabled={isDeletingAll}
                onClick={() => void handleDeleteAllArchived()}
              >
                {isDeletingAll ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <Trash2Icon className="size-3.5" />
                )}
                <span>{isDeletingAll ? "Deleting..." : "Delete all"}</span>
              </Button>
            }
          >
            <div />
          </SettingsSection>
          {archivedGroups.map(({ project, threads: projectThreads }) => (
            <SettingsSection
              key={project.id}
              title={project.name}
              icon={<ProjectFavicon cwd={project.cwd} />}
            >
              {projectThreads.map((thread) => (
                <div
                  key={thread.id}
                  className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void handleArchivedThreadContextMenu(thread.id, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">{thread.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                      {" \u00b7 Created "}
                      {formatRelativeTimeLabel(thread.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                    disabled={isDeletingAll}
                    onClick={() =>
                      void unarchiveThread(thread.id).catch((error) => {
                        toastManager.add({
                          type: "error",
                          title: "Failed to unarchive thread",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        });
                      })
                    }
                  >
                    <ArchiveX className="size-3.5" />
                    <span>Unarchive</span>
                  </Button>
                </div>
              ))}
            </SettingsSection>
          ))}
        </>
      )}
    </SettingsPageContainer>
  );
}

// ---------------------------------------------------------------------------
// Archived tickets panel
// ---------------------------------------------------------------------------

interface ArchivedTicketsByProject {
  readonly project: { id: string; name: string; cwd: string };
  readonly tickets: ReadonlyArray<TicketSummary>;
}

function useArchivedTicketsByProject(): {
  groups: ReadonlyArray<ArchivedTicketsByProject>;
  refetch: () => Promise<void>;
  loading: boolean;
} {
  const projects = useStore((store) => store.projects);
  const [byProject, setByProject] = useState<ReadonlyMap<string, ReadonlyArray<TicketSummary>>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    const results = await Promise.all(
      projects.map(async (project) => {
        try {
          const tickets = await api.ticketing.list({
            projectId: project.id as never,
            includeArchived: true,
          });
          return [project.id, tickets.filter((t) => t.isArchived)] as const;
        } catch (error) {
          console.error("Failed to list archived tickets for project", project.id, error);
          return [project.id, [] as ReadonlyArray<TicketSummary>] as const;
        }
      }),
    );
    setByProject(new Map(results));
    setLoading(false);
  }, [projects]);

  useEffect(() => {
    setLoading(true);
    void fetchAll();
  }, [fetchAll]);

  // Keep the view in sync with ticketing events. Any upsert/delete in an archived
  // context should refresh; do a debounced refetch rather than diff the events.
  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void fetchAll();
      }, 100);
    };
    return api.ticketing.onEvent((_event: TicketingStreamEvent) => {
      schedule();
    });
  }, [fetchAll]);

  const groups = useMemo<ReadonlyArray<ArchivedTicketsByProject>>(() => {
    return projects
      .map((project) => ({
        project,
        tickets: (byProject.get(project.id) ?? []).toSorted((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      }))
      .filter((group) => group.tickets.length > 0);
  }, [projects, byProject]);

  return { groups, refetch: fetchAll, loading };
}

export function ArchivedTicketsPanel() {
  const { groups, refetch } = useArchivedTicketsByProject();
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const allArchivedIds = useMemo(
    () => groups.flatMap(({ tickets }) => tickets.map((t) => t.id)),
    [groups],
  );

  const unarchive = useCallback(
    async (ticket: TicketSummary) => {
      const api = readNativeApi();
      if (!api) return;
      setBusyTicketId(ticket.id as string);
      try {
        await api.ticketing.unarchive({ id: ticket.id });
        await refetch();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to unarchive ticket",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      } finally {
        setBusyTicketId(null);
      }
    },
    [refetch],
  );

  const deleteTicket = useCallback(
    async (ticket: TicketSummary) => {
      const api = readNativeApi();
      if (!api) return;
      const confirmed = await api.dialogs.confirm(
        [
          `Delete "${ticket.identifier}: ${ticket.title}"?`,
          "This permanently removes the ticket and its data. This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) return;
      setBusyTicketId(ticket.id as string);
      try {
        await api.ticketing.delete({ id: ticket.id });
        await refetch();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to delete ticket",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      } finally {
        setBusyTicketId(null);
      }
    },
    [refetch],
  );

  const handleDeleteAll = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    const count = allArchivedIds.length;
    if (count === 0) return;
    const confirmed = await api.dialogs.confirm(
      [
        `Delete ${count} archived ticket${count === 1 ? "" : "s"}?`,
        "This permanently removes these tickets and their data. This action cannot be undone.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setIsDeletingAll(true);
    try {
      await Promise.all(allArchivedIds.map((id) => api.ticketing.delete({ id })));
      await refetch();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to delete archived tickets",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsDeletingAll(false);
    }
  }, [allArchivedIds, refetch]);

  const handleContextMenu = useCallback(
    async (ticket: TicketSummary, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );
      if (clicked === "unarchive") {
        await unarchive(ticket);
      } else if (clicked === "delete") {
        await deleteTicket(ticket);
      }
    },
    [deleteTicket, unarchive],
  );

  return (
    <SettingsPageContainer>
      {groups.length === 0 ? (
        <SettingsSection title="Archived tickets">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <ArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived tickets</EmptyTitle>
              <EmptyDescription>Archived tickets will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection
            title="Archived tickets"
            headerAction={
              <Button
                type="button"
                variant="destructive-outline"
                size="sm"
                className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                disabled={isDeletingAll}
                onClick={() => void handleDeleteAll()}
              >
                {isDeletingAll ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <Trash2Icon className="size-3.5" />
                )}
                <span>{isDeletingAll ? "Deleting..." : "Delete all"}</span>
              </Button>
            }
          >
            <div />
          </SettingsSection>
          {groups.map(({ project, tickets }) => (
            <SettingsSection
              key={project.id}
              title={project.name}
              icon={<ProjectFavicon cwd={project.cwd} />}
            >
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void handleContextMenu(ticket, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">
                      <span className="text-muted-foreground">{ticket.identifier}</span>{" "}
                      {ticket.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatRelativeTimeLabel(ticket.updatedAt)}
                      {" \u00b7 Created "}
                      {formatRelativeTimeLabel(ticket.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                    disabled={busyTicketId === ticket.id || isDeletingAll}
                    onClick={() => void unarchive(ticket)}
                  >
                    <ArchiveX className="size-3.5" />
                    <span>Unarchive</span>
                  </Button>
                </div>
              ))}
            </SettingsSection>
          ))}
        </>
      )}
    </SettingsPageContainer>
  );
}
