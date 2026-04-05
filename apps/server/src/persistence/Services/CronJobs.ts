import { CronJob, CronJobId, CronJobNewThreadConfig, CronThreadRun } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PersistedCronJob = Schema.Struct({
  ...CronJob.fields,
});
export type PersistedCronJob = typeof PersistedCronJob.Type;

export const PersistedCronThreadRun = Schema.Struct({
  ...CronThreadRun.fields,
});
export type PersistedCronThreadRun = typeof PersistedCronThreadRun.Type;

export const CronJobLookupInput = Schema.Struct({ jobId: CronJobId });
export type CronJobLookupInput = typeof CronJobLookupInput.Type;

export const CronThreadRunListInput = Schema.Struct({
  jobId: CronJobId,
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});
export type CronThreadRunListInput = typeof CronThreadRunListInput.Type;

export const CronJobListEnabledDueInput = Schema.Struct({
  beforeOrAt: Schema.String,
});
export type CronJobListEnabledDueInput = typeof CronJobListEnabledDueInput.Type;

/** Row schema for reading from SQLite — enabled is INTEGER, newThreadConfig is JSON string. */
export const CronJobRow = Schema.Struct({
  ...PersistedCronJob.fields,
  enabled: Schema.Number,
  newThreadConfig: Schema.NullOr(CronJobNewThreadConfig).pipe(Schema.fromJsonString),
});

export const CronThreadRunRow = Schema.Struct({
  ...PersistedCronThreadRun.fields,
});

export interface CronJobRepositoryShape {
  readonly createJob: (input: PersistedCronJob) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateJob: (input: PersistedCronJob) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getJobById: (
    input: CronJobLookupInput,
  ) => Effect.Effect<Option.Option<PersistedCronJob>, ProjectionRepositoryError>;
  readonly listJobs: () => Effect.Effect<
    ReadonlyArray<PersistedCronJob>,
    ProjectionRepositoryError
  >;
  readonly listEnabledDueJobs: (
    input: CronJobListEnabledDueInput,
  ) => Effect.Effect<ReadonlyArray<PersistedCronJob>, ProjectionRepositoryError>;
  readonly deleteJob: (input: CronJobLookupInput) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly createRun: (
    input: PersistedCronThreadRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listRunsByJob: (
    input: CronThreadRunListInput,
  ) => Effect.Effect<ReadonlyArray<PersistedCronThreadRun>, ProjectionRepositoryError>;
  readonly getLatestRunByJob: (
    input: CronJobLookupInput,
  ) => Effect.Effect<Option.Option<PersistedCronThreadRun>, ProjectionRepositoryError>;
}

export class CronJobRepository extends ServiceMap.Service<
  CronJobRepository,
  CronJobRepositoryShape
>()("t3/persistence/Services/CronJobs/CronJobRepository") {}
