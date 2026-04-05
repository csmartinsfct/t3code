import {
  type CronJob,
  type CronJobCreateInput,
  type CronJobUpdateInput,
  type ProjectId,
  type SkillEntry,
} from "@t3tools/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

const isDev = import.meta.env.DEV;

const CRON_JOB_TYPES = [{ value: "new_thread" as const, label: "New Thread" }];

interface CronJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingJob: CronJob | null;
  projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
  onSave: (job: CronJob) => void;
  onCreateJob: (input: CronJobCreateInput) => Promise<CronJob>;
  onUpdateJob: (input: CronJobUpdateInput) => Promise<CronJob>;
}

export function CronJobDialog({
  open,
  onOpenChange,
  editingJob,
  projects,
  onSave,
  onCreateJob,
  onUpdateJob,
}: CronJobDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [jobType, setJobType] = useState<"new_thread">("new_thread");
  const [projectId, setProjectId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [skills, setSkills] = useState<ReadonlyArray<SkillEntry>>([]);

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
        setSkillId(editingJob.newThreadConfig?.skillId ?? "");
        setPrompt(editingJob.newThreadConfig?.prompt ?? "");
        setAutoSend(editingJob.newThreadConfig?.autoSend ?? false);
      } else {
        setName(isDev ? "Test Cron Jobs" : "");
        setDescription(
          isDev ? "This cron job is a mere test of the Cron Jobs feature. Good luck!" : "",
        );
        setCronExpression(isDev ? "* * * * *" : "");
        setJobType("new_thread");
        setProjectId(projects[0]?.id ?? "");
        setSkillId("");
        setPrompt(isDev ? "Hello from a scheduled cron job!" : "");
        setAutoSend(false);
      }
      setValidationError(null);
    }
  }, [open, editingJob, projects]);

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
                ...(skillId ? { skillId } : {}),
                ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
                autoSend,
              }
            : undefined;

        let job: CronJob;
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
        onSave(job);
        onOpenChange(false);
      } catch (error) {
        setValidationError(error instanceof Error ? error.message : "Failed to save cron job.");
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
      skillId,
      prompt,
      autoSend,
      isEditing,
      editingJob,
      onCreateJob,
      onUpdateJob,
      onSave,
      onOpenChange,
    ],
  );

  const formId = "cron-job-dialog-form";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Cron Job" : "Add Cron Job"}</DialogTitle>
        </DialogHeader>

        <DialogPanel>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cron-name" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="cron-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Update Fork vs Remote"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cron-description" className="text-xs font-medium">
                Description
              </Label>
              <Input
                id="cron-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cron-expression" className="text-xs font-medium">
                Schedule
              </Label>
              <Input
                id="cron-expression"
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
                    {CRON_JOB_TYPES.find((t) => t.value === jobType)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {CRON_JOB_TYPES.map((type) => (
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
                      setSkillId("");
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
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium">Skill</Label>
                    <Select value={skillId} onValueChange={(val) => setSkillId(val ?? "")}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue>
                          {skillId
                            ? (skills.find((s) => s.id === skillId)?.name ?? "Select skill")
                            : "None"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        <SelectItem hideIndicator value="">
                          None
                        </SelectItem>
                        {skills.map((skill) => (
                          <SelectItem hideIndicator key={skill.id} value={skill.id}>
                            {skill.name}
                            {skill.group ? ` (${skill.group})` : ""}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cron-prompt" className="text-xs font-medium">
                    Prompt
                  </Label>
                  <Textarea
                    id="cron-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Optional prompt to preload into the thread"
                    rows={3}
                    className="text-xs"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="cron-auto-send" className="text-xs font-medium">
                    Auto send
                  </Label>
                  <Switch id="cron-auto-send" checked={autoSend} onCheckedChange={setAutoSend} />
                </div>
              </>
            )}

            {validationError && <p className="text-xs text-destructive">{validationError}</p>}
          </form>
        </DialogPanel>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button form={formId} type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : isEditing ? "Save changes" : "Create job"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
