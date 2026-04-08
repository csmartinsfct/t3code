import {
  IsoDateTime,
  NonNegativeInt,
  OrchestrationRunId,
  OrchestrationRunPhase,
  OrchestrationRunStatus,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PersistedOrchestrationRun = Schema.Struct({
  id: OrchestrationRunId,
  orchestrationThreadId: ThreadId,
  projectId: ProjectId,
  status: OrchestrationRunStatus,
  ticketOrderJson: Schema.String,
  currentTicketIndex: Schema.Int,
  currentPhase: OrchestrationRunPhase,
  reviewIteration: NonNegativeInt,
  maxReviewIterations: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PersistedOrchestrationRun = typeof PersistedOrchestrationRun.Type;

export const OrchestrationRunLookupInput = Schema.Struct({
  runId: OrchestrationRunId,
});
export type OrchestrationRunLookupInput = typeof OrchestrationRunLookupInput.Type;

export const OrchestrationRunByThreadLookupInput = Schema.Struct({
  orchestrationThreadId: ThreadId,
});
export type OrchestrationRunByThreadLookupInput = typeof OrchestrationRunByThreadLookupInput.Type;

export const OrchestrationRunListByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestrationRunListByProjectInput = typeof OrchestrationRunListByProjectInput.Type;

export interface OrchestrationRunRepositoryShape {
  readonly create: (
    input: PersistedOrchestrationRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly update: (
    input: PersistedOrchestrationRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: OrchestrationRunLookupInput,
  ) => Effect.Effect<Option.Option<PersistedOrchestrationRun>, ProjectionRepositoryError>;

  readonly getByOrchestrationThreadId: (
    input: OrchestrationRunByThreadLookupInput,
  ) => Effect.Effect<Option.Option<PersistedOrchestrationRun>, ProjectionRepositoryError>;

  readonly listByProject: (
    input: OrchestrationRunListByProjectInput,
  ) => Effect.Effect<ReadonlyArray<PersistedOrchestrationRun>, ProjectionRepositoryError>;

  readonly deleteById: (
    input: OrchestrationRunLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class OrchestrationRunRepository extends ServiceMap.Service<
  OrchestrationRunRepository,
  OrchestrationRunRepositoryShape
>()("t3/persistence/Services/OrchestrationRuns/OrchestrationRunRepository") {}
