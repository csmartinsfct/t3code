import type {
  DeclaredService,
  OverlayMenuItem,
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  BugIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  WrenchIcon,
} from "lucide-react";
import React, {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import {
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
} from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { isMacPlatform } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Group, GroupSeparator } from "./ui/group";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { useRoutedOverlaySurface } from "~/routedOverlayAdapters";

export const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

export function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

function scriptOverlayIcon(icon: ProjectScriptIcon): string {
  if (icon === "test") return "FlaskConical";
  if (icon === "lint") return "ListChecks";
  if (icon === "configure") return "Wrench";
  if (icon === "build") return "Hammer";
  if (icon === "debug") return "Bug";
  return "Play";
}

export interface NewProjectScriptInput {
  name: string;
  /** Empty string for composite actions (per-service commands carry the load). */
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  keybinding: string | null;
  services: DeclaredService[] | undefined;
}

let nextDraftKey = 0;
const PROJECT_SCRIPT_EDITOR_OVERLAY_ROUTE_KEY = "project-script-editor";

/** Mutable draft kept in component state while editing. */
interface ServiceDraft {
  key: number;
  name: string;
  /**
   * Optional command for composite actions: when set, this service runs as
   * its own subprocess and gets its own log tab. Mutually exclusive with the
   * parent script's top-level `command` (validated server-side via
   * `validateProjectScriptShape`).
   */
  command: string;
}

function declaredServicesToDrafts(
  services: readonly DeclaredService[] | undefined,
): ServiceDraft[] {
  if (!services || services.length === 0) return [];
  return services.map((s) => ({
    key: ++nextDraftKey,
    name: s.name,
    command: s.command ?? "",
  }));
}

function draftsToServices(drafts: ServiceDraft[]): DeclaredService[] | undefined {
  const valid = drafts.filter((d) => d.name.trim().length > 0);
  if (valid.length === 0) return undefined;
  return valid.map((d) => {
    const trimmedCommand = d.command.trim();
    return {
      name: d.name.trim(),
      ...(trimmedCommand.length > 0 ? { command: trimmedCommand } : {}),
    };
  });
}

/**
 * True when at least one draft has a per-service command — the action will be
 * persisted as a composite script and the parent `command` field is hidden.
 */
function isCompositeDraft(drafts: ReadonlyArray<ServiceDraft>): boolean {
  return drafts.some((d) => d.command.trim().length > 0);
}

interface ProjectScriptsControlProps {
  scripts: ProjectScript[];
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void;
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void;
  onDeleteScript: (scriptId: string) => Promise<void> | void;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (normalized.startsWith("f") && normalized.length <= 3) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

function keybindingFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(navigator.platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) {
    return null;
  }
  parts.push(keyToken);
  return parts.join("+");
}

type ProjectScriptEditorResult =
  | {
      action: "save";
      input: NewProjectScriptInput;
      scriptId?: string | undefined;
    }
  | {
      action: "delete";
      scriptId: string;
    };

