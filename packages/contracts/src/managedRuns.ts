import { Schema } from "effect";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";
import { ServiceHealthCheck } from "./orchestration";
import { TerminalSessionSnapshot } from "./terminal";

export const ManagedRunId = TrimmedNonEmptyString.pipe(Schema.brand("ManagedRunId"));
export type ManagedRunId = typeof ManagedRunId.Type;

export const ManagedRunStatus = Schema.Literals([
  "starting",
  "running",
  "completed",
  "failed",
  "stopped",
  "lost",
]);
export type ManagedRunStatus = typeof ManagedRunStatus.Type;

export const ManagedRunLaunchMode = Schema.Literal("attached");
export type ManagedRunLaunchMode = typeof ManagedRunLaunchMode.Type;

export const ManagedRunLogStream = Schema.Literals(["pty", "stdout", "stderr"]);
export type ManagedRunLogStream = typeof ManagedRunLogStream.Type;

export const ManagedRunEvidenceType = Schema.Literals(["process", "url", "docker"]);
export type ManagedRunEvidenceType = typeof ManagedRunEvidenceType.Type;

export const ManagedRunEvidenceSource = Schema.Literals(["declared", "inferred"]);
export type ManagedRunEvidenceSource = typeof ManagedRunEvidenceSource.Type;

export const ManagedRunValidationStatus = Schema.Literals(["unknown", "healthy", "unhealthy"]);
export type ManagedRunValidationStatus = typeof ManagedRunValidationStatus.Type;

export const ManagedRunInferenceStatus = Schema.Literals([
  "pending",
  "ready",
  "failed",
  "ungrounded",
]);
export type ManagedRunInferenceStatus = typeof ManagedRunInferenceStatus.Type;

export const ManagedRunInferenceConfidence = Schema.Literals(["high", "medium", "low"]);
export type ManagedRunInferenceConfidence = typeof ManagedRunInferenceConfidence.Type;

export const ManagedRunInferenceGroundingSource = Schema.Literals(["log", "declared", "evidence"]);
export type ManagedRunInferenceGroundingSource = typeof ManagedRunInferenceGroundingSource.Type;

export const ManagedRunRuntimeServiceRole = Schema.Literals([
  "frontend",
  "backend",
  "proxy",
  "worker",
  "database",
  "devtool",
  "unknown",
]);
export type ManagedRunRuntimeServiceRole = typeof ManagedRunRuntimeServiceRole.Type;

export const ManagedRunDeclaredServiceSnapshot = Schema.Struct({
  name: TrimmedNonEmptyString,
  healthCheck: ServiceHealthCheck,
});
export type ManagedRunDeclaredServiceSnapshot = typeof ManagedRunDeclaredServiceSnapshot.Type;

export const ManagedRunRuntimeService = Schema.Struct({
  declaredServiceName: Schema.NullOr(TrimmedNonEmptyString),
  resolvedName: TrimmedNonEmptyString,
  role: ManagedRunRuntimeServiceRole,
  canonicalHealthCheck: Schema.NullOr(ServiceHealthCheck),
  validationStatus: ManagedRunValidationStatus,
  inferenceConfidence: ManagedRunInferenceConfidence,
  inferenceSource: Schema.Literal("llm"),
  groundedBy: Schema.Array(ManagedRunInferenceGroundingSource),
  evidenceLines: Schema.Array(Schema.String),
  lastCheckedAt: Schema.NullOr(IsoDateTime),
});
export type ManagedRunRuntimeService = typeof ManagedRunRuntimeService.Type;

const ManagedRunPort = Schema.Int.check(Schema.isGreaterThan(0)).check(
  Schema.isLessThanOrEqualTo(65_535),
);

const ManagedRunProcessEvidenceValue = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  command: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  startedAt: Schema.optional(IsoDateTime),
});

const ManagedRunUrlEvidenceValue = Schema.Struct({
  url: TrimmedNonEmptyString,
  port: Schema.optional(ManagedRunPort),
});

const ManagedRunDockerEvidenceValue = Schema.Struct({
  project: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
});

const ManagedRunEvidenceBaseFields = {
  source: ManagedRunEvidenceSource,
  createdAt: IsoDateTime,
} as const;

export const ManagedRunProcessEvidence = Schema.Struct({
  ...ManagedRunEvidenceBaseFields,
  type: Schema.Literal("process"),
  value: ManagedRunProcessEvidenceValue,
});
export type ManagedRunProcessEvidence = typeof ManagedRunProcessEvidence.Type;

