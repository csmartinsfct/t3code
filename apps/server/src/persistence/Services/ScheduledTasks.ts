import {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskNewThreadConfig,
  ScheduledTaskRun,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PersistedScheduledTask = Schema.Struct({
  ...ScheduledTask.fields,
});
export type PersistedScheduledTask = typeof PersistedScheduledTask.Type;

export const PersistedScheduledTaskRun = Schema.Struct({
  ...ScheduledTaskRun.fields,
});
export type PersistedScheduledTaskRun = typeof PersistedScheduledTaskRun.Type;

export const ScheduledTaskLookupInput = Schema.Struct({ jobId: ScheduledTaskId });
export type ScheduledTaskLookupInput = typeof ScheduledTaskLookupInput.Type;

export const ScheduledTaskRunListInput = Schema.Struct({
  jobId: ScheduledTaskId,
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});
export type ScheduledTaskRunListInput = typeof ScheduledTaskRunListInput.Type;

export const ScheduledTaskListEnabledDueInput = Schema.Struct({
  beforeOrAt: Schema.String,
});
export type ScheduledTaskListEnabledDueInput = typeof ScheduledTaskListEnabledDueInput.Type;

/** Row schema for reading from SQLite — enabled is INTEGER, newThreadConfig is JSON string. */
export const ScheduledTaskRow = Schema.Struct({
  ...PersistedScheduledTask.fields,
  enabled: Schema.Number,
  newThreadConfig: Schema.NullOr(ScheduledTaskNewThreadConfig).pipe(Schema.fromJsonString),
});

export const ScheduledTaskRunRow = Schema.Struct({
  ...PersistedScheduledTaskRun.fields,
});

export interface ScheduledTaskRepositoryShape {
  readonly createJob: (
    input: PersistedScheduledTask,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateJob: (
    input: PersistedScheduledTask,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getJobById: (
    input: ScheduledTaskLookupInput,
  ) => Effect.Effect<Option.Option<PersistedScheduledTask>, ProjectionRepositoryError>;
  readonly listJobs: () => Effect.Effect<
    ReadonlyArray<PersistedScheduledTask>,
    ProjectionRepositoryError
  >;
  readonly listEnabledDueJobs: (
    input: ScheduledTaskListEnabledDueInput,
  ) => Effect.Effect<ReadonlyArray<PersistedScheduledTask>, ProjectionRepositoryError>;
  readonly deleteJob: (
    input: ScheduledTaskLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly createRun: (
    input: PersistedScheduledTaskRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listRunsByJob: (
    input: ScheduledTaskRunListInput,
  ) => Effect.Effect<ReadonlyArray<PersistedScheduledTaskRun>, ProjectionRepositoryError>;
  readonly getLatestRunByJob: (
    input: ScheduledTaskLookupInput,
  ) => Effect.Effect<Option.Option<PersistedScheduledTaskRun>, ProjectionRepositoryError>;
}

export class ScheduledTaskRepository extends ServiceMap.Service<
  ScheduledTaskRepository,
  ScheduledTaskRepositoryShape
>()("t3/persistence/Services/ScheduledTasks/ScheduledTaskRepository") {}
