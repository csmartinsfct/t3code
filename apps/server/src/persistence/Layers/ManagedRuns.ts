import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import {
  ManagedRunDeclaredServiceSnapshot,
  ManagedRunEvidence,
  ManagedRunEvidenceSource,
  ManagedRunEvidenceType,
  ManagedRunRuntimeService,
} from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  CreateManagedRunInferenceRecordInput,
  ManagedRunEvidenceInsert,
  ManagedRunListByProjectInput,
  ManagedRunListByStatusesInput,
  ManagedRunLookupInput,
  ManagedRunRepository,
  type ManagedRunRepositoryShape,
  PersistedManagedRun,
  PersistedManagedRunInferenceRecordDetail,
  PersistedManagedRunInferenceRecordSummary,
} from "../Services/ManagedRuns.ts";

const ManagedRunRow = Schema.Struct({
  ...PersistedManagedRun.fields,
  declaredServices: Schema.Array(ManagedRunDeclaredServiceSnapshot).pipe(Schema.fromJsonString),
  runtimeServices: Schema.Array(ManagedRunRuntimeService).pipe(Schema.fromJsonString),
});

const ManagedRunEvidenceRow = Schema.Struct({
  type: ManagedRunEvidenceType,
  source: ManagedRunEvidenceSource,
  value: Schema.Unknown.pipe(Schema.fromJsonString),
  createdAt: Schema.String,
});

const ManagedRunInferenceRecordSummaryRow = Schema.Struct({
  ...PersistedManagedRunInferenceRecordSummary.fields,
});

const ManagedRunInferenceRecordDetailRow = Schema.Struct({
  ...PersistedManagedRunInferenceRecordDetail.fields,
  declaredServices: Schema.Array(ManagedRunDeclaredServiceSnapshot).pipe(Schema.fromJsonString),
  normalizedPayload: Schema.Unknown.pipe(Schema.fromJsonString),
  rawPayload: Schema.Unknown.pipe(Schema.fromJsonString),
  groundingFailures: Schema.Array(Schema.String).pipe(Schema.fromJsonString),
  evidenceExcerpt: Schema.Array(Schema.String).pipe(Schema.fromJsonString),
});

const MANAGED_RUN_SELECT = `
  run_id AS "runId",
  project_id AS "projectId",
  script_id AS "scriptId",
  created_by_thread_id AS "createdByThreadId",
  last_touched_by_thread_id AS "lastTouchedByThreadId",
  terminal_thread_id AS "terminalThreadId",
  terminal_id AS "terminalId",
  cwd,
  launch_mode AS "launchMode",
  status,
  detected_url AS "detectedUrl",
  detected_port AS "detectedPort",
  terminal_pid AS "terminalPid",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  started_at AS "startedAt",
  completed_at AS "completedAt",
  last_exit_code AS "lastExitCode",
  last_exit_signal AS "lastExitSignal",
  declared_services_json AS "declaredServices",
  runtime_services_json AS "runtimeServices",
  inference_status AS "inferenceStatus",
  inference_updated_at AS "inferenceUpdatedAt",
  inference_error AS "inferenceError",
  last_error AS "lastError",
  logs_expire_at AS "logsExpireAt"
`;

const INFERENCE_SUMMARY_SELECT = `
  inference_id AS "inferenceId",
  run_id AS "runId",
  project_id AS "projectId",
  script_id AS "scriptId",
  NULL AS "scriptName",
  cwd,
  provider,
  model,
  status,
  created_at AS "createdAt",
  json_array_length(
    json_extract(normalized_payload_json, '$.runtimeServices')
  ) AS "runtimeServiceCount"
`;

const INFERENCE_DETAIL_SELECT = `
  ${INFERENCE_SUMMARY_SELECT},
  declared_services_json AS "declaredServices",
  normalized_payload_json AS "normalizedPayload",
  raw_payload_json AS "rawPayload",
  inference_error AS "inferenceError",
  grounding_failures_json AS "groundingFailures",
  evidence_excerpt_json AS "evidenceExcerpt"
`;

const makeManagedRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const writeManagedRun = SqlSchema.void({
    Request: PersistedManagedRun,
    execute: (row) =>
      sql`
        INSERT INTO managed_runs (
          run_id,
          project_id,
          script_id,
          created_by_thread_id,
          last_touched_by_thread_id,
          terminal_thread_id,
          terminal_id,
          cwd,
          launch_mode,
          status,
          detected_url,
          detected_port,
          terminal_pid,
          last_error,
          created_at,
          updated_at,
          started_at,
          completed_at,
          last_exit_code,
          last_exit_signal,
          logs_expire_at,
          declared_services_json,
          runtime_services_json,
          inference_status,
          inference_updated_at,
          inference_error
        )
        VALUES (
          ${row.runId},
          ${row.projectId},
          ${row.scriptId},
          ${row.createdByThreadId},
          ${row.lastTouchedByThreadId},
          ${row.terminalThreadId},
          ${row.terminalId},
          ${row.cwd},
          ${row.launchMode},
          ${row.status},
          ${row.detectedUrl},
          ${row.detectedPort},
          ${row.terminalPid},
          ${row.lastError},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.lastExitCode},
          ${row.lastExitSignal},
          ${row.logsExpireAt},
          ${JSON.stringify(row.declaredServices)},
          ${JSON.stringify(row.runtimeServices)},
          ${row.inferenceStatus},
          ${row.inferenceUpdatedAt},
          ${row.inferenceError}
        )
        ON CONFLICT (run_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          script_id = excluded.script_id,
          created_by_thread_id = excluded.created_by_thread_id,
          last_touched_by_thread_id = excluded.last_touched_by_thread_id,
          terminal_thread_id = excluded.terminal_thread_id,
          terminal_id = excluded.terminal_id,
          cwd = excluded.cwd,
          launch_mode = excluded.launch_mode,
          status = excluded.status,
          detected_url = excluded.detected_url,
          detected_port = excluded.detected_port,
          terminal_pid = excluded.terminal_pid,
          last_error = excluded.last_error,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          last_exit_code = excluded.last_exit_code,
          last_exit_signal = excluded.last_exit_signal,
          logs_expire_at = excluded.logs_expire_at,
          declared_services_json = excluded.declared_services_json,
          runtime_services_json = excluded.runtime_services_json,
          inference_status = excluded.inference_status,
          inference_updated_at = excluded.inference_updated_at,
          inference_error = excluded.inference_error
      `,
  });

  const writeInferenceRecord = SqlSchema.void({
    Request: CreateManagedRunInferenceRecordInput,
    execute: (row) =>
      sql`
        INSERT INTO managed_run_inferences (
          inference_id,
          run_id,
          project_id,
          script_id,
          cwd,
          provider,
          model,
          status,
          declared_services_json,
          normalized_payload_json,
          raw_payload_json,
          inference_error,
          grounding_failures_json,
          evidence_excerpt_json,
          created_at
        )
        VALUES (
          ${row.inferenceId},
          ${row.runId},
          ${row.projectId},
          ${row.scriptId},
          ${row.cwd},
          ${row.provider},
          ${row.model},
          ${row.status},
          ${JSON.stringify(row.declaredServices)},
          ${JSON.stringify(row.normalizedPayload)},
          ${JSON.stringify(row.rawPayload)},
          ${row.inferenceError},
          ${JSON.stringify(row.groundingFailures)},
          ${JSON.stringify(row.evidenceExcerpt)},
          ${row.createdAt}
        )
      `,
  });

  const getManagedRun = SqlSchema.findOneOption({
    Request: ManagedRunLookupInput,
    Result: ManagedRunRow,
    execute: ({ runId }) =>
      sql`
        SELECT ${sql.literal(MANAGED_RUN_SELECT)}
        FROM managed_runs
        WHERE run_id = ${runId}
      `,
  });

  const listManagedRunsByProject = SqlSchema.findAll({
    Request: ManagedRunListByProjectInput,
    Result: ManagedRunRow,
    execute: ({ projectId, includeHistorical }) =>
      includeHistorical
        ? sql`
            SELECT ${sql.literal(MANAGED_RUN_SELECT)}
            FROM managed_runs
            WHERE project_id = ${projectId}
            ORDER BY updated_at DESC, created_at DESC
          `
        : sql`
            SELECT ${sql.literal(MANAGED_RUN_SELECT)}
            FROM managed_runs
            WHERE project_id = ${projectId}
              AND (status = 'starting' OR status = 'running')
            ORDER BY updated_at DESC, created_at DESC
          `,
  });

  const listManagedRunsByStatuses = SqlSchema.findAll({
    Request: ManagedRunListByStatusesInput,
    Result: ManagedRunRow,
    execute: ({ statuses }) => {
      const statusList = statuses.map((status) => `'${status}'`).join(", ");
      return sql`
        SELECT ${sql.literal(MANAGED_RUN_SELECT)}
        FROM managed_runs
        WHERE status IN (${sql.literal(statusList)})
        ORDER BY updated_at DESC, created_at DESC
      `;
    },
  });

  const listInferenceRecordRows = SqlSchema.findAll({
    Request: Schema.Struct({
      limit: Schema.optional(Schema.Int),
      projectId: Schema.optional(Schema.String),
      scriptId: Schema.optional(Schema.String),
    }),
    Result: ManagedRunInferenceRecordSummaryRow,
    execute: ({ limit, projectId, scriptId }) =>
      projectId && scriptId
        ? sql`
            SELECT ${sql.literal(INFERENCE_SUMMARY_SELECT)}
            FROM managed_run_inferences
            WHERE project_id = ${projectId}
              AND script_id = ${scriptId}
            ORDER BY created_at DESC
            LIMIT ${limit ?? 100}
          `
        : projectId
          ? sql`
              SELECT ${sql.literal(INFERENCE_SUMMARY_SELECT)}
              FROM managed_run_inferences
              WHERE project_id = ${projectId}
              ORDER BY created_at DESC
              LIMIT ${limit ?? 100}
            `
          : scriptId
            ? sql`
                SELECT ${sql.literal(INFERENCE_SUMMARY_SELECT)}
                FROM managed_run_inferences
                WHERE script_id = ${scriptId}
                ORDER BY created_at DESC
                LIMIT ${limit ?? 100}
              `
            : sql`
                SELECT ${sql.literal(INFERENCE_SUMMARY_SELECT)}
                FROM managed_run_inferences
                ORDER BY created_at DESC
                LIMIT ${limit ?? 100}
              `,
  });

  const getInferenceRecord = SqlSchema.findOneOption({
    Request: Schema.Struct({ inferenceId: Schema.String }),
    Result: ManagedRunInferenceRecordDetailRow,
    execute: ({ inferenceId }) =>
      sql`
        SELECT ${sql.literal(INFERENCE_DETAIL_SELECT)}
        FROM managed_run_inferences
        WHERE inference_id = ${inferenceId}
      `,
  });

  const getLatestInferenceRecord = SqlSchema.findOneOption({
    Request: ManagedRunLookupInput,
    Result: ManagedRunInferenceRecordDetailRow,
    execute: ({ runId }) =>
      sql`
        SELECT ${sql.literal(INFERENCE_DETAIL_SELECT)}
        FROM managed_run_inferences
        WHERE run_id = ${runId}
        ORDER BY created_at DESC
        LIMIT 1
      `,
  });

  const insertEvidenceRow = SqlSchema.void({
    Request: ManagedRunEvidenceInsert,
    execute: ({ runId, evidence }) =>
      sql`
        INSERT OR IGNORE INTO managed_run_evidence (
          run_id,
          type,
          source,
          value_json,
          created_at
        )
        VALUES (
          ${runId},
          ${evidence.type},
          ${evidence.source},
          ${JSON.stringify(evidence.value)},
          ${evidence.createdAt}
        )
      `,
  });

  const listEvidenceRows = SqlSchema.findAll({
    Request: ManagedRunLookupInput,
    Result: ManagedRunEvidenceRow,
    execute: ({ runId }) =>
      sql`
        SELECT
          type,
          source,
          value_json AS value,
          created_at AS "createdAt"
        FROM managed_run_evidence
        WHERE run_id = ${runId}
        ORDER BY created_at ASC
      `,
  });

  const deleteManagedRun = SqlSchema.void({
    Request: ManagedRunLookupInput,
    execute: ({ runId }) =>
      sql`
        DELETE FROM managed_runs
        WHERE run_id = ${runId}
      `,
  });

  return {
    create: (input) =>
      writeManagedRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.create:query")),
      ),
    update: (input) =>
      writeManagedRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.update:query")),
      ),
    getById: (input) =>
      getManagedRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.getById:query")),
      ),
    listByProject: (input) =>
      listManagedRunsByProject(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.listByProject:query")),
      ),
    listByStatuses: (input) =>
      listManagedRunsByStatuses(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.listByStatuses:query")),
      ),
    insertEvidence: (input) =>
      insertEvidenceRow(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.insertEvidence:query")),
      ),
    listEvidence: (input) =>
      listEvidenceRows(input).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => {
            switch (row.type) {
              case "process":
                return Schema.decodeEffect(ManagedRunEvidence)({
                  type: "process",
                  source: row.source,
                  value: row.value as never,
                  createdAt: row.createdAt,
                });
              case "url":
                return Schema.decodeEffect(ManagedRunEvidence)({
                  type: "url",
                  source: row.source,
                  value: row.value as never,
                  createdAt: row.createdAt,
                });
              case "docker":
                return Schema.decodeEffect(ManagedRunEvidence)({
                  type: "docker",
                  source: row.source,
                  value: row.value as never,
                  createdAt: row.createdAt,
                });
            }
          }),
        ),
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.listEvidence:query")),
      ),
    deleteById: (input) =>
      deleteManagedRun(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.deleteById:query")),
      ),
    createInferenceRecord: (input) =>
      writeInferenceRecord(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.createInferenceRecord:query")),
      ),
    listInferenceRecords: (input) =>
      listInferenceRecordRows({
        ...(input.limit ? { limit: input.limit } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.scriptId ? { scriptId: input.scriptId } : {}),
      }).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.listInferenceRecords:query")),
      ),
    getInferenceRecordById: (input) =>
      getInferenceRecord(input).pipe(
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.getInferenceRecordById:query")),
      ),
    getLatestInferenceRecordByRunId: (input) =>
      getLatestInferenceRecord(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ManagedRunRepository.getLatestInferenceRecordByRunId:query"),
        ),
      ),
  } satisfies ManagedRunRepositoryShape;
});

export const ManagedRunRepositoryLive = Layer.effect(
  ManagedRunRepository,
  makeManagedRunRepository,
);
