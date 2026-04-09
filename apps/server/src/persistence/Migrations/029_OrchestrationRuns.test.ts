import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration029 from "./029_OrchestrationRuns.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const assertOrchestrationSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  assert.ok(threadColumns.some((column) => column.name === "parent_thread_id"));
  assert.ok(threadColumns.some((column) => column.name === "is_orchestration_thread"));
  assert.ok(threadColumns.some((column) => column.name === "ticket_id"));

  const threadIndexes = yield* sql<{ readonly name: string }>`
    PRAGMA index_list(projection_threads)
  `;
  assert.ok(
    threadIndexes.some((index) => index.name === "idx_projection_threads_parent_thread_id"),
  );
  assert.ok(threadIndexes.some((index) => index.name === "idx_projection_threads_ticket_id"));

  const runColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(orchestration_runs)
  `;
  assert.deepStrictEqual(
    runColumns.map((column) => column.name),
    [
      "id",
      "orchestration_thread_id",
      "project_id",
      "status",
      "ticket_order_json",
      "current_ticket_index",
      "current_phase",
      "review_iteration",
      "max_review_iterations",
      "created_at",
      "updated_at",
    ],
  );

  const runIndexes = yield* sql<{ readonly name: string }>`
    PRAGMA index_list(orchestration_runs)
  `;
  assert.ok(runIndexes.some((index) => index.name === "idx_orchestration_runs_project_id"));
  assert.ok(
    runIndexes.some((index) => index.name === "idx_orchestration_runs_orchestration_thread_id"),
  );
});

layer("029_OrchestrationRuns", (it) => {
  it.effect("applies cleanly on a fresh database", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 29 });
      yield* assertOrchestrationSchema;
    }),
  );

  it.effect("applies cleanly on an existing database and can be rerun safely", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 28 });
      yield* runMigrations({ toMigrationInclusive: 29 });
      yield* Migration029;
      yield* assertOrchestrationSchema;
    }),
  );
});