export const ManagedRunUrlEvidence = Schema.Struct({
  ...ManagedRunEvidenceBaseFields,
  type: Schema.Literal("url"),
  value: ManagedRunUrlEvidenceValue,
});
export type ManagedRunUrlEvidence = typeof ManagedRunUrlEvidence.Type;

export const ManagedRunDockerEvidence = Schema.Struct({
  ...ManagedRunEvidenceBaseFields,
  type: Schema.Literal("docker"),
  value: ManagedRunDockerEvidenceValue,
});
export type ManagedRunDockerEvidence = typeof ManagedRunDockerEvidence.Type;

export const ManagedRunEvidence = Schema.Union([
  ManagedRunProcessEvidence,
  ManagedRunUrlEvidence,
  ManagedRunDockerEvidence,
]);
export type ManagedRunEvidence = typeof ManagedRunEvidence.Type;

export const ManagedRunSummary = Schema.Struct({
  runId: ManagedRunId,
  projectId: ProjectId,
  scriptId: TrimmedNonEmptyString,
  createdByThreadId: Schema.NullOr(ThreadId),
  lastTouchedByThreadId: Schema.NullOr(ThreadId),
  cwd: TrimmedNonEmptyString,
  launchMode: ManagedRunLaunchMode,
  status: ManagedRunStatus,
  detectedUrl: Schema.NullOr(TrimmedNonEmptyString),
  detectedPort: Schema.NullOr(ManagedRunPort),
  terminalThreadId: Schema.NullOr(TrimmedNonEmptyString),
  terminalId: Schema.NullOr(TrimmedNonEmptyString),
  terminalPid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  lastExitCode: Schema.NullOr(Schema.Int),
  lastExitSignal: Schema.NullOr(Schema.Int),
  declaredServices: Schema.Array(ManagedRunDeclaredServiceSnapshot),
  runtimeServices: Schema.Array(ManagedRunRuntimeService),
  inferenceStatus: ManagedRunInferenceStatus,
  inferenceUpdatedAt: Schema.NullOr(IsoDateTime),
  inferenceError: Schema.NullOr(TrimmedString),
});
export type ManagedRunSummary = typeof ManagedRunSummary.Type;

export const ManagedRunInferenceRecordBase = Schema.Struct({
  inferenceId: TrimmedNonEmptyString,
  runId: ManagedRunId,
  projectId: ProjectId,
  scriptId: TrimmedNonEmptyString,
  scriptName: Schema.NullOr(TrimmedString),
  cwd: TrimmedNonEmptyString,
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  status: Schema.Literals(["ready", "failed", "ungrounded"]),
  createdAt: IsoDateTime,
});
export type ManagedRunInferenceRecordBase = typeof ManagedRunInferenceRecordBase.Type;

