import {
  ManagedRunDetail,
  ManagedRunEvidence,
  ManagedRunId,
  ManagedRunStatus,
  ManagedRunSummary,
  ProjectId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PersistedManagedRun = Schema.Struct({
  ...ManagedRunSummary.fields,
  lastError: Schema.NullOr(Schema.String),
  logsExpireAt: Schema.NullOr(Schema.String),
});
export type PersistedManagedRun = typeof PersistedManagedRun.Type;

export const CreateManagedRunInput = PersistedManagedRun;
export type CreateManagedRunInput = typeof CreateManagedRunInput.Type;

export const UpdateManagedRunInput = PersistedManagedRun;
export type UpdateManagedRunInput = typeof UpdateManagedRunInput.Type;

export const ManagedRunLookupInput = Schema.Struct({
  runId: ManagedRunId,
});
export type ManagedRunLookupInput = typeof ManagedRunLookupInput.Type;

export const ManagedRunListByProjectInput = Schema.Struct({
  projectId: ProjectId,
  includeHistorical: Schema.optional(Schema.Boolean),
});
export type ManagedRunListByProjectInput = typeof ManagedRunListByProjectInput.Type;

export const ManagedRunListByStatusesInput = Schema.Struct({
  statuses: Schema.Array(ManagedRunStatus),
});
export type ManagedRunListByStatusesInput = typeof ManagedRunListByStatusesInput.Type;

export const ManagedRunEvidenceInsert = Schema.Struct({
  runId: ManagedRunId,
  evidence: ManagedRunEvidence,
});
export type ManagedRunEvidenceInsert = typeof ManagedRunEvidenceInsert.Type;

export interface ManagedRunRepositoryShape {
  readonly create: (input: CreateManagedRunInput) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly update: (input: UpdateManagedRunInput) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: ManagedRunLookupInput,
  ) => Effect.Effect<Option.Option<PersistedManagedRun>, ProjectionRepositoryError>;
  readonly listByProject: (
    input: ManagedRunListByProjectInput,
  ) => Effect.Effect<ReadonlyArray<PersistedManagedRun>, ProjectionRepositoryError>;
  readonly listByStatuses: (
    input: ManagedRunListByStatusesInput,
  ) => Effect.Effect<ReadonlyArray<PersistedManagedRun>, ProjectionRepositoryError>;
  readonly insertEvidence: (
    input: ManagedRunEvidenceInsert,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listEvidence: (
    input: ManagedRunLookupInput,
  ) => Effect.Effect<ReadonlyArray<ManagedRunEvidence>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: ManagedRunLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ManagedRunRepository extends ServiceMap.Service<
  ManagedRunRepository,
  ManagedRunRepositoryShape
>()("t3/persistence/Services/ManagedRuns/ManagedRunRepository") {}
