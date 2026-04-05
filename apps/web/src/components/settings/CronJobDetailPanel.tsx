import type { CronJob, CronJobId, CronThreadRun } from "@t3tools/contracts";
import { ArrowLeftIcon, PlayIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";

import { ensureNativeApi } from "../../nativeApi";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { CronJobDialog } from "./CronJobDialog";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "created":
      return "default";
    case "skipped":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

export function CronJobDetailPanel() {
  const { jobId: rawJobId } = useParams({ from: "/settings/cron/$jobId" });
  const jobId = rawJobId as CronJobId;
  const navigate = useNavigate();

  const [job, setJob] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<ReadonlyArray<CronThreadRun>>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projects, setProjects] = useState<
    ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>
  >([]);

  const fetchData = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const [jobData, runsData, snapshot] = await Promise.all([
        api.cronJobs.get({ jobId }),
        api.cronJobs.listRuns({ jobId, limit: 50 }),
        api.orchestration.getSnapshot(),
      ]);
      setJob(jobData);
      setRuns(runsData);
      setProjects(
        snapshot.projects.map((p) => ({
          id: p.id,
          title: p.title,
          workspaceRoot: p.workspaceRoot,
        })),
      );
    } catch (error) {
      console.error("Failed to fetch cron job details:", error);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      const api = ensureNativeApi();
      const updated = await api.cronJobs.toggle({ jobId, enabled });
      setJob(updated);
    },
    [jobId],
  );

  const handleRunNow = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const run = await api.cronJobs.runNow({ jobId });
      setRuns((current) => [run, ...current]);
      const updated = await api.cronJobs.get({ jobId });
      setJob(updated);
    } catch (error) {
      console.error("Failed to run cron job:", error);
    }
  }, [jobId]);

  const handleDelete = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      await api.cronJobs.delete({ jobId });
      void navigate({ to: "/settings/cron", replace: true });
    } catch (error) {
      console.error("Failed to delete cron job:", error);
    }
  }, [jobId, navigate]);

  const handleJobSaved = useCallback((updated: CronJob) => {
    setJob(updated);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Job not found.</p>
      </div>
    );
  }

  const projectName =
    projects.find((p) => p.id === job.newThreadConfig?.projectId)?.title ?? "Unknown project";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-8">
        {/* Back link */}
        <button
          type="button"
          className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => void navigate({ to: "/settings/cron", replace: true })}
        >
          <ArrowLeftIcon className="size-3" />
          Back to Cron Jobs
        </button>

        {/* Job header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-foreground">{job.name}</h2>
              {job.description && (
                <p className="mt-1 text-xs text-muted-foreground">{job.description}</p>
              )}
            </div>
            <Switch
              checked={job.enabled}
              onCheckedChange={(enabled) => void handleToggle(enabled)}
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{job.cronExpression}</span>
            <span className="text-border">|</span>
            <span>{projectName}</span>
            {job.nextRunAt && (
              <>
                <span className="text-border">|</span>
                <span>Next: {formatDate(job.nextRunAt)}</span>
              </>
            )}
          </div>

          {job.newThreadConfig?.prompt && (
            <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">Prompt</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground">
                {job.newThreadConfig.prompt}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={() => setEditDialogOpen(true)}>
              <PencilIcon className="size-3" />
              Edit
            </Button>
            <Button size="xs" variant="outline" onClick={() => void handleRunNow()}>
              <PlayIcon className="size-3" />
              Run now
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <TrashIcon className="size-3" />
              Delete
            </Button>
          </div>
        </div>

        {/* Run history */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-medium text-muted-foreground">Run History</h3>

          {runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                <span>Date</span>
                <span>Status</span>
                <span>Thread</span>
              </div>
              {runs.map((run) => (
                <div
                  key={run.runId}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 rounded-md px-2 py-1.5 text-xs hover:bg-accent/30"
                >
                  <span className="text-muted-foreground">{formatDate(run.executedAt)}</span>
                  <Badge variant={statusBadgeVariant(run.status)} className="text-[10px]">
                    {run.status}
                  </Badge>
                  {run.threadId ? (
                    <button
                      type="button"
                      className="text-xs text-blue-500 hover:underline"
                      onClick={() =>
                        void navigate({
                          to: "/$threadId",
                          params: { threadId: run.threadId! },
                        })
                      }
                    >
                      Open
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/50">-</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <CronJobDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingJob={job}
        projects={projects}
        onSave={handleJobSaved}
        onCreateJob={(input) => ensureNativeApi().cronJobs.create(input)}
        onUpdateJob={(input) => ensureNativeApi().cronJobs.update(input)}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cron job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{job.name}" and all its run history. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
