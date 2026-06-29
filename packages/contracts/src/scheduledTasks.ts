import { Schema } from "effect";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ModelSelection } from "./orchestration";

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export const ScheduledTaskId = TrimmedNonEmptyString.pipe(Schema.brand("ScheduledTaskId"));
export type ScheduledTaskId = typeof ScheduledTaskId.Type;

export const ScheduledTaskRunId = TrimmedNonEmptyString.pipe(Schema.brand("ScheduledTaskRunId"));
export type ScheduledTaskRunId = typeof ScheduledTaskRunId.Type;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ScheduledTaskType = Schema.Literal("new_thread");
export type ScheduledTaskType = typeof ScheduledTaskType.Type;

export const ScheduledTaskRunStatus = Schema.Literals(["created", "skipped", "failed"]);
export type ScheduledTaskRunStatus = typeof ScheduledTaskRunStatus.Type;

// ---------------------------------------------------------------------------
// Config schemas (per task type)
// ---------------------------------------------------------------------------

export const ScheduledTaskNewThreadConfig = Schema.Struct({
  projectId: ProjectId,
  skillIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  prompt: Schema.optional(Schema.String),
  autoSend: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  modelSelection: Schema.optional(ModelSelection),
});
export type ScheduledTaskNewThreadConfig = typeof ScheduledTaskNewThreadConfig.Type;

// ---------------------------------------------------------------------------
// Core domain schemas
// ---------------------------------------------------------------------------

export const ScheduledTask = Schema.Struct({
  jobId: ScheduledTaskId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  cronExpression: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  jobType: ScheduledTaskType,
  newThreadConfig: Schema.NullOr(ScheduledTaskNewThreadConfig),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastRunAt: Schema.NullOr(IsoDateTime),
  nextRunAt: Schema.NullOr(IsoDateTime),
});
export type ScheduledTask = typeof ScheduledTask.Type;

export const ScheduledTaskRun = Schema.Struct({
  runId: ScheduledTaskRunId,
  jobId: ScheduledTaskId,
  status: ScheduledTaskRunStatus,
  threadId: Schema.NullOr(ThreadId),
  errorMessage: Schema.NullOr(Schema.String),
  scheduledAt: IsoDateTime,
  executedAt: IsoDateTime,
});
export type ScheduledTaskRun = typeof ScheduledTaskRun.Type;

// ---------------------------------------------------------------------------
// RPC input schemas
// ---------------------------------------------------------------------------

export const ScheduledTaskCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  cronExpression: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  jobType: ScheduledTaskType,
  newThreadConfig: Schema.optional(ScheduledTaskNewThreadConfig),
});
export type ScheduledTaskCreateInput = typeof ScheduledTaskCreateInput.Type;

export const ScheduledTaskUpdateInput = Schema.Struct({
  jobId: ScheduledTaskId,
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  cronExpression: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.optional(Schema.Boolean),
  newThreadConfig: Schema.optional(ScheduledTaskNewThreadConfig),
});
export type ScheduledTaskUpdateInput = typeof ScheduledTaskUpdateInput.Type;

export const ScheduledTaskGetInput = Schema.Struct({ jobId: ScheduledTaskId });
export type ScheduledTaskGetInput = typeof ScheduledTaskGetInput.Type;

export const ScheduledTaskDeleteInput = Schema.Struct({ jobId: ScheduledTaskId });
export type ScheduledTaskDeleteInput = typeof ScheduledTaskDeleteInput.Type;

export const ScheduledTaskToggleInput = Schema.Struct({
  jobId: ScheduledTaskId,
  enabled: Schema.Boolean,
});
export type ScheduledTaskToggleInput = typeof ScheduledTaskToggleInput.Type;

export const ScheduledTaskRunNowInput = Schema.Struct({ jobId: ScheduledTaskId });
export type ScheduledTaskRunNowInput = typeof ScheduledTaskRunNowInput.Type;

export const ScheduledTaskListRunsInput = Schema.Struct({
  jobId: ScheduledTaskId,
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ScheduledTaskListRunsInput = typeof ScheduledTaskListRunsInput.Type;

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

export const ScheduledTaskStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("job_fired"),
    jobId: ScheduledTaskId,
    jobName: TrimmedNonEmptyString,
    run: ScheduledTaskRun,
  }),
]);
export type ScheduledTaskStreamEvent = typeof ScheduledTaskStreamEvent.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ScheduledTaskNotFoundError extends Schema.TaggedErrorClass<ScheduledTaskNotFoundError>()(
  "ScheduledTaskNotFoundError",
  {
    jobId: ScheduledTaskId,
  },
) {
  override get message() {
    return `Unknown scheduled task: ${this.jobId}`;
  }
}

export class ScheduledTaskOperationError extends Schema.TaggedErrorClass<ScheduledTaskOperationError>()(
  "ScheduledTaskOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ScheduledTaskValidationError extends Schema.TaggedErrorClass<ScheduledTaskValidationError>()(
  "ScheduledTaskValidationError",
  {
    field: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}

export const ScheduledTaskError = Schema.Union([
  ScheduledTaskNotFoundError,
  ScheduledTaskOperationError,
  ScheduledTaskValidationError,
]);
export type ScheduledTaskError = typeof ScheduledTaskError.Type;
