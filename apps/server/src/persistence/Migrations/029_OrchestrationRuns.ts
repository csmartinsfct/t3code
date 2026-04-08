import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const ensureProjectionThreadsColumn = (
    column: "parent_thread_id" | "is_orchestration_thread" | "ticket_id",
    definition: string,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('projection_threads')
        WHERE name = ${column}
      `;
      if (rows.length === 0) {
        yield* sql.unsafe(`ALTER TABLE projection_threads ADD COLUMN ${definition}`);
      }
    });

  // Add thread hierarchy columns to projection_threads
  yield* ensureProjectionThreadsColumn("parent_thread_id", "parent_thread_id TEXT");
  yield* ensureProjectionThreadsColumn(
    "is_orchestration_thread",
    "is_orchestration_thread INTEGER NOT NULL DEFAULT 0",
  );
  yield* ensureProjectionThreadsColumn("ticket_id", "ticket_id TEXT");

  // Create orchestration_runs table
  yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_runs (
      id TEXT PRIMARY KEY,
      orchestration_thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ticket_order_json TEXT NOT NULL DEFAULT '[]',
      current_ticket_index INTEGER NOT NULL DEFAULT -1,
      current_phase TEXT NOT NULL DEFAULT 'working',
      review_iteration INTEGER NOT NULL DEFAULT 0,
      max_review_iterations INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // Indexes for thread hierarchy queries
  yield* sql`CREATE INDEX IF NOT EXISTS idx_projection_threads_parent_thread_id ON projection_threads(parent_thread_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_projection_threads_ticket_id ON projection_threads(ticket_id)`;

  // Indexes for orchestration run queries
  yield* sql`CREATE INDEX IF NOT EXISTS idx_orchestration_runs_project_id ON orchestration_runs(project_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_orchestration_runs_orchestration_thread_id ON orchestration_runs(orchestration_thread_id)`;
});
