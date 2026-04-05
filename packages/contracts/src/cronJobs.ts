import { Schema } from "effect";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export const CronJobId = TrimmedNonEmptyString.pipe(Schema.brand("CronJobId"));
export type CronJobId = typeof CronJobId.Type;

export const CronThreadRunId = TrimmedNonEmptyString.pipe(Schema.brand("CronThreadRunId"));
export type CronThreadRunId = typeof CronThreadRunId.Type;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const CronJobType = Schema.Literal("new_thread");
export type CronJobType = typeof CronJobType.Type;

export const CronThreadRunStatus = Schema.Literals(["created", "skipped", "failed"]);
export type CronThreadRunStatus = typeof CronThreadRunStatus.Type;

// ---------------------------------------------------------------------------
// Config schemas (per job type)
// ---------------------------------------------------------------------------

export const CronJobNewThreadConfig = Schema.Struct({
  projectId: ProjectId,
  skillId: Schema.optional(TrimmedNonEmptyString),
  prompt: Schema.optional(Schema.String),
  autoSend: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type CronJobNewThreadConfig = typeof CronJobNewThreadConfig.Type;

// ---------------------------------------------------------------------------
// Core domain schemas
// ---------------------------------------------------------------------------

export const CronJob = Schema.Struct({
  jobId: CronJobId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  cronExpression: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  jobType: CronJobType,
  newThreadConfig: Schema.NullOr(CronJobNewThreadConfig),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastRunAt: Schema.NullOr(IsoDateTime),
  nextRunAt: Schema.NullOr(IsoDateTime),
});
export type CronJob = typeof CronJob.Type;

export const CronThreadRun = Schema.Struct({
  runId: CronThreadRunId,
  jobId: CronJobId,
  status: CronThreadRunStatus,
  threadId: Schema.NullOr(ThreadId),
  errorMessage: Schema.NullOr(Schema.String),
  scheduledAt: IsoDateTime,
  executedAt: IsoDateTime,
});
export type CronThreadRun = typeof CronThreadRun.Type;

// ---------------------------------------------------------------------------
// RPC input schemas
// ---------------------------------------------------------------------------

export const CronJobCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  cronExpression: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  jobType: CronJobType,
  newThreadConfig: Schema.optional(CronJobNewThreadConfig),
});
export type CronJobCreateInput = typeof CronJobCreateInput.Type;

export const CronJobUpdateInput = Schema.Struct({
  jobId: CronJobId,
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  cronExpression: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.optional(Schema.Boolean),
  newThreadConfig: Schema.optional(CronJobNewThreadConfig),
});
export type CronJobUpdateInput = typeof CronJobUpdateInput.Type;

export const CronJobGetInput = Schema.Struct({ jobId: CronJobId });
export type CronJobGetInput = typeof CronJobGetInput.Type;

export const CronJobDeleteInput = Schema.Struct({ jobId: CronJobId });
export type CronJobDeleteInput = typeof CronJobDeleteInput.Type;

export const CronJobToggleInput = Schema.Struct({
  jobId: CronJobId,
  enabled: Schema.Boolean,
});
export type CronJobToggleInput = typeof CronJobToggleInput.Type;

export const CronJobRunNowInput = Schema.Struct({ jobId: CronJobId });
export type CronJobRunNowInput = typeof CronJobRunNowInput.Type;

export const CronJobListRunsInput = Schema.Struct({
  jobId: CronJobId,
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type CronJobListRunsInput = typeof CronJobListRunsInput.Type;

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

export const CronJobStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("job_fired"),
    jobId: CronJobId,
    jobName: TrimmedNonEmptyString,
    run: CronThreadRun,
  }),
]);
export type CronJobStreamEvent = typeof CronJobStreamEvent.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CronJobNotFoundError extends Schema.TaggedErrorClass<CronJobNotFoundError>()(
  "CronJobNotFoundError",
  {
    jobId: CronJobId,
  },
) {
  override get message() {
    return `Unknown cron job: ${this.jobId}`;
  }
}

export class CronJobOperationError extends Schema.TaggedErrorClass<CronJobOperationError>()(
  "CronJobOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class CronJobValidationError extends Schema.TaggedErrorClass<CronJobValidationError>()(
  "CronJobValidationError",
  {
    field: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}

export const CronJobError = Schema.Union([
  CronJobNotFoundError,
  CronJobOperationError,
  CronJobValidationError,
]);
export type CronJobError = typeof CronJobError.Type;
