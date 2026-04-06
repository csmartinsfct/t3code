import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDeleteInput,
  ScheduledTaskGetInput,
  ScheduledTaskId,
  ScheduledTaskListRunsInput,
  ScheduledTaskRunNowInput,
  ScheduledTaskStreamEvent,
  ScheduledTaskToggleInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskRun,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { ScheduledTaskError } from "@t3tools/contracts";

export interface ScheduledTaskServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ScheduledTask>, ScheduledTaskError>;
  readonly get: (input: ScheduledTaskGetInput) => Effect.Effect<ScheduledTask, ScheduledTaskError>;
  readonly create: (
    input: ScheduledTaskCreateInput,
  ) => Effect.Effect<ScheduledTask, ScheduledTaskError>;
  readonly update: (
    input: ScheduledTaskUpdateInput,
  ) => Effect.Effect<ScheduledTask, ScheduledTaskError>;
  readonly delete: (input: ScheduledTaskDeleteInput) => Effect.Effect<void, ScheduledTaskError>;
  readonly toggle: (
    input: ScheduledTaskToggleInput,
  ) => Effect.Effect<ScheduledTask, ScheduledTaskError>;
  readonly runNow: (
    input: ScheduledTaskRunNowInput,
  ) => Effect.Effect<ScheduledTaskRun, ScheduledTaskError>;
  readonly listRuns: (
    input: ScheduledTaskListRunsInput,
  ) => Effect.Effect<ReadonlyArray<ScheduledTaskRun>, ScheduledTaskError>;
  readonly executeJob: (
    jobId: ScheduledTaskId,
    scheduledAt: string,
  ) => Effect.Effect<ScheduledTaskRun, ScheduledTaskError>;
  readonly executeDueJobs: (now: string) => Effect.Effect<void, ScheduledTaskError>;
  readonly catchUpMissedRuns: () => Effect.Effect<void, ScheduledTaskError>;
  readonly streamEvents: Stream.Stream<ScheduledTaskStreamEvent>;
}

export class ScheduledTaskService extends ServiceMap.Service<
  ScheduledTaskService,
  ScheduledTaskServiceShape
>()("t3/scheduledTasks/Services/ScheduledTasks/ScheduledTaskService") {}
