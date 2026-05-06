import { useCallback, useMemo, useState } from "react";
import { PencilIcon, RotateCcwIcon } from "lucide-react";
import type { ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import {
  DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT,
  validateDynamicChatUiBuilderPromptTemplate,
} from "@t3tools/shared/dynamicChatUiBuilderPrompt";

import defaultDesignLanguage from "../../../../../docs/design-language.md?raw";
import { ensureNativeApi } from "../../nativeApi";
import { applySettingsUpdated, useServerSettings } from "../../rpc/serverState";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsSection } from "./SettingsPanels";

type DynamicUiEditable = "designGuide" | "builderPrompt";

const DYNAMIC_CHAT_UI_PROMPT_EDITOR_OVERLAY_ROUTE_KEY = "dynamic-chat-ui-prompt-editor";

type DynamicChatUiPromptEditorResult = {
  action: "saved" | "reset";
  settings: ServerSettings;
};

interface EditableConfig {
  readonly id: DynamicUiEditable;
  readonly title: string;
  readonly dialogTitle: string;
  readonly description: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly savedTitle: string;
  readonly resetTitle: string;
  readonly saveFailedTitle: string;
  readonly resetFailedTitle: string;
  readonly defaultValue: string;
  readonly overrideValue: string | null;
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length;
}

function hasTextOverride(value: string | null): value is string {
  return Boolean(value && value.trim().length > 0);
}

function validateDraft(config: EditableConfig, draft: string): string | null {
  if (!draft.trim()) return config.emptyDescription;
  if (config.id !== "builderPrompt") return null;

  const missing = validateDynamicChatUiBuilderPromptTemplate(draft);
  if (missing.length === 0) return null;
  return `Missing required placeholder(s): ${missing.join(", ")}`;
}

async function persistEditable(
  id: DynamicUiEditable,
  value: string | null,
): Promise<ServerSettings> {
  const patch = {
    dynamicChatUi:
      id === "designGuide" ? { designGuideOverride: value } : { builderPromptOverride: value },
  } satisfies ServerSettingsPatch;
  const settings = await ensureNativeApi().server.updateSettings(patch);
  applySettingsUpdated(settings);
  return settings;
}

