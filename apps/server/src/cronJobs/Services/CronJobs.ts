import type {
  CronJob,
  CronJobCreateInput,
  CronJobDeleteInput,
  CronJobGetInput,
  CronJobId,
  CronJobListRunsInput,
  CronJobRunNowInput,
  CronJobStreamEvent,
  CronJobToggleInput,
  CronJobUpdateInput,
  CronThreadRun,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { CronJobError } from "@t3tools/contracts";

export interface CronJobServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<CronJob>, CronJobError>;
  readonly get: (input: CronJobGetInput) => Effect.Effect<CronJob, CronJobError>;
  readonly create: (input: CronJobCreateInput) => Effect.Effect<CronJob, CronJobError>;
  readonly update: (input: CronJobUpdateInput) => Effect.Effect<CronJob, CronJobError>;
  readonly delete: (input: CronJobDeleteInput) => Effect.Effect<void, CronJobError>;
  readonly toggle: (input: CronJobToggleInput) => Effect.Effect<CronJob, CronJobError>;
  readonly runNow: (input: CronJobRunNowInput) => Effect.Effect<CronThreadRun, CronJobError>;
  readonly listRuns: (
    input: CronJobListRunsInput,
  ) => Effect.Effect<ReadonlyArray<CronThreadRun>, CronJobError>;
  readonly executeJob: (
    jobId: CronJobId,
    scheduledAt: string,
  ) => Effect.Effect<CronThreadRun, CronJobError>;
  readonly executeDueJobs: (now: string) => Effect.Effect<void, CronJobError>;
  readonly catchUpMissedRuns: () => Effect.Effect<void, CronJobError>;
  readonly streamEvents: Stream.Stream<CronJobStreamEvent>;
}

export class CronJobService extends ServiceMap.Service<CronJobService, CronJobServiceShape>()(
  "t3/cronJobs/Services/CronJobs/CronJobService",
) {}
