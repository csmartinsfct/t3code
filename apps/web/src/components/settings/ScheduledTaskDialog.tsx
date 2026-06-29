import {
  type ScheduledTask,
  type ScheduledTaskCreateInput,
  type ScheduledTaskUpdateInput,
  modelSelectionProviderKind,
  type ModelSelection,
  type ProjectId,
  type SkillEntry,
} from "@t3tools/contracts";
import { BookOpenIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { useSettings } from "../../hooks/useSettings";
import { useServerProviders } from "../../rpc/serverState";
import { getCustomModelOptionsByProvider, makeAppModelSelection } from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

const isDev = import.meta.env.DEV;

const SCHEDULED_TASK_TYPES = [{ value: "new_thread" as const, label: "New Thread" }];

interface SkillGroup {
  label: string | null;
  skills: SkillEntry[];
}

/** Group skills: top-level first (`group: null`), then by sub-package name. */
function groupSkills(skills: readonly SkillEntry[]): SkillGroup[] {
  const groups = new Map<string | null, SkillEntry[]>();

  for (const skill of skills) {
    const key = skill.group ?? null;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(skill);
  }

  const result: SkillGroup[] = [];

  const topLevel = groups.get(null);
  if (topLevel && topLevel.length > 0) {
    result.push({ label: null, skills: topLevel });
  }

  const subKeys = [...groups.keys()].filter((k): k is string => k !== null).sort();
  for (const key of subKeys) {
    const list = groups.get(key)!;
    result.push({ label: key, skills: list });
  }

  return result;
}

interface ScheduledTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingJob: ScheduledTask | null;
  projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
  onSave: (job: ScheduledTask) => void;
  onCreateJob: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>;
  onUpdateJob: (input: ScheduledTaskUpdateInput) => Promise<ScheduledTask>;
}

const SCHEDULED_TASK_EDITOR_OVERLAY_ROUTE_KEY = "scheduled-task-editor";

type ScheduledTaskDialogResult = { action: "saved"; job: ScheduledTask };

export function ScheduledTaskDialog({
  open,
  onOpenChange,
  editingJob,
  projects,
  onSave,
  onCreateJob,
  onUpdateJob,
}: ScheduledTaskDialogProps) {
  const routed = useRoutedOverlaySurface<ScheduledTaskDialogResult>({
    open,
    onOpenChange,
    routeKey: SCHEDULED_TASK_EDITOR_OVERLAY_ROUTE_KEY,
    params: { editingJob, projects },
    presentation: { kind: "dialog" },
    onResult: (result) => {
      if (result.action === "saved") onSave(result.job);
    },
  });

  return (
    <Dialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <DialogPopup className="w-full max-w-lg">
        <ScheduledTaskDialogContent
          editingJob={editingJob}
          onCancel={() => onOpenChange(false)}
          onCreateJob={onCreateJob}
          onSaved={(job) => {
            onSave(job);
            onOpenChange(false);
          }}
          onUpdateJob={onUpdateJob}
          open={routed.domOpen}
          projects={projects}
        />
      </DialogPopup>
    </Dialog>
  );
}

