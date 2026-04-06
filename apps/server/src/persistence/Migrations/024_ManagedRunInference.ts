import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE managed_runs RENAME TO managed_runs_legacy`;

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
      declared_services_json TEXT NOT NULL DEFAULT '[]',
      runtime_services_json TEXT NOT NULL DEFAULT '[]',
      inference_status TEXT NOT NULL DEFAULT 'pending',
      inference_updated_at TEXT,
      inference_error TEXT
    )
  `;

  yield* sql`
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
    SELECT
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
      COALESCE(
        (
          SELECT json_group_array(
            json_object(
              'name',
              json_extract(value, '$.name'),
              'healthCheck',
              json_extract(value, '$.healthCheck')
            )
          )
          FROM json_each(COALESCE(managed_runs_legacy.services_json, '[]'))
        ),
        '[]'
      ),
      '[]',
      'pending',
      NULL,
      NULL
    FROM managed_runs_legacy
  `;

  yield* sql`DROP TABLE managed_runs_legacy`;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_runs_project_status_updated
    ON managed_runs(project_id, status, updated_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS managed_run_inferences (
      inference_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      declared_services_json TEXT NOT NULL,
      normalized_payload_json TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      inference_error TEXT,
      grounding_failures_json TEXT NOT NULL DEFAULT '[]',
      evidence_excerpt_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_run_inferences_run_created
    ON managed_run_inferences(run_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_run_inferences_project_created
    ON managed_run_inferences(project_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_run_inferences_script_created
    ON managed_run_inferences(script_id, created_at DESC)
  `;
});