function ProjectScriptEditorDialog({
  closeOnSubmit = true,
  editingScript,
  keybindings,
  onDelete,
  onOpenChange,
  onSubmit,
  open,
  scripts,
}: {
  closeOnSubmit?: boolean | undefined;
  editingScript: ProjectScript | null;
  keybindings: ResolvedKeybindingsConfig;
  onDelete: (scriptId: string) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (result: ProjectScriptEditorResult) => Promise<void> | void;
  open: boolean;
  scripts: ProjectScript[];
}) {
  const formId = React.useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [serviceDrafts, setServiceDrafts] = useState<ServiceDraft[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = editingScript !== null;
  const compositeMode = isCompositeDraft(serviceDrafts);

  useEffect(() => {
    if (!open) return;
    if (editingScript) {
      setName(editingScript.name);
      setCommand(editingScript.command ?? "");
      setIcon(editingScript.icon);
      setRunOnWorktreeCreate(editingScript.runOnWorktreeCreate);
      setKeybinding(
        keybindingValueForCommand(keybindings, commandForProjectScript(editingScript.id)) ?? "",
      );
      setServiceDrafts(declaredServicesToDrafts(editingScript.services));
    } else {
      setName("");
      setCommand("");
      setIcon("play");
      setRunOnWorktreeCreate(false);
      setKeybinding("");
      setServiceDrafts([]);
    }
    setIconPickerOpen(false);
    setValidationError(null);
    setDeleteConfirmOpen(false);
    setIsSubmitting(false);
  }, [editingScript, keybindings, open]);

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromEvent(event);
    if (!next) return;
    setKeybinding(next);
  };

  const submitScript = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    const composite = isCompositeDraft(serviceDrafts);
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (!composite && trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return;
    }
    if (composite) {
      const missing = serviceDrafts.find(
        (d) => d.name.trim().length > 0 && d.command.trim().length === 0,
      );
      if (missing) {
        setValidationError(
          `Composite actions must define a command for every service. Service '${missing.name}' is missing one.`,
        );
        return;
      }
    }

    setValidationError(null);
    setIsSubmitting(true);
    try {
      const scriptIdForValidation =
        editingScript?.id ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const input = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        keybinding: keybindingRule?.key ?? null,
        services: draftsToServices(serviceDrafts),
      } satisfies NewProjectScriptInput;
      await onSubmit({
        action: "save",
        input,
        ...(editingScript ? { scriptId: editingScript.id } : {}),
      });
      if (closeOnSubmit) onOpenChange(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDeleteScript = async () => {
    if (!editingScript) return;
    setIsSubmitting(true);
    try {
      await onDelete(editingScript.id);
      setDeleteConfirmOpen(false);
      if (closeOnSubmit) onOpenChange(false);
    } catch (error) {
      setDeleteConfirmOpen(false);
      setValidationError(error instanceof Error ? error.message : "Failed to delete action.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
            <DialogDescription>
              Actions are project-scoped commands you can run from the top bar or keybindings.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} className="space-y-4" onSubmit={submitScript}>
              <ProjectScriptEditorFormFields
                captureKeybinding={captureKeybinding}
                command={command}
                compositeMode={compositeMode}
                icon={icon}
                iconPickerOpen={iconPickerOpen}
                keybinding={keybinding}
                name={name}
                runOnWorktreeCreate={runOnWorktreeCreate}
                serviceDrafts={serviceDrafts}
                setCommand={setCommand}
                setIcon={setIcon}
                setIconPickerOpen={setIconPickerOpen}
                setName={setName}
                setRunOnWorktreeCreate={setRunOnWorktreeCreate}
                setServiceDrafts={setServiceDrafts}
                validationError={validationError}
              />
            </form>
          </DialogPanel>
          <DialogFooter>
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                disabled={isSubmitting}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button form={formId} type="submit" disabled={isSubmitting}>
              {isEditing ? "Save changes" : "Save action"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={isSubmitting} />}>
              Cancel
            </AlertDialogClose>
            <Button variant="destructive" disabled={isSubmitting} onClick={confirmDeleteScript}>
              Delete action
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function ProjectScriptEditorFormFields({
  captureKeybinding,
  command,
  compositeMode,
  icon,
  iconPickerOpen,
  keybinding,
  name,
  runOnWorktreeCreate,
  serviceDrafts,
  setCommand,
  setIcon,
  setIconPickerOpen,
  setName,
  setRunOnWorktreeCreate,
  setServiceDrafts,
  validationError,
}: {
  captureKeybinding: (event: KeyboardEvent<HTMLInputElement>) => void;
  command: string;
  compositeMode: boolean;
  icon: ProjectScriptIcon;
  iconPickerOpen: boolean;
  keybinding: string;
  name: string;
  runOnWorktreeCreate: boolean;
  serviceDrafts: ServiceDraft[];
  setCommand: (value: string) => void;
  setIcon: (value: ProjectScriptIcon) => void;
  setIconPickerOpen: (value: boolean) => void;
  setName: (value: string) => void;
  setRunOnWorktreeCreate: (value: boolean) => void;
  setServiceDrafts: React.Dispatch<React.SetStateAction<ServiceDraft[]>>;
  validationError: string | null;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="script-name">Name</Label>
        <div className="flex items-center gap-2">
          <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="size-9 shrink-0 hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)]"
                  aria-label="Choose icon"
                />
              }
            >
              <ScriptIcon icon={icon} className="size-4.5" />
            </PopoverTrigger>
            <PopoverPopup align="start">
              <div className="grid grid-cols-3 gap-2">
                {SCRIPT_ICONS.map((entry) => {
                  const isSelected = entry.id === icon;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs ${
                        isSelected
                          ? "border-primary/70 bg-primary/10"
                          : "border-border/70 hover:bg-accent/60"
                      }`}
                      onClick={() => {
                        setIcon(entry.id);
                        setIconPickerOpen(false);
                      }}
                    >
                      <ScriptIcon icon={entry.id} className="size-4" />
                      <span>{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </PopoverPopup>
          </Popover>
          <Input
            id="script-name"
            autoFocus
            placeholder="Test"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="script-keybinding">Keybinding</Label>
        <Input
          id="script-keybinding"
          placeholder="Press shortcut"
          value={keybinding}
          readOnly
          onKeyDown={captureKeybinding}
        />
        <p className="text-xs text-muted-foreground">
          Press a shortcut. Use <code>Backspace</code> to clear.
        </p>
      </div>
      {!compositeMode && (
        <div className="space-y-1.5">
          <Label htmlFor="script-command">Command</Label>
          <Textarea
            id="script-command"
            placeholder="bun test"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        </div>
      )}
      <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
        <span>Run automatically on worktree creation</span>
        <Switch
          checked={runOnWorktreeCreate}
          onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
        />
      </label>

      <div className="space-y-1.5">
        <Label>Services</Label>
        <p className="text-xs text-muted-foreground">
          Add a CMD to run a service as its own subprocess with a separate log tab.
        </p>
        <div className="overflow-hidden rounded-md border border-border/70">
          {serviceDrafts.length === 0 ? (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              onClick={() =>
                setServiceDrafts((prev) => [
                  ...prev,
                  { key: ++nextDraftKey, name: "", command: "" },
                ])
              }
            >
              <PlusIcon className="size-3" />
              Add service
            </button>
          ) : (
            <>
              {serviceDrafts.map((draft, idx) => (
                <div
                  key={draft.key}
                  className={`group flex flex-col gap-1.5 px-2.5 py-2 ${idx > 0 ? "border-t border-border/50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Name (e.g. Backend)"
                      value={draft.name}
                      className="h-6 min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      onChange={(e) =>
                        setServiceDrafts((prev) =>
                          prev.map((d, i) => (i === idx ? { ...d, name: e.target.value } : d)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive focus-visible:text-muted-foreground"
                      onClick={() => setServiceDrafts((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <TrashIcon className="size-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pl-1">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Cmd
                    </span>
                    <div className="h-4 w-px shrink-0 bg-border/60" />
                    <input
                      placeholder="(optional) run as own subprocess — e.g. bun run dev:server"
                      value={draft.command}
                      className="h-6 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      onChange={(e) =>
                        setServiceDrafts((prev) =>
                          prev.map((d, i) => (i === idx ? { ...d, command: e.target.value } : d)),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="flex w-full items-center gap-1.5 border-t border-border/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                onClick={() =>
                  setServiceDrafts((prev) => [
                    ...prev,
                    { key: ++nextDraftKey, name: "", command: "" },
                  ])
                }
              >
                <PlusIcon className="size-2.5" />
                Add service
              </button>
            </>
          )}
        </div>
      </div>

      {validationError && <p className="text-sm text-destructive">{validationError}</p>}
    </>
  );
}

export default function ProjectScriptsControl({
  scripts,
  keybindings,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const editingScript = editingScriptId
    ? (scripts.find((script) => script.id === editingScriptId) ?? null)
    : null;

  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts);
  }, [preferredScriptId, scripts]);
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";

  const openAddDialog = useCallback(() => {
    setEditingScriptId(null);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((script: ProjectScript) => {
    setEditingScriptId(script.id);
    setDialogOpen(true);
  }, []);

  const handleEditorResult = useCallback(
    async (result: ProjectScriptEditorResult) => {
      if (result.action === "delete") {
        await onDeleteScript(result.scriptId);
        return;
      }
      if (result.scriptId) {
        await onUpdateScript(result.scriptId, result.input);
        return;
      }
      await onAddScript(result.input);
    },
    [onAddScript, onDeleteScript, onUpdateScript],
  );

  const editorRoute = useRoutedOverlaySurface<ProjectScriptEditorResult>({
    open: dialogOpen,
    onOpenChange: (open) => {
      setDialogOpen(open);
      if (!open) setEditingScriptId(null);
    },
    routeKey: PROJECT_SCRIPT_EDITOR_OVERLAY_ROUTE_KEY,
    params: {
      editingScriptId,
      keybindings,
      scripts,
    },
    presentation: { kind: "dialog" },
    onResult: handleEditorResult,
  });

  const scriptOverlayItems = useMemo<OverlayMenuItem[]>(
    () => [
      ...scripts.map((script) => {
        const shortcutLabel = shortcutLabelForCommand(
          keybindings,
          commandForProjectScript(script.id),
        );
        return {
          id: `run:${script.id}`,
          label: script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name,
          icon: scriptOverlayIcon(script.icon),
          iconClassName: "size-4",
          ...(shortcutLabel ? { shortcut: shortcutLabel } : {}),
          secondaryAction: {
            id: `edit:${script.id}`,
            ariaLabel: `Edit ${script.name}`,
            icon: "Settings",
            iconClassName: "size-3.5",
            dismissOnAction: true,
          },
        } satisfies OverlayMenuItem;
      }),
      {
        id: "add",
        label: "Add action",
        icon: "Plus",
        iconClassName: "size-4",
      },
    ],
    [keybindings, scripts],
  );

  const handleScriptOverlaySelect = useCallback(
    (id: string) => {
      if (id === "add") {
        openAddDialog();
        return;
      }
      if (id.startsWith("run:")) {
        const script = scripts.find((entry) => entry.id === id.slice("run:".length));
        if (script) onRunScript(script);
        return;
      }
      if (id.startsWith("edit:")) {
        const script = scripts.find((entry) => entry.id === id.slice("edit:".length));
        if (script) openEditDialog(script);
      }
    },
    [onRunScript, openAddDialog, openEditDialog, scripts],
  );

  return (
    <>
      {primaryScript ? (
        <Group aria-label="Project scripts">
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRunScript(primaryScript)}
            title={`Run ${primaryScript.name}`}
          >
            <ScriptIcon icon={primaryScript.icon} />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {primaryScript.name}
            </span>
          </Button>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            highlightItemOnHover={false}
            overlayItems={scriptOverlayItems}
            overlayMenuAlign="end"
            overlayOnSelect={handleScriptOverlaySelect}
          >
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <MenuItem
                    key={script.id}
                    className={`group ${dropdownItemClassName}`}
                    onClick={() => onRunScript(script)}
                  >
                    <ScriptIcon icon={script.icon} className="size-4" />
                    <span className="truncate">
                      {script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name}
                    </span>
                    <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
                      {shortcutLabel && (
                        <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                          {shortcutLabel}
                        </MenuShortcut>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
                        aria-label={`Edit ${script.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditDialog(script);
                        }}
                      >
                        <SettingsIcon className="size-3.5" />
                      </Button>
                    </span>
                  </MenuItem>
                );
              })}
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add action
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : (
        <Button size="xs" variant="outline" onClick={openAddDialog} title="Add action">
          <PlusIcon className="size-3.5" />
          <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            Add action
          </span>
        </Button>
      )}

      <ProjectScriptEditorDialog
        editingScript={editingScript}
        keybindings={keybindings}
        onDelete={(scriptId) => handleEditorResult({ action: "delete", scriptId })}
        onOpenChange={editorRoute.onDomOpenChange}
        onSubmit={handleEditorResult}
        open={editorRoute.domOpen}
        scripts={scripts}
      />
    </>
  );
}

registerOverlayRoute<{
  editingScriptId?: unknown;
  keybindings?: unknown;
  scripts?: unknown;
}>(
  PROJECT_SCRIPT_EDITOR_OVERLAY_ROUTE_KEY,
  function ProjectScriptEditorOverlayRoute({ message, controller }) {
    const scripts = readProjectScriptsParam(message.params.scripts);
    const keybindings = readKeybindingsParam(message.params.keybindings);
    const editingScriptId =
      typeof message.params.editingScriptId === "string" ? message.params.editingScriptId : null;
    const editingScript = editingScriptId
      ? (scripts.find((script) => script.id === editingScriptId) ?? null)
      : null;

    return (
      <ProjectScriptEditorDialog
        closeOnSubmit={false}
        editingScript={editingScript}
        keybindings={keybindings}
        onDelete={(scriptId) => controller.submit({ action: "delete", scriptId })}
        onOpenChange={(open) => {
          if (!open) controller.cancel("dismissed");
        }}
        onSubmit={(result) => controller.submit(result)}
        open
        scripts={scripts}
      />
    );
  },
);

function readProjectScriptsParam(value: unknown): ProjectScript[] {
  if (!Array.isArray(value)) return [];
  return value.filter((script): script is ProjectScript => {
    if (!script || typeof script !== "object") return false;
    const candidate = script as { id?: unknown; name?: unknown; icon?: unknown };
    return (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.icon === "string"
    );
  });
}

function readKeybindingsParam(value: unknown): ResolvedKeybindingsConfig {
  if (!Array.isArray(value)) return [];
  return value as ResolvedKeybindingsConfig;
}