function ScheduledTaskDialogContent({
  editingJob,
  onCancel,
  onCreateJob,
  onSaved,
  onUpdateJob,
  open,
  projects,
}: {
  editingJob: ScheduledTask | null;
  onCancel: () => void;
  onCreateJob: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>;
  onSaved: (job: ScheduledTask) => void;
  onUpdateJob: (input: ScheduledTaskUpdateInput) => Promise<ScheduledTask>;
  open: boolean;
  projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [jobType, setJobType] = useState<"new_thread">("new_thread");
  const [projectId, setProjectId] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [skills, setSkills] = useState<ReadonlyArray<SkillEntry>>([]);
  const settings = useSettings();
  const serverProviders = useServerProviders();

  const isEditing = editingJob !== null;

  // Fetch skills when project changes
  useEffect(() => {
    if (!projectId) {
      setSkills([]);
      return;
    }
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      setSkills([]);
      return;
    }
    void ensureNativeApi()
      .server.resolveSkills({ cwd: project.workspaceRoot })
      .then((result) => setSkills(result.skills))
      .catch(() => setSkills([]));
  }, [projectId, projects]);

  useEffect(() => {
    if (open) {
      if (editingJob) {
        setName(editingJob.name);
        setDescription(editingJob.description ?? "");
        setCronExpression(editingJob.cronExpression);
        setJobType(editingJob.jobType);
        setProjectId(editingJob.newThreadConfig?.projectId ?? "");
        setSkillIds([...(editingJob.newThreadConfig?.skillIds ?? [])]);
        setPrompt(editingJob.newThreadConfig?.prompt ?? "");
        setAutoSend(editingJob.newThreadConfig?.autoSend ?? false);
        setModelSelection(editingJob.newThreadConfig?.modelSelection ?? null);
      } else {
        setName(isDev ? "Test Scheduled Tasks" : "");
        setDescription(
          isDev
            ? "This scheduled task is a mere test of the Scheduled Tasks feature. Good luck!"
            : "",
        );
        setCronExpression(isDev ? "* * * * *" : "");
        setJobType("new_thread");
        setProjectId(projects[0]?.id ?? "");
        setSkillIds([]);
        setPrompt(isDev ? "Hello from a scheduled task!" : "");
        setAutoSend(false);
        setModelSelection(null);
      }
      setValidationError(null);
    }
  }, [open, editingJob, projects]);

  const effectiveModelSelection = modelSelection ?? settings.orchestrationImplementerModelSelection;
  const effectiveProvider = modelSelectionProviderKind(effectiveModelSelection);
  const modelOptionsByProvider = useMemo(
    () =>
      getCustomModelOptionsByProvider(
        settings,
        serverProviders,
        effectiveProvider,
        effectiveModelSelection.model,
      ),
    [effectiveModelSelection.model, effectiveProvider, serverProviders, settings],
  );
  const effectiveProviderModels =
    serverProviders.find((provider) => provider.provider === effectiveProvider)?.models ?? [];

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setValidationError(null);

      const trimmedName = name.trim();
      if (!trimmedName) {
        setValidationError("Name is required.");
        return;
      }
      const trimmedCron = cronExpression.trim();
      if (!trimmedCron) {
        setValidationError("Schedule expression is required.");
        return;
      }
      if (jobType === "new_thread" && !projectId) {
        setValidationError("Project is required for New Thread jobs.");
        return;
      }

      setSaving(true);
      try {
        const newThreadConfig =
          jobType === "new_thread"
            ? {
                projectId: projectId as ProjectId,
                ...(skillIds.length > 0 ? { skillIds } : {}),
                ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
                autoSend,
                ...(modelSelection ? { modelSelection } : {}),
              }
            : undefined;

        let job: ScheduledTask;
        if (isEditing) {
          job = await onUpdateJob({
            jobId: editingJob.jobId,
            name: trimmedName,
            description: description.trim() || null,
            cronExpression: trimmedCron,
            newThreadConfig,
          });
        } else {
          job = await onCreateJob({
            name: trimmedName,
            description: description.trim() || null,
            cronExpression: trimmedCron,
            enabled: true,
            jobType,
            newThreadConfig,
          });
        }
        onSaved(job);
      } catch (error) {
        setValidationError(
          error instanceof Error ? error.message : "Failed to save scheduled task.",
        );
      } finally {
        setSaving(false);
      }
    },
    [
      name,
      description,
      cronExpression,
      jobType,
      projectId,
      skillIds,
      prompt,
      autoSend,
      modelSelection,
      isEditing,
      editingJob,
      onCreateJob,
      onUpdateJob,
      onSaved,
    ],
  );

  const formId = "scheduled-task-dialog-form";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Edit Scheduled Task" : "Add Scheduled Task"}</DialogTitle>
      </DialogHeader>

      <DialogPanel>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-name" className="text-xs font-medium">
              Name
            </Label>
            <Input
              id="task-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Update Fork vs Remote"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-description" className="text-xs font-medium">
              Description
            </Label>
            <Input
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-expression" className="text-xs font-medium">
              Schedule
            </Label>
            <Input
              id="task-expression"
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              placeholder="0 9 * * * (every day at 9am)"
              className="font-mono text-xs"
            />
            <span className="text-[11px] text-muted-foreground">
              Standard 5-field cron: minute hour day-of-month month day-of-week
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Type</Label>
            <Select value={jobType} onValueChange={(val) => setJobType(val as "new_thread")}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>
                  {SCHEDULED_TASK_TYPES.find((t) => t.value === jobType)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {SCHEDULED_TASK_TYPES.map((type) => (
                  <SelectItem hideIndicator key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          {jobType === "new_thread" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Project</Label>
                <Select
                  value={projectId}
                  onValueChange={(val) => {
                    setProjectId(val ?? "");
                    setSkillIds([]);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue>
                      {projects.find((p) => p.id === projectId)?.title ?? "Select project"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {projects.map((project) => (
                      <SelectItem hideIndicator key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              {skills.length > 0 && (
                <SkillsMultiSelect skills={skills} selectedIds={skillIds} onChange={setSkillIds} />
              )}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="task-model-override" className="text-xs font-medium">
                    Task model override
                  </Label>
                  <Switch
                    id="task-model-override"
                    checked={modelSelection !== null}
                    onCheckedChange={(checked) => {
                      setModelSelection(checked ? effectiveModelSelection : null);
                    }}
                  />
                </div>
                {modelSelection !== null && (
                  <div className="flex flex-wrap items-center justify-start gap-1.5">
                    <ProviderModelPicker
                      provider={effectiveProvider}
                      model={effectiveModelSelection.model}
                      lockedProvider={null}
                      providers={serverProviders}
                      modelOptionsByProvider={modelOptionsByProvider}
                      triggerVariant="outline"
                      triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                      onProviderModelChange={(provider, model) => {
                        setModelSelection(makeAppModelSelection(provider, model));
                      }}
                    />
                    <TraitsPicker
                      provider={effectiveProvider}
                      models={effectiveProviderModels}
                      model={effectiveModelSelection.model}
                      prompt=""
                      onPromptChange={() => {}}
                      modelOptions={effectiveModelSelection.options}
                      allowPromptInjectedEffort={false}
                      triggerVariant="outline"
                      triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                      onModelOptionsChange={(nextOptions) => {
                        setModelSelection(
                          makeAppModelSelection(
                            effectiveProvider,
                            effectiveModelSelection.model,
                            nextOptions,
                          ),
                        );
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-prompt" className="text-xs font-medium">
                  Prompt
                </Label>
                <Textarea
                  id="task-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Optional prompt to preload into the thread"
                  rows={3}
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="task-auto-send" className="text-xs font-medium">
                  Auto send
                </Label>
                <Switch id="task-auto-send" checked={autoSend} onCheckedChange={setAutoSend} />
              </div>
            </>
          )}

          {validationError && <p className="text-xs text-destructive">{validationError}</p>}
        </form>
      </DialogPanel>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button form={formId} type="submit" size="sm" disabled={saving}>
          {saving ? "Saving..." : isEditing ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Skills multi-select with menu dropdown + chips
// ---------------------------------------------------------------------------

function SkillsMultiSelect({
  skills,
  selectedIds,
  onChange,
}: {
  skills: readonly SkillEntry[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const groups = useMemo(() => groupSkills(skills), [skills]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedSkills = useMemo(
    () => skills.filter((s) => selectedSet.has(s.id)),
    [skills, selectedSet],
  );

  const toggleSkill = useCallback(
    (skillId: string) => {
      if (selectedSet.has(skillId)) {
        onChange(selectedIds.filter((id) => id !== skillId));
      } else {
        onChange([...selectedIds, skillId]);
      }
    },
    [selectedIds, selectedSet, onChange],
  );

  const removeSkill = useCallback(
    (skillId: string) => {
      onChange(selectedIds.filter((id) => id !== skillId));
    },
    [selectedIds, onChange],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium">Skills</Label>

      {/* Selected skills chips */}
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center gap-1 rounded-md border border-border/70 bg-accent/30 px-2 py-1 text-xs transition-colors"
              title={skill.relativePath}
            >
              <BookOpenIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-foreground">{skill.name}</span>
              <button
                type="button"
                aria-label={`Remove ${skill.name}`}
                className="ml-0.5 flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/8 hover:text-foreground"
                onClick={() => removeSkill(skill.id)}
              >
                <XIcon className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Dropdown trigger */}
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-background px-2.5 text-xs shadow-xs/5 transition-shadow hover:border-ring/50 dark:bg-input/32"
            />
          }
        >
          <span className="text-muted-foreground">
            {selectedIds.length > 0
              ? `${selectedIds.length} skill${selectedIds.length > 1 ? "s" : ""} selected`
              : "Select skills..."}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        </MenuTrigger>
        <MenuPopup align="start" className="max-h-[300px]">
          {groups.map((group, groupIdx) => (
            <div key={group.label ?? "__top__"}>
              {groupIdx > 0 && (
                <div className="mx-2 my-1 border-t border-border/50" role="separator" />
              )}
              {group.label !== null && (
                <div className="px-2 pb-0.5 pt-1.5 font-medium text-muted-foreground text-xs">
                  {group.label}
                </div>
              )}
              {group.skills.map((skill) => {
                const isSelected = selectedSet.has(skill.id);
                return (
                  <MenuItem
                    key={skill.id}
                    className="flex items-center gap-2"
                    closeOnClick={false}
                    onClick={() => toggleSkill(skill.id)}
                  >
                    <span
                      className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="size-2.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 truncate text-sm">{skill.name}</span>
                  </MenuItem>
                );
              })}
            </div>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

registerOverlayRoute<{ editingJob?: unknown; projects?: unknown }>(
  SCHEDULED_TASK_EDITOR_OVERLAY_ROUTE_KEY,
  function ScheduledTaskEditorOverlayRoute({ message, controller }) {
    return (
      <OverlayRouteDialog>
        <DialogPopup className="w-full max-w-lg">
          <ScheduledTaskDialogContent
            editingJob={readScheduledTaskParam(message.params.editingJob)}
            onCancel={() => controller.cancel("cancel")}
            onCreateJob={(input) => ensureNativeApi().scheduledTasks.create(input)}
            onSaved={(job) => controller.submit({ action: "saved", job })}
            onUpdateJob={(input) => ensureNativeApi().scheduledTasks.update(input)}
            open
            projects={readProjectsParam(message.params.projects)}
          />
        </DialogPopup>
      </OverlayRouteDialog>
    );
  },
);

function readProjectsParam(
  value: unknown,
): ReadonlyArray<{ id: string; title: string; workspaceRoot: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (project): project is { id: string; title: string; workspaceRoot: string } => {
      if (!project || typeof project !== "object") return false;
      const candidate = project as { id?: unknown; title?: unknown; workspaceRoot?: unknown };
      return (
        typeof candidate.id === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.workspaceRoot === "string"
      );
    },
  );
}

function readScheduledTaskParam(value: unknown): ScheduledTask | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ScheduledTask>;
  if (typeof candidate.jobId !== "string") return null;
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.cronExpression !== "string") return null;
  if (candidate.jobType !== "new_thread") return null;

  return {
    jobId: candidate.jobId,
    name: candidate.name,
    description: typeof candidate.description === "string" ? candidate.description : null,
    cronExpression: candidate.cronExpression,
    enabled: candidate.enabled === true,
    jobType: candidate.jobType,
    newThreadConfig: readNewThreadConfigParam(candidate.newThreadConfig),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    lastRunAt: typeof candidate.lastRunAt === "string" ? candidate.lastRunAt : null,
    nextRunAt: typeof candidate.nextRunAt === "string" ? candidate.nextRunAt : null,
  } as ScheduledTask;
}

function readNewThreadConfigParam(value: unknown): ScheduledTask["newThreadConfig"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as NonNullable<ScheduledTask["newThreadConfig"]>;
  if (typeof candidate.projectId !== "string") return null;

  return {
    projectId: candidate.projectId,
    ...(Array.isArray(candidate.skillIds)
      ? {
          skillIds: candidate.skillIds.filter(
            (skillId): skillId is string => typeof skillId === "string",
          ),
        }
      : {}),
    ...(typeof candidate.prompt === "string" ? { prompt: candidate.prompt } : {}),
    autoSend: candidate.autoSend === true,
    ...(isModelSelectionParam(candidate.modelSelection)
      ? { modelSelection: candidate.modelSelection }
      : {}),
  } as NonNullable<ScheduledTask["newThreadConfig"]>;
}

function isModelSelectionParam(value: unknown): value is ModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ModelSelection>;
  return typeof candidate.provider === "string" && typeof candidate.model === "string";
}
