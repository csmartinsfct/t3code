import type { EditorId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { ChevronDownIcon, FolderClosedIcon } from "lucide-react";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteMenu, OverlayRouteMenuPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  Icon,
  TraeIcon,
  IntelliJIdeaIcon,
  VisualStudioCode,
  Zed,
} from "../Icons";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

const OPEN_IN_PICKER_OVERLAY_ROUTE_KEY = "open-in-picker-menu";

const resolveOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<{ label: string; Icon: Icon; value: EditorId }> = [
    {
      label: "Cursor",
      Icon: CursorIcon,
      value: "cursor",
    },
    {
      label: "Trae",
      Icon: TraeIcon,
      value: "trae",
    },
    {
      label: "VS Code",
      Icon: VisualStudioCode,
      value: "vscode",
    },
    {
      label: "VS Code Insiders",
      Icon: VisualStudioCode,
      value: "vscode-insiders",
    },
    {
      label: "VSCodium",
      Icon: VisualStudioCode,
      value: "vscodium",
    },
    {
      label: "Zed",
      Icon: Zed,
      value: "zed",
    },
    {
      label: "Antigravity",
      Icon: AntigravityIcon,
      value: "antigravity",
    },
    {
      label: "IntelliJ IDEA",
      Icon: IntelliJIdeaIcon,
      value: "idea",
    },
    {
      label: isMacPlatform(platform)
        ? "Finder"
        : isWindowsPlatform(platform)
          ? "Explorer"
          : "Files",
      Icon: FolderClosedIcon,
      value: "file-manager",
    },
  ];
  return baseOptions.filter((option) => availableEditors.includes(option.value));
};

type OpenInOption = ReturnType<typeof resolveOptions>[number];

function isEditorId(value: unknown): value is EditorId {
  return (
    value === "antigravity" ||
    value === "cursor" ||
    value === "file-manager" ||
    value === "idea" ||
    value === "trae" ||
    value === "vscode" ||
    value === "vscode-insiders" ||
    value === "vscodium" ||
    value === "zed"
  );
}

function readEditorIdsParam(value: unknown): EditorId[] {
  return Array.isArray(value) ? value.filter(isEditorId) : [];
}

function readEditorIdParam(value: unknown): EditorId | null {
  return isEditorId(value) ? value : null;
}

function readStringParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function OpenInMenuContent({
  favoriteShortcutLabel,
  onSelectEditor,
  options,
  preferredEditor,
}: {
  favoriteShortcutLabel: string | null;
  onSelectEditor: (editor: EditorId) => void;
  options: readonly OpenInOption[];
  preferredEditor: EditorId | null;
}) {
  return (
    <>
      {options.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
      {options.map(({ label, Icon, value }) => (
        <MenuItem key={value} onClick={() => onSelectEditor(value)}>
          <Icon aria-hidden="true" className="text-muted-foreground" />
          {label}
          {value === preferredEditor && favoriteShortcutLabel && (
            <MenuShortcut>{favoriteShortcutLabel}</MenuShortcut>
          )}
        </MenuItem>
      ))}
    </>
  );
}

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const options = useMemo(
    () => resolveOptions(navigator.platform, availableEditors),
    [availableEditors],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const api = readNativeApi();
      if (!api || !openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      void api.shell.openInEditor(openInCwd, editor);
      setPreferredEditor(editor);
    },
    [preferredEditor, openInCwd, setPreferredEditor],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );
  const openInRoute = useRoutedPopoverSurface<HTMLButtonElement, EditorId>({
    routeKey: OPEN_IN_PICKER_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    params: {
      availableEditors,
      favoriteShortcutLabel: openFavoriteEditorShortcutLabel,
      platform: navigator.platform,
      preferredEditor,
    },
    onResult: openInEditor,
  });

  useOpenFavoriteEditorShortcut({ keybindings, openInCwd, preferredEditor });

  return (
    <Group aria-label="Subscription actions">
      <Button
        size="xs"
        variant="outline"
        disabled={!preferredEditor || !openInCwd}
        onClick={() => openInEditor(preferredEditor)}
      >
        {primaryOption?.Icon && <primaryOption.Icon aria-hidden="true" className="size-3.5" />}
        <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
          Open
        </span>
      </Button>
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu open={openInRoute.domOpen} onOpenChange={openInRoute.onOpenChange}>
        <MenuTrigger
          render={<Button aria-label="Copy options" size="icon-xs" variant="outline" />}
          onFocusCapture={openInRoute.updateAnchor}
          onMouseOverCapture={openInRoute.updateAnchor}
          ref={openInRoute.triggerRef}
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <OpenInMenuContent
            favoriteShortcutLabel={openFavoriteEditorShortcutLabel}
            onSelectEditor={openInEditor}
            options={options}
            preferredEditor={preferredEditor}
          />
        </MenuPopup>
      </Menu>
    </Group>
  );
});

export const OpenFavoriteEditorShortcut = memo(function OpenFavoriteEditorShortcut({
  keybindings,
  availableEditors,
  openInCwd,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const [preferredEditor] = usePreferredEditor(availableEditors);
  useOpenFavoriteEditorShortcut({ keybindings, openInCwd, preferredEditor });
  return null;
});

function useOpenFavoriteEditorShortcut({
  keybindings,
  openInCwd,
  preferredEditor,
}: {
  keybindings: ResolvedKeybindingsConfig;
  openInCwd: string | null;
  preferredEditor: EditorId | null;
}) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const api = readNativeApi();
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!api || !openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void api.shell.openInEditor(openInCwd, preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preferredEditor, keybindings, openInCwd]);
}

registerOverlayRoute<{
  availableEditors?: unknown;
  favoriteShortcutLabel?: unknown;
  platform?: unknown;
  preferredEditor?: unknown;
}>(OPEN_IN_PICKER_OVERLAY_ROUTE_KEY, function OpenInPickerOverlayRoute({ message, controller }) {
  const availableEditors = readEditorIdsParam(message.params.availableEditors);
  const favoriteShortcutLabel = readStringParam(message.params.favoriteShortcutLabel);
  const platform = readStringParam(message.params.platform) ?? navigator.platform;
  const preferredEditor = readEditorIdParam(message.params.preferredEditor);
  const options = resolveOptions(platform, availableEditors);

  return (
    <OverlayRouteMenu>
      <OverlayRouteMenuPopup align="end">
        <OpenInMenuContent
          favoriteShortcutLabel={favoriteShortcutLabel}
          onSelectEditor={(editor) => controller.submit(editor)}
          options={options}
          preferredEditor={preferredEditor}
        />
      </OverlayRouteMenuPopup>
    </OverlayRouteMenu>
  );
});
