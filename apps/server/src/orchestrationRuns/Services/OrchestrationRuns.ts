import type {
  OrchestrationCancelRunInput,
  OrchestrationCreateRunInput,
  OrchestrationCreateRunResult,
  OrchestrationGetChildThreadsInput,
  OrchestrationGetRunInput,
  OrchestrationListRunsInput,
  OrchestrationPauseRunInput,
  OrchestrationResumeRunInput,
  OrchestrationRun,
  OrchestrationRunError,
  OrchestrationRunStreamEvent,
  OrchestrationRunSummary,
  OrchestrationThread,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface OrchestrationRunServiceShape {
  readonly create: (
    input: OrchestrationCreateRunInput,
  ) => Effect.Effect<OrchestrationCreateRunResult, OrchestrationRunError>;

  readonly get: (
    input: OrchestrationGetRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;

  readonly list: (
    input: OrchestrationListRunsInput,
  ) => Effect.Effect<ReadonlyArray<OrchestrationRunSummary>, OrchestrationRunError>;

  readonly getChildThreads: (
    input: OrchestrationGetChildThreadsInput,
  ) => Effect.Effect<ReadonlyArray<OrchestrationThread>, OrchestrationRunError>;

  readonly pause: (
    input: OrchestrationPauseRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;

  readonly resume: (
    input: OrchestrationResumeRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;

  readonly cancel: (
    input: OrchestrationCancelRunInput,
  ) => Effect.Effect<OrchestrationRun, OrchestrationRunError>;

  readonly streamEvents: (projectId: string) => Stream.Stream<OrchestrationRunStreamEvent, never>;
}

export class OrchestrationRunService extends ServiceMap.Service<
  OrchestrationRunService,
  OrchestrationRunServiceShape
>()("t3/orchestrationRuns/Services/OrchestrationRuns/OrchestrationRunService") {}
