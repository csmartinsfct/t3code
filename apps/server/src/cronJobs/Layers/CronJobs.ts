import {
  type CronJob,
  type CronJobId,
  CronJobNotFoundError,
  CronJobOperationError,
  CronJobValidationError,
  type CronJobStreamEvent,
  type CronThreadRun,
  CommandId,
  ThreadId,
  CronJobId as CronJobIdSchema,
  CronThreadRunId,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, Option, PubSub, Scope, Stream } from "effect";
import { CronExpressionParser } from "cron-parser";

import { CronJobRepository } from "../../persistence/Services/CronJobs.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CronJobService, type CronJobServiceShape } from "../Services/CronJobs.ts";

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

const toCronJobOperationError = (operation: string) => (cause: unknown) =>
  new CronJobOperationError({
    operation,
    message: cause instanceof Error ? cause.message : "Unknown error",
    cause: cause instanceof Error ? cause : undefined,
  });

const makeCronJobService = Effect.gen(function* () {
  const repo = yield* CronJobRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const eventsPubSub = yield* PubSub.unbounded<CronJobStreamEvent>();

  const requireJob = (
    jobId: CronJobId,
  ): Effect.Effect<CronJob, CronJobNotFoundError | CronJobOperationError> =>
    repo.getJobById({ jobId }).pipe(
      Effect.mapError(toCronJobOperationError("requireJob")),
      Effect.flatMap((opt) =>
        Option.isSome(opt)
          ? Effect.succeed(opt.value)
          : Effect.fail(new CronJobNotFoundError({ jobId })),
      ),
    );

  const publishEvent = (event: CronJobStreamEvent) =>
    PubSub.publish(eventsPubSub, event).pipe(Effect.asVoid);

  const list: CronJobServiceShape["list"] = () =>
    repo.listJobs().pipe(Effect.mapError(toCronJobOperationError("list")));

  const get: CronJobServiceShape["get"] = (input) => requireJob(input.jobId);

  const create: CronJobServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      if (!validateCronExpression(input.cronExpression)) {
        return yield* Effect.fail(
          new CronJobValidationError({
            field: "cronExpression",
            message: "Invalid cron expression",
          }),
        );
      }

      const now = nowIso();
      const jobId = CronJobIdSchema.makeUnsafe(crypto.randomUUID());
      const nextRunAt = input.enabled ? computeNextRunAt(input.cronExpression) : null;

      const job: CronJob = {
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

      yield* repo.createJob(job).pipe(Effect.mapError(toCronJobOperationError("create")));
      return job;
    });

  const update: CronJobServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* requireJob(input.jobId);

      if (input.cronExpression !== undefined && !validateCronExpression(input.cronExpression)) {
        return yield* Effect.fail(
          new CronJobValidationError({
            field: "cronExpression",
            message: "Invalid cron expression",
          }),
        );
      }

      const cronExpr = input.cronExpression ?? existing.cronExpression;
      const enabled = input.enabled ?? existing.enabled;

      const updated: CronJob = {
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

      yield* repo.updateJob(updated).pipe(Effect.mapError(toCronJobOperationError("update")));
      return updated;
    });

  const del: CronJobServiceShape["delete"] = (input) =>
    Effect.gen(function* () {
      yield* requireJob(input.jobId);
      yield* repo
        .deleteJob({ jobId: input.jobId })
        .pipe(Effect.mapError(toCronJobOperationError("delete")));
    });

  const toggle: CronJobServiceShape["toggle"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* requireJob(input.jobId);
      const updated: CronJob = {
        ...existing,
        enabled: input.enabled,
        updatedAt: nowIso(),
        nextRunAt: input.enabled ? computeNextRunAt(existing.cronExpression) : null,
      };
      yield* repo.updateJob(updated).pipe(Effect.mapError(toCronJobOperationError("toggle")));
      return updated;
    });

  const listRuns: CronJobServiceShape["listRuns"] = (input) =>
    repo.listRunsByJob(input).pipe(Effect.mapError(toCronJobOperationError("listRuns")));

  const executeJob: CronJobServiceShape["executeJob"] = (jobId, scheduledAt) =>
    Effect.gen(function* () {
      const job = yield* requireJob(jobId);
      const now = nowIso();

      // Duplicate prevention: check if last run's thread is still pending
      const latestRunOpt = yield* repo
        .getLatestRunByJob({ jobId })
        .pipe(Effect.mapError(toCronJobOperationError("executeJob.getLatestRun")));

      if (Option.isSome(latestRunOpt)) {
        const latestRun = latestRunOpt.value;
        if (latestRun.status === "created" && latestRun.threadId !== null) {
          // Check if thread still exists and has no user messages
          const snapshot = yield* snapshotQuery
            .getSnapshot()
            .pipe(Effect.mapError(toCronJobOperationError("executeJob.getSnapshot")));
          const thread = snapshot.threads.find((t) => t.id === latestRun.threadId);
          if (thread && thread.messages.filter((m) => m.role === "user").length === 0) {
            const skippedRun: CronThreadRun = {
              runId: CronThreadRunId.makeUnsafe(crypto.randomUUID()),
              jobId,
              status: "skipped",
              threadId: latestRun.threadId,
              errorMessage: "Previous run thread still pending",
              scheduledAt,
              executedAt: now,
            };
            yield* repo
              .createRun(skippedRun)
              .pipe(Effect.mapError(toCronJobOperationError("executeJob.createSkippedRun")));
            // Advance nextRunAt even on skip
            yield* repo
              .updateJob({
                ...job,
                lastRunAt: now,
                updatedAt: now,
                nextRunAt: job.enabled ? computeNextRunAt(job.cronExpression) : null,
              })
              .pipe(Effect.mapError(toCronJobOperationError("executeJob.updateJobAfterSkip")));
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
          .pipe(Effect.mapError(toCronJobOperationError("executeJob.getSnapshot")));
        const project = snapshot.projects.find((p) => p.id === config.projectId);
        const modelSelection = project?.defaultModelSelection ?? {
          provider: "codex" as const,
          model: "codex-mini-latest",
        };

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
            createdAt: now,
          })
          .pipe(Effect.mapError(toCronJobOperationError("executeJob.dispatch")));

        const run: CronThreadRun = {
          runId: CronThreadRunId.makeUnsafe(crypto.randomUUID()),
          jobId,
          status: "created",
          threadId,
          errorMessage: null,
          scheduledAt,
          executedAt: now,
        };

        yield* repo
          .createRun(run)
          .pipe(Effect.mapError(toCronJobOperationError("executeJob.createRun")));

        yield* repo
          .updateJob({
            ...job,
            lastRunAt: now,
            updatedAt: now,
            nextRunAt: job.enabled ? computeNextRunAt(job.cronExpression) : null,
          })
          .pipe(Effect.mapError(toCronJobOperationError("executeJob.updateJob")));

        yield* publishEvent({ type: "job_fired", jobId, jobName: job.name, run });
        return run;
      }

      // Fallback: job type not actionable
      const failedRun: CronThreadRun = {
        runId: CronThreadRunId.makeUnsafe(crypto.randomUUID()),
        jobId,
        status: "failed",
        threadId: null,
        errorMessage: `Unsupported or misconfigured job type: ${job.jobType}`,
        scheduledAt,
        executedAt: now,
      };
      yield* repo
        .createRun(failedRun)
        .pipe(Effect.mapError(toCronJobOperationError("executeJob.createFailedRun")));
      yield* publishEvent({ type: "job_fired", jobId, jobName: job.name, run: failedRun });
      return failedRun;
    });

  const runNow: CronJobServiceShape["runNow"] = (input) => executeJob(input.jobId, nowIso());

  const executeDueJobs: CronJobServiceShape["executeDueJobs"] = (now) =>
    Effect.gen(function* () {
      const dueJobs = yield* repo
        .listEnabledDueJobs({ beforeOrAt: now })
        .pipe(Effect.mapError(toCronJobOperationError("executeDueJobs")));
      for (const job of dueJobs) {
        yield* executeJob(job.jobId, job.nextRunAt ?? now).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Cron job execution failed", { jobId: job.jobId, error }),
          ),
        );
      }
    });

  const catchUpMissedRuns: CronJobServiceShape["catchUpMissedRuns"] = () =>
    executeDueJobs(nowIso());

  // Start the background scheduler: catch up missed runs, then tick every 30s
  const SCHEDULER_TICK_MS = 30_000;
  const workerScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(workerScope, Exit.void));

  yield* catchUpMissedRuns().pipe(
    Effect.catch(() => Effect.logWarning("Failed to catch up missed cron runs on startup")),
  );
  yield* Effect.forever(
    Effect.suspend(() => executeDueJobs(nowIso())).pipe(
      Effect.catch(() => Effect.logWarning("Cron scheduler tick failed")),
      Effect.delay(SCHEDULER_TICK_MS),
    ),
  ).pipe(Effect.forkIn(workerScope));
  yield* Effect.logInfo("Cron job scheduler started");

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
  } satisfies CronJobServiceShape;
});

export const CronJobServiceLive = Layer.effect(CronJobService, makeCronJobService);
