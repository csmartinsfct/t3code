/**
 * FileExplorerSettingsPanel — editor customisation panel rendered inside the
 * file explorer, replacing the tree + editor area.
 *
 * Design language matches SettingsPanels.tsx exactly:
 *   - Section header: 11px uppercase tracked muted label
 *   - Card container: rounded-2xl border bg-card with pseudo-element shadow
 *   - Rows: border-t divided, title + description + right-aligned Select
 *   - Per-row reset button (Undo2Icon) shown when value ≠ default
 */
import { Settings2Icon, Undo2Icon } from "lucide-react";
import type { ReactNode } from "react";

import {
  DEFAULT_EDITOR_SETTINGS,
  FONT_FAMILY_LABELS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_LABELS,
  FONT_SIZE_OPTIONS,
  THEME_LABELS,
  THEME_OPTIONS,
  useFileExplorerEditorSettingsStore,
  type EditorFontFamily,
  type EditorFontSize,
  type EditorTheme,
} from "~/fileExplorerEditorSettingsStore";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

// ─── Local design-system primitives (matching SettingsPanels.tsx) ─────────────

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <Settings2Icon className="size-3" />
          {title}
        </h2>
      </div>
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  resetAction,
  control,
}: {
  title: string;
  description: string;
  resetAction?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
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

// ─── Panel ────────────────────────────────────────────────────────────────────

export function FileExplorerSettingsPanel() {
  const { settings, updateSettings } = useFileExplorerEditorSettingsStore();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          <SettingsSection title="Editor">
            {/* Theme */}
            <SettingsRow
              title="Theme"
              description="Color theme for the code editor."
              resetAction={
                settings.theme !== DEFAULT_EDITOR_SETTINGS.theme ? (
                  <SettingResetButton
                    label="theme"
                    onClick={() => updateSettings({ theme: DEFAULT_EDITOR_SETTINGS.theme })}
                  />
                ) : null
              }
              control={
                <Select
                  value={settings.theme}
                  onValueChange={(value) => {
                    if (THEME_OPTIONS.includes(value as EditorTheme)) {
                      updateSettings({ theme: value as EditorTheme });
                    }
                  }}
                  overlayItems={THEME_OPTIONS.map((theme) => ({
                    value: theme,
                    label: THEME_LABELS[theme],
                    hideIndicator: true,
                  }))}
                  overlayAlignItemWithTrigger={false}
                >
                  <SelectTrigger className="w-full sm:w-44" aria-label="Editor theme">
                    <SelectValue>{THEME_LABELS[settings.theme]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {THEME_OPTIONS.map((t) => (
                      <SelectItem hideIndicator key={t} value={t}>
                        {THEME_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />

            {/* Font size */}
            <SettingsRow
              title="Font size"
              description="Code text size in the editor."
              resetAction={
                settings.fontSize !== DEFAULT_EDITOR_SETTINGS.fontSize ? (
                  <SettingResetButton
                    label="font size"
                    onClick={() => updateSettings({ fontSize: DEFAULT_EDITOR_SETTINGS.fontSize })}
                  />
                ) : null
              }
              control={
                <Select
                  value={String(settings.fontSize)}
                  onValueChange={(value) => {
                    const n = Number(value) as EditorFontSize;
                    if (FONT_SIZE_OPTIONS.includes(n)) {
                      updateSettings({ fontSize: n });
                    }
                  }}
                  overlayItems={FONT_SIZE_OPTIONS.map((size) => ({
                    value: String(size),
                    label: FONT_SIZE_LABELS[size],
                    hideIndicator: true,
                  }))}
                  overlayAlignItemWithTrigger={false}
                >
                  <SelectTrigger className="w-full sm:w-28" aria-label="Editor font size">
                    <SelectValue>{FONT_SIZE_LABELS[settings.fontSize]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {FONT_SIZE_OPTIONS.map((size) => (
                      <SelectItem hideIndicator key={size} value={String(size)}>
                        {FONT_SIZE_LABELS[size]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />

            {/* Font family */}
            <SettingsRow
              title="Font family"
              description="Monospace font used in the editor."
              resetAction={
                settings.fontFamily !== DEFAULT_EDITOR_SETTINGS.fontFamily ? (
                  <SettingResetButton
                    label="font family"
                    onClick={() =>
                      updateSettings({ fontFamily: DEFAULT_EDITOR_SETTINGS.fontFamily })
                    }
                  />
                ) : null
              }
              control={
                <Select
                  value={settings.fontFamily}
                  onValueChange={(value) => {
                    if (FONT_FAMILY_OPTIONS.includes(value as EditorFontFamily)) {
                      updateSettings({ fontFamily: value as EditorFontFamily });
                    }
                  }}
                  overlayItems={FONT_FAMILY_OPTIONS.map((family) => ({
                    value: family,
                    label: FONT_FAMILY_LABELS[family],
                    hideIndicator: true,
                  }))}
                  overlayAlignItemWithTrigger={false}
                >
                  <SelectTrigger className="w-full sm:w-44" aria-label="Editor font family">
                    <SelectValue>{FONT_FAMILY_LABELS[settings.fontFamily]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {FONT_FAMILY_OPTIONS.map((family) => (
                      <SelectItem hideIndicator key={family} value={family}>
                        {FONT_FAMILY_LABELS[family]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
