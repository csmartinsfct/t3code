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

export const DeclaredServiceStatus = Schema.Literals(["unknown", "healthy", "unhealthy"]);
export type DeclaredServiceStatus = typeof DeclaredServiceStatus.Type;

export const ManagedRunServiceSnapshot = Schema.Struct({
  name: TrimmedNonEmptyString,
  healthCheck: ServiceHealthCheck,
  status: DeclaredServiceStatus,
  lastCheckedAt: Schema.NullOr(IsoDateTime),
});
export type ManagedRunServiceSnapshot = typeof ManagedRunServiceSnapshot.Type;

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
  serviceStatuses: Schema.Array(ManagedRunServiceSnapshot),
});
export type ManagedRunSummary = typeof ManagedRunSummary.Type;

export const ManagedRunDetail = Schema.Struct({
  ...ManagedRunSummary.fields,
  lastError: Schema.NullOr(TrimmedString),
  logsExpireAt: Schema.NullOr(IsoDateTime),
  evidence: Schema.Array(ManagedRunEvidence),
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

export const ManagedRunError = Schema.Union([
  ManagedRunNotFoundError,
  ManagedRunProjectLookupError,
  ManagedRunScriptLookupError,
  ManagedRunOperationError,
]);
export type ManagedRunError = typeof ManagedRunError.Type;
