import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import {
  ManagedRunEvidence,
  ManagedRunEvidenceSource,
  ManagedRunEvidenceType,
  ManagedRunServiceSnapshot,
} from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  CreateManagedRunInput,
  ManagedRunEvidenceInsert,
  ManagedRunListByProjectInput,
  ManagedRunListByStatusesInput,
  ManagedRunLookupInput,
  ManagedRunRepository,
  type ManagedRunRepositoryShape,
  PersistedManagedRun,
  UpdateManagedRunInput,
} from "../Services/ManagedRuns.ts";

const ManagedRunRow = Schema.Struct({
  ...PersistedManagedRun.fields,
  serviceStatuses: Schema.Array(ManagedRunServiceSnapshot).pipe(Schema.fromJsonString),
});
const ManagedRunEvidenceRow = Schema.Struct({
  type: ManagedRunEvidenceType,
  source: ManagedRunEvidenceSource,
  value: Schema.Unknown.pipe(Schema.fromJsonString),
  createdAt: Schema.String,
});

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
          services_json
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
          ${JSON.stringify(row.serviceStatuses)}
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
          services_json = excluded.services_json
      `,
  });

  const getManagedRun = SqlSchema.findOneOption({
    Request: ManagedRunLookupInput,
    Result: ManagedRunRow,
    execute: ({ runId }) =>
      sql`
        SELECT
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
          last_error AS "lastError",
          logs_expire_at AS "logsExpireAt",
          services_json AS "serviceStatuses"
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
            SELECT
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
              last_error AS "lastError",
              logs_expire_at AS "logsExpireAt",
              services_json AS "serviceStatuses"
            FROM managed_runs
            WHERE project_id = ${projectId}
            ORDER BY updated_at DESC, created_at DESC
          `
        : sql`
            SELECT
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
              last_error AS "lastError",
              logs_expire_at AS "logsExpireAt",
              services_json AS "serviceStatuses"
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
      const statusList = statuses.map((s) => `'${s}'`).join(", ");
      return sql`
        SELECT
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
          last_error AS "lastError",
          logs_expire_at AS "logsExpireAt",
          services_json AS "serviceStatuses"
        FROM managed_runs
        WHERE status IN (${sql.literal(statusList)})
        ORDER BY updated_at DESC, created_at DESC
      `;
    },
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
          value_json AS "value",
          created_at AS "createdAt"
        FROM managed_run_evidence
        WHERE run_id = ${runId}
        ORDER BY row_id ASC
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
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.listEvidence:query")),
        Effect.map((rows) =>
          rows.map(
            (row) =>
              ({
                type: row.type,
                source: row.source,
                value: row.value,
                createdAt: row.createdAt,
              }) as ManagedRunEvidence,
          ),
        ),
      ),
    deleteById: ({ runId }) =>
      sql`DELETE FROM managed_run_evidence WHERE run_id = ${runId}`.pipe(
        Effect.andThen(sql`DELETE FROM managed_runs WHERE run_id = ${runId}`),
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ManagedRunRepository.deleteById:query")),
      ),
  } satisfies ManagedRunRepositoryShape;
});

export const ManagedRunRepositoryLive = Layer.effect(
  ManagedRunRepository,
  makeManagedRunRepository,
);
