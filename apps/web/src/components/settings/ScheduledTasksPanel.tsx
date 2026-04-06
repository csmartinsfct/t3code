import type { ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { ensureNativeApi } from "../../nativeApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ScheduledTaskDialog } from "./ScheduledTaskDialog";

function cronHumanReadable(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const min = parts[0]!;
  const hour = parts[1]!;
  const dom = parts[2]!;
  const mon = parts[3]!;
  const dow = parts[4]!;

  if (min === "*" && hour === "*") return "Every minute";
  if (hour === "*" && min !== "*") return `Every hour at :${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*" && min !== "*" && hour !== "*") {
    return `Daily at ${hour}:${min.padStart(2, "0")}`;
  }
  if (dow !== "*" && dom === "*" && mon === "*") {
    return `${dow} at ${hour}:${min.padStart(2, "0")}`;
  }
  return cron;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (Math.abs(diffMs) < 60_000) return "Just now";
  if (Math.abs(diffMs) < 3_600_000) {
    const mins = Math.round(Math.abs(diffMs) / 60_000);
    return diffMs > 0 ? `${mins}m ago` : `in ${mins}m`;
  }
  if (Math.abs(diffMs) < 86_400_000) {
    const hours = Math.round(Math.abs(diffMs) / 3_600_000);
    return diffMs > 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  return date.toLocaleDateString();
}

export function ScheduledTasksPanel() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<ReadonlyArray<ScheduledTask>>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projects, setProjects] = useState<
    ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>
  >([]);

  const fetchJobs = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const [jobsList, snapshot] = await Promise.all([
        api.scheduledTasks.list(),
        api.orchestration.getSnapshot(),
      ]);
      setJobs(jobsList);
      setProjects(
        snapshot.projects.map((p) => ({
          id: p.id,
          title: p.title,
          workspaceRoot: p.workspaceRoot,
        })),
      );
    } catch (error) {
      console.error("Failed to fetch scheduled tasks:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const handleToggle = useCallback(async (jobId: ScheduledTaskId, enabled: boolean) => {
    try {
      const api = ensureNativeApi();
      const updated = await api.scheduledTasks.toggle({ jobId, enabled });
      setJobs((current) => current.map((j) => (j.jobId === updated.jobId ? updated : j)));
    } catch (error) {
      console.error("Failed to toggle scheduled task:", error);
    }
  }, []);

  const handleJobSaved = useCallback((job: ScheduledTask) => {
    setJobs((current) => {
      const existing = current.findIndex((j) => j.jobId === job.jobId);
      if (existing >= 0) {
        const next = [...current];
        next[existing] = job;
        return next;
      }
      return [job, ...current];
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-foreground">Scheduled Tasks</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Schedule recurring tasks that create new threads automatically.
            </p>
          </div>
          <Button size="xs" variant="outline" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-3.5" />
            Add task
          </Button>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
            <p className="text-xs text-muted-foreground">
              No scheduled tasks configured. Create one to automate thread creation.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((job) => (
              <button
                key={job.jobId}
                type="button"
                className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                onClick={() =>
                  void navigate({
                    to: "/settings/scheduled-tasks/$taskId",
                    params: { taskId: job.jobId },
                  })
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-foreground">{job.name}</span>
                    {!job.enabled && (
                      <Badge variant="outline" className="text-[10px]">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono">{cronHumanReadable(job.cronExpression)}</span>
                    <span className="text-border">|</span>
                    <span>Last: {formatRelativeDate(job.lastRunAt)}</span>
                  </div>
                </div>
                <Switch
                  checked={job.enabled}
                  onCheckedChange={(enabled) => void handleToggle(job.jobId, enabled)}
                  onClick={(event) => event.stopPropagation()}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <ScheduledTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingJob={null}
        projects={projects}
        onSave={handleJobSaved}
        onCreateJob={(input) => ensureNativeApi().scheduledTasks.create(input)}
        onUpdateJob={(input) => ensureNativeApi().scheduledTasks.update(input)}
      />
    </div>
  );
}
