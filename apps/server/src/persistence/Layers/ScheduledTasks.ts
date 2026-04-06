import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ScheduledTaskListEnabledDueInput,
  ScheduledTaskLookupInput,
  ScheduledTaskRepository,
  type ScheduledTaskRepositoryShape,
  ScheduledTaskRow,
  ScheduledTaskRunListInput,
  ScheduledTaskRunRow,
  PersistedScheduledTask,
  PersistedScheduledTaskRun,
} from "../Services/ScheduledTasks.ts";
import type { PersistedScheduledTask as PersistedScheduledTaskType } from "../Services/ScheduledTasks.ts";

/** Convert a ScheduledTaskRow (with numeric enabled) to PersistedScheduledTask (with boolean enabled). */
const toPersistedTask = (row: typeof ScheduledTaskRow.Type): PersistedScheduledTaskType => ({
  ...row,
  enabled: row.enabled === 1,
});

const JOB_SELECT = `
  job_id AS "jobId",
  name,
  description,
  cron_expression AS "cronExpression",
  CASE WHEN enabled = 1 THEN 1 ELSE 0 END AS "enabled",
  job_type AS "jobType",
  new_thread_config_json AS "newThreadConfig",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  last_run_at AS "lastRunAt",
  next_run_at AS "nextRunAt"
`;

const RUN_SELECT = `
  run_id AS "runId",
  job_id AS "jobId",
  status,
  thread_id AS "threadId",
  error_message AS "errorMessage",
  scheduled_at AS "scheduledAt",
  executed_at AS "executedAt"
`;

const makeScheduledTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const writeScheduledTask = SqlSchema.void({
    Request: PersistedScheduledTask,
    execute: (row) =>
      sql`
        INSERT INTO crons_jobs (
          job_id, name, description, cron_expression, enabled,
          job_type, new_thread_config_json,
          created_at, updated_at, last_run_at, next_run_at
        )
        VALUES (
          ${row.jobId}, ${row.name}, ${row.description}, ${row.cronExpression},
          ${row.enabled ? 1 : 0}, ${row.jobType},
          ${row.newThreadConfig ? JSON.stringify(row.newThreadConfig) : null},
          ${row.createdAt}, ${row.updatedAt}, ${row.lastRunAt}, ${row.nextRunAt}
        )
        ON CONFLICT (job_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          cron_expression = excluded.cron_expression,
          enabled = excluded.enabled,
          job_type = excluded.job_type,
          new_thread_config_json = excluded.new_thread_config_json,
          updated_at = excluded.updated_at,
          last_run_at = excluded.last_run_at,
          next_run_at = excluded.next_run_at
      `,
  });

  const getScheduledTask = SqlSchema.findOneOption({
    Request: ScheduledTaskLookupInput,
    Result: ScheduledTaskRow,
    execute: ({ jobId }) =>
      sql`SELECT ${sql.literal(JOB_SELECT)} FROM crons_jobs WHERE job_id = ${jobId}`,
  });

  const listAllJobs = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ScheduledTaskRow,
    execute: () => sql`SELECT ${sql.literal(JOB_SELECT)} FROM crons_jobs ORDER BY created_at DESC`,
  });

  const listDueJobs = SqlSchema.findAll({
    Request: ScheduledTaskListEnabledDueInput,
    Result: ScheduledTaskRow,
    execute: ({ beforeOrAt }) =>
      sql`
        SELECT ${sql.literal(JOB_SELECT)}
        FROM crons_jobs
        WHERE enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ${beforeOrAt}
        ORDER BY next_run_at ASC
      `,
  });

  const writeScheduledTaskRun = SqlSchema.void({
    Request: PersistedScheduledTaskRun,
    execute: (row) =>
      sql`
        INSERT INTO crons_thread_runs (
          run_id, job_id, status, thread_id, error_message,
          scheduled_at, executed_at
        )
        VALUES (
          ${row.runId}, ${row.jobId}, ${row.status}, ${row.threadId},
          ${row.errorMessage}, ${row.scheduledAt}, ${row.executedAt}
        )
      `,
  });

  const listRuns = SqlSchema.findAll({
    Request: ScheduledTaskRunListInput,
    Result: ScheduledTaskRunRow,
    execute: ({ jobId, limit, offset }) =>
      sql`
        SELECT ${sql.literal(RUN_SELECT)}
        FROM crons_thread_runs
        WHERE job_id = ${jobId}
        ORDER BY executed_at DESC
        LIMIT ${limit ?? 50} OFFSET ${offset ?? 0}
      `,
  });

  const latestRun = SqlSchema.findOneOption({
    Request: ScheduledTaskLookupInput,
    Result: ScheduledTaskRunRow,
    execute: ({ jobId }) =>
      sql`
        SELECT ${sql.literal(RUN_SELECT)}
        FROM crons_thread_runs
        WHERE job_id = ${jobId}
        ORDER BY executed_at DESC
        LIMIT 1
      `,
  });

  return {
    createJob: (input) =>
      writeScheduledTask(input).pipe(
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.createJob:query")),
      ),
    updateJob: (input) =>
      writeScheduledTask(input).pipe(
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.updateJob:query")),
      ),
    getJobById: (input) =>
      getScheduledTask(input).pipe(
        Effect.map((opt) => opt.pipe(Option.map(toPersistedTask))),
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.getJobById:query")),
      ),
    listJobs: () =>
      listAllJobs({}).pipe(
        Effect.map((rows) => rows.map(toPersistedTask)),
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.listJobs:query")),
      ),
    listEnabledDueJobs: (input) =>
      listDueJobs(input).pipe(
        Effect.map((rows) => rows.map(toPersistedTask)),
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.listEnabledDueJobs:query")),
      ),
    deleteJob: ({ jobId }) =>
      sql`DELETE FROM crons_thread_runs WHERE job_id = ${jobId}`.pipe(
        Effect.andThen(sql`DELETE FROM crons_jobs WHERE job_id = ${jobId}`),
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.deleteJob:query")),
      ),
    createRun: (input) =>
      writeScheduledTaskRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.createRun:query")),
      ),
    listRunsByJob: (input) =>
      listRuns(input).pipe(
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.listRunsByJob:query")),
      ),
    getLatestRunByJob: (input) =>
      latestRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("ScheduledTaskRepository.getLatestRunByJob:query")),
      ),
  } satisfies ScheduledTaskRepositoryShape;
});

export const ScheduledTaskRepositoryLive = Layer.effect(
  ScheduledTaskRepository,
  makeScheduledTaskRepository,
);
