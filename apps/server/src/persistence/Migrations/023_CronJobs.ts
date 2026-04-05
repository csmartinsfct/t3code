import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crons_jobs (
      job_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      job_type TEXT NOT NULL DEFAULT 'new_thread',
      new_thread_config_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crons_thread_runs (
      run_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      thread_id TEXT,
      error_message TEXT,
      scheduled_at TEXT NOT NULL,
      executed_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_crons_thread_runs_job
    ON crons_thread_runs(job_id, executed_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_crons_jobs_enabled_due
    ON crons_jobs(enabled, next_run_at)
  `;
});
