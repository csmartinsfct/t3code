import {
  type ScheduledTask,
  type ScheduledTaskId,
  ScheduledTaskNotFoundError,
  ScheduledTaskOperationError,
  ScheduledTaskValidationError,
  type ScheduledTaskStreamEvent,
  type ScheduledTaskRun,
  CommandId,
  ThreadId,
  ScheduledTaskId as ScheduledTaskIdSchema,
  ScheduledTaskRunId,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, Option, PubSub, Scope, Stream } from "effect";
import { CronExpressionParser } from "cron-parser";

import { ScheduledTaskRepository } from "../../persistence/Services/ScheduledTasks.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ScheduledTaskService,
  type ScheduledTaskServiceShape,
} from "../Services/ScheduledTasks.ts";

const nowIso = () => new Date().toISOString();

function computeNextRunAt(cronExpression: string): string | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

function validateCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

const toScheduledTaskOperationError = (operation: string) => (cause: unknown) =>
  new ScheduledTaskOperationError({
    operation,
    message: cause instanceof Error ? cause.message : "Unknown error",
    cause: cause instanceof Error ? cause : undefined,
  });

const makeScheduledTaskService = Effect.gen(function* () {
  const repo = yield* ScheduledTaskRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const eventsPubSub = yield* PubSub.unbounded<ScheduledTaskStreamEvent>();

  const requireJob = (
    jobId: ScheduledTaskId,
  ): Effect.Effect<ScheduledTask, ScheduledTaskNotFoundError | ScheduledTaskOperationError> =>
    repo.getJobById({ jobId }).pipe(
      Effect.mapError(toScheduledTaskOperationError("requireJob")),
      Effect.flatMap((opt) =>
        Option.isSome(opt)
          ? Effect.succeed(opt.value)
          : Effect.fail(new ScheduledTaskNotFoundError({ jobId })),
      ),
    );

  const publishEvent = (event: ScheduledTaskStreamEvent) =>
    PubSub.publish(eventsPubSub, event).pipe(Effect.asVoid);

  const list: ScheduledTaskServiceShape["list"] = () =>
    repo.listJobs().pipe(Effect.mapError(toScheduledTaskOperationError("list")));

  const get: ScheduledTaskServiceShape["get"] = (input) => requireJob(input.jobId);

  const create: ScheduledTaskServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      if (!validateCronExpression(input.cronExpression)) {
        return yield* Effect.fail(
          new ScheduledTaskValidationError({
            field: "cronExpression",
            message: "Invalid cron expression",
          }),
        );
      }

      const now = nowIso();
      const jobId = ScheduledTaskIdSchema.makeUnsafe(crypto.randomUUID());
      const nextRunAt = input.enabled ? computeNextRunAt(input.cronExpression) : null;

      const job: ScheduledTask = {
        jobId,
        name: input.name,
        description: input.description ?? null,
        cronExpression: input.cronExpression,
        enabled: input.enabled,
        jobType: input.jobType,
        newThreadConfig: input.newThreadConfig ?? null,
        createdAt: now,
        updatedAt: now,
        lastRunAt: null,
        nextRunAt,
      };

      yield* repo.createJob(job).pipe(Effect.mapError(toScheduledTaskOperationError("create")));
      return job;
    });

  const update: ScheduledTaskServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* requireJob(input.jobId);

      if (input.cronExpression !== undefined && !validateCronExpression(input.cronExpression)) {
        return yield* Effect.fail(
          new ScheduledTaskValidationError({
            field: "cronExpression",
            message: "Invalid cron expression",
          }),
        );
      }

      const cronExpr = input.cronExpression ?? existing.cronExpression;
      const enabled = input.enabled ?? existing.enabled;

      const updated: ScheduledTask = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description !== undefined ? input.description : existing.description,
        cronExpression: cronExpr,
        enabled,
        newThreadConfig:
          input.newThreadConfig !== undefined ? input.newThreadConfig : existing.newThreadConfig,
        updatedAt: nowIso(),
        nextRunAt: enabled ? computeNextRunAt(cronExpr) : null,
      };

      yield* repo.updateJob(updated).pipe(Effect.mapError(toScheduledTaskOperationError("update")));
      return updated;
    });

  const del: ScheduledTaskServiceShape["delete"] = (input) =>
    Effect.gen(function* () {
      yield* requireJob(input.jobId);
      yield* repo
        .deleteJob({ jobId: input.jobId })
        .pipe(Effect.mapError(toScheduledTaskOperationError("delete")));
    });

  const toggle: ScheduledTaskServiceShape["toggle"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* requireJob(input.jobId);
      const updated: ScheduledTask = {
        ...existing,
        enabled: input.enabled,
        updatedAt: nowIso(),
        nextRunAt: input.enabled ? computeNextRunAt(existing.cronExpression) : null,
      };
      yield* repo.updateJob(updated).pipe(Effect.mapError(toScheduledTaskOperationError("toggle")));
      return updated;
    });

  const listRuns: ScheduledTaskServiceShape["listRuns"] = (input) =>
    repo.listRunsByJob(input).pipe(Effect.mapError(toScheduledTaskOperationError("listRuns")));

  const executeJob: ScheduledTaskServiceShape["executeJob"] = (jobId, scheduledAt) =>
    Effect.gen(function* () {
      const job = yield* requireJob(jobId);
      const now = nowIso();

      // Duplicate prevention: check if last run's thread is still pending
      const latestRunOpt = yield* repo
        .getLatestRunByJob({ jobId })
        .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.getLatestRun")));

      if (Option.isSome(latestRunOpt)) {
        const latestRun = latestRunOpt.value;
        if (latestRun.status === "created" && latestRun.threadId !== null) {
          // Check if thread still exists and has no user messages
          const snapshot = yield* snapshotQuery
            .getSnapshot()
            .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.getSnapshot")));
          const thread = snapshot.threads.find((t) => t.id === latestRun.threadId);
          if (thread && thread.messages.filter((m) => m.role === "user").length === 0) {
            const skippedRun: ScheduledTaskRun = {
              runId: ScheduledTaskRunId.makeUnsafe(crypto.randomUUID()),
              jobId,
              status: "skipped",
              threadId: latestRun.threadId,
              errorMessage: "Previous run thread still pending",
              scheduledAt,
              executedAt: now,
            };
            yield* repo
              .createRun(skippedRun)
              .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.createSkippedRun")));
            // Advance nextRunAt even on skip
            yield* repo
              .updateJob({
                ...job,
                lastRunAt: now,
                updatedAt: now,
                nextRunAt: job.enabled ? computeNextRunAt(job.cronExpression) : null,
              })
              .pipe(
                Effect.mapError(toScheduledTaskOperationError("executeJob.updateJobAfterSkip")),
              );
            yield* publishEvent({
              type: "job_fired",
              jobId,
              jobName: job.name,
              run: skippedRun,
            });
            return skippedRun;
          }
        }
      }

      // Execute the job based on type
      if (job.jobType === "new_thread" && job.newThreadConfig) {
        const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
        const commandId = CommandId.makeUnsafe(crypto.randomUUID());
        const config = job.newThreadConfig;

        // Look up project for defaults
        const snapshot = yield* snapshotQuery
          .getSnapshot()
          .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.getSnapshot")));
        const project = snapshot.projects.find((p) => p.id === config.projectId);
        const modelSelection = project?.defaultModelSelection ?? {
          provider: "codex" as const,
          model: "codex-mini-latest",
        };

        // Build initial draft from config (prompt, skills, autoSend)
        const initialDraft = {
          ...(config.prompt ? { prompt: config.prompt } : {}),
          ...(config.skillIds && config.skillIds.length > 0 ? { skillIds: config.skillIds } : {}),
          ...(config.autoSend ? { autoSend: config.autoSend } : {}),
        };
        const hasInitialDraft = Object.keys(initialDraft).length > 0;

        // Dispatch thread.create command
        yield* orchestrationEngine
          .dispatch({
            type: "thread.create",
            commandId,
            threadId,
            projectId: config.projectId,
            title: `${job.name} — ${new Date(scheduledAt).toLocaleDateString()}`,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            ...(hasInitialDraft ? { initialDraft } : {}),
            createdAt: now,
          })
          .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.dispatch")));

        const run: ScheduledTaskRun = {
          runId: ScheduledTaskRunId.makeUnsafe(crypto.randomUUID()),
          jobId,
          status: "created",
          threadId,
          errorMessage: null,
          scheduledAt,
          executedAt: now,
        };

        yield* repo
          .createRun(run)
          .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.createRun")));

        yield* repo
          .updateJob({
            ...job,
            lastRunAt: now,
            updatedAt: now,
            nextRunAt: job.enabled ? computeNextRunAt(job.cronExpression) : null,
          })
          .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.updateJob")));

        yield* publishEvent({ type: "job_fired", jobId, jobName: job.name, run });
        return run;
      }

      // Fallback: job type not actionable
      const failedRun: ScheduledTaskRun = {
        runId: ScheduledTaskRunId.makeUnsafe(crypto.randomUUID()),
        jobId,
        status: "failed",
        threadId: null,
        errorMessage: `Unsupported or misconfigured job type: ${job.jobType}`,
        scheduledAt,
        executedAt: now,
      };
      yield* repo
        .createRun(failedRun)
        .pipe(Effect.mapError(toScheduledTaskOperationError("executeJob.createFailedRun")));
      yield* publishEvent({ type: "job_fired", jobId, jobName: job.name, run: failedRun });
      return failedRun;
    });

  const runNow: ScheduledTaskServiceShape["runNow"] = (input) => executeJob(input.jobId, nowIso());

  const executeDueJobs: ScheduledTaskServiceShape["executeDueJobs"] = (now) =>
    Effect.gen(function* () {
      const dueJobs = yield* repo
        .listEnabledDueJobs({ beforeOrAt: now })
        .pipe(Effect.mapError(toScheduledTaskOperationError("executeDueJobs")));
      for (const job of dueJobs) {
        yield* executeJob(job.jobId, job.nextRunAt ?? now).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Scheduled task execution failed", { jobId: job.jobId, error }),
          ),
        );
      }
    });

  const catchUpMissedRuns: ScheduledTaskServiceShape["catchUpMissedRuns"] = () =>
    executeDueJobs(nowIso());

  // Start the background scheduler: catch up missed runs, then tick every 30s
  const SCHEDULER_TICK_MS = 30_000;
  const workerScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void));

  yield* catchUpMissedRuns().pipe(
    Effect.catch(() =>
      Effect.logWarning("Failed to catch up missed scheduled task runs on startup"),
    ),
  );
  yield* Effect.forever(
    Effect.suspend(() => executeDueJobs(nowIso())).pipe(
      Effect.catch(() => Effect.logWarning("Scheduled task scheduler tick failed")),
      Effect.delay(SCHEDULER_TICK_MS),
    ),
  ).pipe(Effect.forkIn(workerScope));
  yield* Effect.logInfo("Scheduled task scheduler started");

  return {
    list,
    get,
    create,
    update,
    delete: del,
    toggle,
    runNow,
    listRuns,
    executeJob,
    executeDueJobs,
    catchUpMissedRuns,
    streamEvents: Stream.fromPubSub(eventsPubSub),
  } satisfies ScheduledTaskServiceShape;
});

export const ScheduledTaskServiceLive = Layer.effect(
  ScheduledTaskService,
  makeScheduledTaskService,
);
