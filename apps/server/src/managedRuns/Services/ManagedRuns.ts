import {
  ManagedRunDetail,
  ManagedRunError,
  ManagedRunGetInferenceRecordInput,
  ManagedRunGetInput,
  ManagedRunGetLogsInput,
  ManagedRunInferenceRecordDetail,
  ManagedRunInferenceRecordSummary,
  ManagedRunLaunchProjectScriptInput,
  ManagedRunLaunchProjectScriptResult,
  ManagedRunListInferenceRecordsInput,
  ManagedRunListInput,
  ManagedRunLogLine,
  ManagedRunStreamEvent,
  ManagedRunSummary,
  ManagedRunStopInput,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface ManagedRunMcpAccess {
  readonly token: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}

export interface ManagedRunMcpContext {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}

export interface ManagedRunServiceShape {
  readonly launchProjectScript: (
    input: ManagedRunLaunchProjectScriptInput,
  ) => Effect.Effect<ManagedRunLaunchProjectScriptResult, ManagedRunError>;
  readonly list: (
    input: ManagedRunListInput,
  ) => Effect.Effect<ReadonlyArray<ManagedRunSummary>, ManagedRunError>;
  readonly get: (input: ManagedRunGetInput) => Effect.Effect<ManagedRunDetail, ManagedRunError>;
  readonly getLogs: (
    input: ManagedRunGetLogsInput,
  ) => Effect.Effect<ReadonlyArray<ManagedRunLogLine>, ManagedRunError>;
  readonly listInferenceRecords: (
    input: ManagedRunListInferenceRecordsInput,
  ) => Effect.Effect<ReadonlyArray<ManagedRunInferenceRecordSummary>, ManagedRunError>;
  readonly getInferenceRecord: (
    input: ManagedRunGetInferenceRecordInput,
  ) => Effect.Effect<ManagedRunInferenceRecordDetail, ManagedRunError>;
  readonly stop: (input: ManagedRunStopInput) => Effect.Effect<void, ManagedRunError>;
  readonly streamEvents: (projectId: ProjectId) => Stream.Stream<ManagedRunStreamEvent, never>;
  readonly issueMcpAccess: (
    projectId: ProjectId,
    threadId: ThreadId,
  ) => Effect.Effect<ManagedRunMcpAccess, never>;
  readonly resolveContextForToken: (
    token: string,
  ) => Effect.Effect<ManagedRunMcpContext | null, never>;
}

export class ManagedRunService extends ServiceMap.Service<
  ManagedRunService,
  ManagedRunServiceShape
>()("t3/managedRuns/Services/ManagedRuns/ManagedRunService") {}