export const ManagedRunInferenceRecordSummary = Schema.Struct({
  ...ManagedRunInferenceRecordBase.fields,
  runtimeServiceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ManagedRunInferenceRecordSummary = typeof ManagedRunInferenceRecordSummary.Type;

export const ManagedRunInferenceRecordDetail = Schema.Struct({
  ...ManagedRunInferenceRecordSummary.fields,
  declaredServices: Schema.Array(ManagedRunDeclaredServiceSnapshot),
  normalizedPayload: Schema.Unknown,
  rawPayload: Schema.Unknown,
  inferenceError: Schema.NullOr(TrimmedString),
  groundingFailures: Schema.Array(Schema.String),
  evidenceExcerpt: Schema.Array(Schema.String),
});
export type ManagedRunInferenceRecordDetail = typeof ManagedRunInferenceRecordDetail.Type;

export const ManagedRunDetail = Schema.Struct({
  ...ManagedRunSummary.fields,
  lastError: Schema.NullOr(TrimmedString),
  logsExpireAt: Schema.NullOr(IsoDateTime),
  evidence: Schema.Array(ManagedRunEvidence),
  latestInference: Schema.NullOr(
    Schema.Struct({
      inferenceId: TrimmedNonEmptyString,
      provider: TrimmedNonEmptyString,
      model: TrimmedNonEmptyString,
      rawPayload: Schema.Unknown,
      normalizedPayload: Schema.Unknown,
      createdAt: IsoDateTime,
    }),
  ),
});
export type ManagedRunDetail = typeof ManagedRunDetail.Type;

export const ManagedRunLogLine = Schema.Struct({
  timestamp: IsoDateTime,
  stream: ManagedRunLogStream,
  line: Schema.String,
});
export type ManagedRunLogLine = typeof ManagedRunLogLine.Type;

export const ManagedRunListInput = Schema.Struct({
  projectId: ProjectId,
  includeHistorical: Schema.optional(Schema.Boolean),
});
export type ManagedRunListInput = typeof ManagedRunListInput.Type;

export const ManagedRunGetInput = Schema.Struct({
  runId: ManagedRunId,
});
export type ManagedRunGetInput = typeof ManagedRunGetInput.Type;

export const ManagedRunGetLogsInput = Schema.Struct({
  runId: ManagedRunId,
  stream: Schema.optional(ManagedRunLogStream),
  tailLines: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type ManagedRunGetLogsInput = typeof ManagedRunGetLogsInput.Type;

export const ManagedRunStopInput = Schema.Struct({
  runId: ManagedRunId,
});
export type ManagedRunStopInput = typeof ManagedRunStopInput.Type;

export const ManagedRunListInferenceRecordsInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  projectId: Schema.optional(ProjectId),
  scriptId: Schema.optional(TrimmedNonEmptyString),
});
export type ManagedRunListInferenceRecordsInput = typeof ManagedRunListInferenceRecordsInput.Type;

export const ManagedRunGetInferenceRecordInput = Schema.Struct({
  inferenceId: TrimmedNonEmptyString,
});
export type ManagedRunGetInferenceRecordInput = typeof ManagedRunGetInferenceRecordInput.Type;

const ManagedRunLaunchEnvKey = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
).check(Schema.isMaxLength(128));
const ManagedRunLaunchEnvValue = Schema.String.check(Schema.isMaxLength(8_192));

export const ManagedRunLaunchProjectScriptInput = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  scriptId: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  env: Schema.optional(
    Schema.Record(ManagedRunLaunchEnvKey, ManagedRunLaunchEnvValue).check(
      Schema.isMaxProperties(128),
    ),
  ),
});
export type ManagedRunLaunchProjectScriptInput = typeof ManagedRunLaunchProjectScriptInput.Type;

export const ManagedRunLaunchProjectScriptResult = Schema.Struct({
  run: ManagedRunSummary,
  terminal: TerminalSessionSnapshot,
});
export type ManagedRunLaunchProjectScriptResult = typeof ManagedRunLaunchProjectScriptResult.Type;

export const ManagedRunStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    projectId: ProjectId,
    runs: Schema.Array(ManagedRunSummary),
  }),
  Schema.Struct({
    type: Schema.Literal("upserted"),
    projectId: ProjectId,
    run: ManagedRunSummary,
  }),
]);
export type ManagedRunStreamEvent = typeof ManagedRunStreamEvent.Type;

export class ManagedRunNotFoundError extends Schema.TaggedErrorClass<ManagedRunNotFoundError>()(
  "ManagedRunNotFoundError",
  {
    runId: ManagedRunId,
  },
) {
  override get message() {
    return `Unknown managed run: ${this.runId}`;
  }
}

export class ManagedRunProjectLookupError extends Schema.TaggedErrorClass<ManagedRunProjectLookupError>()(
  "ManagedRunProjectLookupError",
  {
    projectId: ProjectId,
    message: TrimmedNonEmptyString,
  },
) {}

export class ManagedRunScriptLookupError extends Schema.TaggedErrorClass<ManagedRunScriptLookupError>()(
  "ManagedRunScriptLookupError",
  {
    projectId: ProjectId,
    scriptId: TrimmedNonEmptyString,
  },
) {
  override get message() {
    return `Unknown project script '${this.scriptId}' for project '${this.projectId}'.`;
  }
}

export class ManagedRunOperationError extends Schema.TaggedErrorClass<ManagedRunOperationError>()(
  "ManagedRunOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ManagedRunInferenceRecordNotFoundError extends Schema.TaggedErrorClass<ManagedRunInferenceRecordNotFoundError>()(
  "ManagedRunInferenceRecordNotFoundError",
  {
    inferenceId: TrimmedNonEmptyString,
  },
) {
  override get message() {
    return `Unknown managed run inference record: ${this.inferenceId}`;
  }
}

export const ManagedRunError = Schema.Union([
  ManagedRunNotFoundError,
  ManagedRunProjectLookupError,
  ManagedRunScriptLookupError,
  ManagedRunOperationError,
  ManagedRunInferenceRecordNotFoundError,
]);
export type ManagedRunError = typeof ManagedRunError.Type;
