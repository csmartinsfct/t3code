import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  CronJobListEnabledDueInput,
  CronJobLookupInput,
  CronJobRepository,
  type CronJobRepositoryShape,
  CronJobRow,
  CronThreadRunListInput,
  CronThreadRunRow,
  PersistedCronJob,
  PersistedCronThreadRun,
} from "../Services/CronJobs.ts";
import type { PersistedCronJob as PersistedCronJobType } from "../Services/CronJobs.ts";

/** Convert a CronJobRow (with numeric enabled) to PersistedCronJob (with boolean enabled). */
const toPersistedJob = (row: typeof CronJobRow.Type): PersistedCronJobType => ({
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

const makeCronJobRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const writeCronJob = SqlSchema.void({
    Request: PersistedCronJob,
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

  const getCronJob = SqlSchema.findOneOption({
    Request: CronJobLookupInput,
    Result: CronJobRow,
    execute: ({ jobId }) =>
      sql`SELECT ${sql.literal(JOB_SELECT)} FROM crons_jobs WHERE job_id = ${jobId}`,
  });

  const listAllJobs = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: CronJobRow,
    execute: () => sql`SELECT ${sql.literal(JOB_SELECT)} FROM crons_jobs ORDER BY created_at DESC`,
  });

  const listDueJobs = SqlSchema.findAll({
    Request: CronJobListEnabledDueInput,
    Result: CronJobRow,
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

  const writeCronThreadRun = SqlSchema.void({
    Request: PersistedCronThreadRun,
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
    Request: CronThreadRunListInput,
    Result: CronThreadRunRow,
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
    Request: CronJobLookupInput,
    Result: CronThreadRunRow,
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
      writeCronJob(input).pipe(
        Effect.mapError(toPersistenceSqlError("CronJobRepository.createJob:query")),
      ),
    updateJob: (input) =>
      writeCronJob(input).pipe(
        Effect.mapError(toPersistenceSqlError("CronJobRepository.updateJob:query")),
      ),
    getJobById: (input) =>
      getCronJob(input).pipe(
        Effect.map((opt) => opt.pipe(Option.map(toPersistedJob))),
        Effect.mapError(toPersistenceSqlError("CronJobRepository.getJobById:query")),
      ),
    listJobs: () =>
      listAllJobs({}).pipe(
        Effect.map((rows) => rows.map(toPersistedJob)),
        Effect.mapError(toPersistenceSqlError("CronJobRepository.listJobs:query")),
      ),
    listEnabledDueJobs: (input) =>
      listDueJobs(input).pipe(
        Effect.map((rows) => rows.map(toPersistedJob)),
        Effect.mapError(toPersistenceSqlError("CronJobRepository.listEnabledDueJobs:query")),
      ),
    deleteJob: ({ jobId }) =>
      sql`DELETE FROM crons_thread_runs WHERE job_id = ${jobId}`.pipe(
        Effect.andThen(sql`DELETE FROM crons_jobs WHERE job_id = ${jobId}`),
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("CronJobRepository.deleteJob:query")),
      ),
    createRun: (input) =>
      writeCronThreadRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("CronJobRepository.createRun:query")),
      ),
    listRunsByJob: (input) =>
      listRuns(input).pipe(
        Effect.mapError(toPersistenceSqlError("CronJobRepository.listRunsByJob:query")),
      ),
    getLatestRunByJob: (input) =>
      latestRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("CronJobRepository.getLatestRunByJob:query")),
      ),
  } satisfies CronJobRepositoryShape;
});

export const CronJobRepositoryLive = Layer.effect(CronJobRepository, makeCronJobRepository);
