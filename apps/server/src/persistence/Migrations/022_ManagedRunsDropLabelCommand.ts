import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Drop and recreate tables — label and command removed, scriptId now NOT NULL
  yield* sql`DROP TABLE IF EXISTS managed_run_evidence`;
  yield* sql`DROP TABLE IF EXISTS managed_runs`;

  yield* sql`
    CREATE TABLE managed_runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      created_by_thread_id TEXT,
      last_touched_by_thread_id TEXT,
      terminal_thread_id TEXT,
      terminal_id TEXT,
      cwd TEXT NOT NULL,
      launch_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      detected_url TEXT,
      detected_port INTEGER,
      terminal_pid INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      last_exit_code INTEGER,
      last_exit_signal INTEGER,
      logs_expire_at TEXT,
      services_json TEXT NOT NULL DEFAULT '[]'
    )
  `;

  yield* sql`
    CREATE TABLE managed_run_evidence (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      value_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_runs_project_status_updated
    ON managed_runs(project_id, status, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_run_evidence_run_type
    ON managed_run_evidence(run_id, type)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_run_evidence_identity
    ON managed_run_evidence(run_id, type, source, value_json)
  `;
});