export function DynamicChatUiPromptSection() {
  const dynamicChatUiSettings = useServerSettings().dynamicChatUi;
  const [editing, setEditing] = useState<DynamicUiEditable | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const configs = useMemo(
    () =>
      [
        {
          id: "designGuide",
          title: "Design Language",
          dialogTitle: "Dynamic UI Design Language",
          description: "Design guide used by the hidden Dynamic UI builder.",
          emptyTitle: "Design guide is empty",
          emptyDescription: "Dynamic UI generation needs a design guide to stay consistent.",
          savedTitle: "Dynamic UI design guide saved",
          resetTitle: "Dynamic UI design guide reset",
          saveFailedTitle: "Failed to save design guide",
          resetFailedTitle: "Failed to reset design guide",
          defaultValue: defaultDesignLanguage,
          overrideValue: dynamicChatUiSettings.designGuideOverride,
        },
        {
          id: "builderPrompt",
          title: "Builder Prompt",
          dialogTitle: "Dynamic UI Builder Prompt",
          description:
            "Wrapper prompt sent to the hidden builder model around the request, data, prior artifact, and design guide.",
          emptyTitle: "Builder prompt is empty",
          emptyDescription: "Dynamic UI generation needs a builder prompt template.",
          savedTitle: "Dynamic UI builder prompt saved",
          resetTitle: "Dynamic UI builder prompt reset",
          saveFailedTitle: "Failed to save builder prompt",
          resetFailedTitle: "Failed to reset builder prompt",
          defaultValue: DYNAMIC_CHAT_UI_BUILDER_PROMPT_DEFAULT,
          overrideValue: dynamicChatUiSettings.builderPromptOverride,
        },
      ] as const satisfies readonly EditableConfig[],
    [dynamicChatUiSettings.builderPromptOverride, dynamicChatUiSettings.designGuideOverride],
  );

  const activeConfig = configs.find((config) => config.id === editing) ?? null;
  const activeEffectiveValue = activeConfig
    ? hasTextOverride(activeConfig.overrideValue)
      ? activeConfig.overrideValue
      : activeConfig.defaultValue
    : "";

  const routed = useRoutedOverlaySurface<DynamicChatUiPromptEditorResult>({
    open: editing !== null,
    onOpenChange: (open) => {
      if (!open) closeEditor();
    },
    routeKey: DYNAMIC_CHAT_UI_PROMPT_EDITOR_OVERLAY_ROUTE_KEY,
    params: { config: activeConfig },
    presentation: { kind: "dialog" },
    enabled: activeConfig !== null,
    onResult: (result) => {
      applySettingsUpdated(result.settings);
      setEditing(null);
    },
  });

  const openEditor = useCallback((config: EditableConfig) => {
    setDraft(hasTextOverride(config.overrideValue) ? config.overrideValue : config.defaultValue);
    setEditing(config.id);
  }, []);

  const closeEditor = useCallback(() => {
    if (saving) return;
    setEditing(null);
  }, [saving]);

  const saveDraft = useCallback(async () => {
    if (!activeConfig) return;
    const validationError = validateDraft(activeConfig, draft);
    if (validationError) {
      toastManager.add({
        type: "error",
        title: activeConfig.emptyTitle,
        description: validationError,
      });
      return;
    }

    setSaving(true);
    try {
      await persistEditable(activeConfig.id, draft === activeConfig.defaultValue ? null : draft);
      toastManager.add({ type: "success", title: activeConfig.savedTitle });
      setEditing(null);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: activeConfig.saveFailedTitle,
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }, [activeConfig, draft]);

  const resetToOriginal = useCallback(async (config: EditableConfig) => {
    setSaving(true);
    try {
      await persistEditable(config.id, null);
      setDraft(config.defaultValue);
      toastManager.add({ type: "success", title: config.resetTitle });
      setEditing(null);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: config.resetFailedTitle,
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const resetEditorToOriginal = useCallback(async () => {
    if (!activeConfig) return;
    if (!hasTextOverride(activeConfig.overrideValue)) {
      setDraft(activeConfig.defaultValue);
      return;
    }
    await resetToOriginal(activeConfig);
  }, [activeConfig, resetToOriginal]);

  return (
    <>
      <SettingsSection title="Dynamic UI">
        {configs.map((config) => {
          const hasOverride = hasTextOverride(config.overrideValue);
          const effectiveValue = hasOverride ? config.overrideValue : config.defaultValue;
          return (
            <div
              key={config.id}
              className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-h-5 items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{config.title}</h3>
                    <Badge variant={hasOverride ? "info" : "outline"} size="sm">
                      {hasOverride ? "Customized" : "Default"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {config.description} {lineCount(effectiveValue).toLocaleString()} lines.
                  </p>
                </div>
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                  {hasOverride ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void resetToOriginal(config)}
                    >
                      <RotateCcwIcon className="size-3" />
                      Reset
                    </Button>
                  ) : null}
                  <Button size="xs" variant="outline" onClick={() => openEditor(config)}>
                    <PencilIcon className="size-3" />
                    Edit
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </SettingsSection>

      <Dialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
        <DialogPopup className="max-w-5xl">
          <DynamicChatUiPromptEditorContent
            activeConfig={activeConfig}
            activeEffectiveValue={activeEffectiveValue}
            draft={draft}
            onCancel={closeEditor}
            onDraftChange={setDraft}
            onReset={resetEditorToOriginal}
            onSave={saveDraft}
            saving={saving}
          />
        </DialogPopup>
      </Dialog>
    </>
  );
}

function DynamicChatUiPromptEditorContent({
  activeConfig,
  activeEffectiveValue,
  draft,
  onCancel,
  onDraftChange,
  onReset,
  onSave,
  saving,
}: {
  activeConfig: EditableConfig | null;
  activeEffectiveValue: string;
  draft: string;
  onCancel: () => void;
  onDraftChange: (draft: string) => void;
  onReset: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  saving: boolean;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{activeConfig?.dialogTitle ?? "Dynamic UI"}</DialogTitle>
        <DialogDescription>
          {activeConfig?.id === "builderPrompt"
            ? "Keep the {{...}} placeholders and delimiter contract intact; reset restores the shipped template."
            : "Edits here override docs/design-language.md for generated chat UI artifacts."}
        </DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <Textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="h-[60vh] min-h-96 resize-none font-mono text-xs"
          spellCheck={false}
        />
      </DialogPanel>

      <DialogFooter>
        <div className="flex w-full items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={
              saving ||
              !activeConfig ||
              (draft === activeConfig.defaultValue && !hasTextOverride(activeConfig.overrideValue))
            }
            onClick={() => void onReset()}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset to original
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !activeConfig || draft === activeEffectiveValue}
              onClick={() => void onSave()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </>
  );
}

registerOverlayRoute<{ config?: unknown }>(
  DYNAMIC_CHAT_UI_PROMPT_EDITOR_OVERLAY_ROUTE_KEY,
  function DynamicChatUiPromptEditorOverlayRoute({ message, controller }) {
    const activeConfig = readEditableConfigParam(message.params.config);
    const [draft, setDraft] = useState(() =>
      activeConfig
        ? hasTextOverride(activeConfig.overrideValue)
          ? activeConfig.overrideValue
          : activeConfig.defaultValue
        : "",
    );
    const [saving, setSaving] = useState(false);

    const activeEffectiveValue = activeConfig
      ? hasTextOverride(activeConfig.overrideValue)
        ? activeConfig.overrideValue
        : activeConfig.defaultValue
      : "";

    const saveDraft = useCallback(async () => {
      if (!activeConfig) return;
      const validationError = validateDraft(activeConfig, draft);
      if (validationError) {
        toastManager.add({
          type: "error",
          title: activeConfig.emptyTitle,
          description: validationError,
        });
        return;
      }

      setSaving(true);
      try {
        const settings = await persistEditable(
          activeConfig.id,
          draft === activeConfig.defaultValue ? null : draft,
        );
        toastManager.add({ type: "success", title: activeConfig.savedTitle });
        controller.submit({ action: "saved", settings });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: activeConfig.saveFailedTitle,
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setSaving(false);
      }
    }, [activeConfig, controller, draft]);

    const resetEditorToOriginal = useCallback(async () => {
      if (!activeConfig) return;
      if (!hasTextOverride(activeConfig.overrideValue)) {
        setDraft(activeConfig.defaultValue);
        return;
      }

      setSaving(true);
      try {
        const settings = await persistEditable(activeConfig.id, null);
        setDraft(activeConfig.defaultValue);
        toastManager.add({ type: "success", title: activeConfig.resetTitle });
        controller.submit({ action: "reset", settings });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: activeConfig.resetFailedTitle,
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setSaving(false);
      }
    }, [activeConfig, controller]);

    return (
      <OverlayRouteDialog>
        <DialogPopup className="max-w-5xl">
          <DynamicChatUiPromptEditorContent
            activeConfig={activeConfig}
            activeEffectiveValue={activeEffectiveValue}
            draft={draft}
            onCancel={() => controller.cancel("cancel")}
            onDraftChange={setDraft}
            onReset={resetEditorToOriginal}
            onSave={saveDraft}
            saving={saving}
          />
        </DialogPopup>
      </OverlayRouteDialog>
    );
  },
);

function readEditableConfigParam(value: unknown): EditableConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EditableConfig>;
  if (candidate.id !== "designGuide" && candidate.id !== "builderPrompt") return null;
  if (typeof candidate.title !== "string") return null;
  if (typeof candidate.dialogTitle !== "string") return null;
  if (typeof candidate.description !== "string") return null;
  if (typeof candidate.emptyTitle !== "string") return null;
  if (typeof candidate.emptyDescription !== "string") return null;
  if (typeof candidate.savedTitle !== "string") return null;
  if (typeof candidate.resetTitle !== "string") return null;
  if (typeof candidate.saveFailedTitle !== "string") return null;
  if (typeof candidate.resetFailedTitle !== "string") return null;
  if (typeof candidate.defaultValue !== "string") return null;
  if (candidate.overrideValue !== null && typeof candidate.overrideValue !== "string") return null;
  return {
    id: candidate.id,
    title: candidate.title,
    dialogTitle: candidate.dialogTitle,
    description: candidate.description,
    emptyTitle: candidate.emptyTitle,
    emptyDescription: candidate.emptyDescription,
    savedTitle: candidate.savedTitle,
    resetTitle: candidate.resetTitle,
    saveFailedTitle: candidate.saveFailedTitle,
    resetFailedTitle: candidate.resetFailedTitle,
    defaultValue: candidate.defaultValue,
    overrideValue: candidate.overrideValue,
  };
}
