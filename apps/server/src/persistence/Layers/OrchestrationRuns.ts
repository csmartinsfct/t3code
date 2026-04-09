import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  OrchestrationRunByThreadLookupInput,
  OrchestrationRunListByProjectInput,
  OrchestrationRunLookupInput,
  OrchestrationRunRepository,
  type OrchestrationRunRepositoryShape,
  PersistedOrchestrationRun,
} from "../Services/OrchestrationRuns.ts";

const RUN_SELECT = `
  id,
  orchestration_thread_id AS "orchestrationThreadId",
  project_id AS "projectId",
  status,
  ticket_order_json AS "ticketOrderJson",
  current_ticket_index AS "currentTicketIndex",
  current_phase AS "currentPhase",
  review_iteration AS "reviewIteration",
  max_review_iterations AS "maxReviewIterations",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const makeOrchestrationRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRun = SqlSchema.void({
    Request: PersistedOrchestrationRun,
    execute: (row) =>
      sql`
        INSERT INTO orchestration_runs (
          id,
          orchestration_thread_id,
          project_id,
          status,
          ticket_order_json,
          current_ticket_index,
          current_phase,
          review_iteration,
          max_review_iterations,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.orchestrationThreadId},
          ${row.projectId},
          ${row.status},
          ${row.ticketOrderJson},
          ${row.currentTicketIndex},
          ${row.currentPhase},
          ${row.reviewIteration},
          ${row.maxReviewIterations},
          ${row.createdAt},
          ${row.updatedAt}
        )
      `,
  });

  const updateRun = SqlSchema.void({
    Request: PersistedOrchestrationRun,
    execute: (row) =>
      sql`
        UPDATE orchestration_runs SET
          status = ${row.status},
          ticket_order_json = ${row.ticketOrderJson},
          current_ticket_index = ${row.currentTicketIndex},
          current_phase = ${row.currentPhase},
          review_iteration = ${row.reviewIteration},
          max_review_iterations = ${row.maxReviewIterations},
          updated_at = ${row.updatedAt}
        WHERE id = ${row.id}
      `,
  });

  const getRun = SqlSchema.findOneOption({
    Request: OrchestrationRunLookupInput,
    Result: PersistedOrchestrationRun,
    execute: ({ runId }) =>
      sql`
        SELECT ${sql.literal(RUN_SELECT)}
        FROM orchestration_runs
        WHERE id = ${runId}
      `,
  });

  const listRuns = SqlSchema.findAll({
    Request: OrchestrationRunListByProjectInput,
    Result: PersistedOrchestrationRun,
    execute: ({ projectId }) =>
      sql`
        SELECT ${sql.literal(RUN_SELECT)}
        FROM orchestration_runs
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC
      `,
  });

  const getRunByOrchestrationThreadId = SqlSchema.findOneOption({
    Request: OrchestrationRunByThreadLookupInput,
    Result: PersistedOrchestrationRun,
    execute: ({ orchestrationThreadId }) =>
      sql`
        SELECT ${sql.literal(RUN_SELECT)}
        FROM orchestration_runs
        WHERE orchestration_thread_id = ${orchestrationThreadId}
      `,
  });

  const deleteRun = SqlSchema.void({
    Request: OrchestrationRunLookupInput,
    execute: ({ runId }) =>
      sql`
        DELETE FROM orchestration_runs
        WHERE id = ${runId}
      `,
  });

  const create: OrchestrationRunRepositoryShape["create"] = (input) =>
    insertRun(input).pipe(
      Effect.mapError(toPersistenceSqlError("OrchestrationRunRepository.create:query")),
    );

  const update: OrchestrationRunRepositoryShape["update"] = (input) =>
    updateRun(input).pipe(
      Effect.mapError(toPersistenceSqlError("OrchestrationRunRepository.update:query")),
    );

  const getById: OrchestrationRunRepositoryShape["getById"] = (input) =>
    getRun(input).pipe(
      Effect.mapError(toPersistenceSqlError("OrchestrationRunRepository.getById:query")),
    );

  const listByProject: OrchestrationRunRepositoryShape["listByProject"] = (input) =>
    listRuns(input).pipe(
      Effect.mapError(toPersistenceSqlError("OrchestrationRunRepository.listByProject:query")),
    );

  const getByOrchestrationThreadId: OrchestrationRunRepositoryShape["getByOrchestrationThreadId"] =
    (input) =>
      getRunByOrchestrationThreadId(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("OrchestrationRunRepository.getByOrchestrationThreadId:query"),
        ),
      );

  const deleteById: OrchestrationRunRepositoryShape["deleteById"] = (input) =>
    deleteRun(input).pipe(
      Effect.mapError(toPersistenceSqlError("OrchestrationRunRepository.deleteById:query")),
    );

  return {
    create,
    update,
    getById,
    getByOrchestrationThreadId,
    listByProject,
    deleteById,
  } satisfies OrchestrationRunRepositoryShape;
});

export const OrchestrationRunRepositoryLive = Layer.effect(
  OrchestrationRunRepository,
  makeOrchestrationRunRepository,
);
