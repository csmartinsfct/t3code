import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The startup/refresh snapshot queries the pending approval + user-input
 * request activities via `WHERE kind IN (...)`. Without an index on `kind`
 * SQLite full-scans the entire projection_thread_activities table (which
 * grows unbounded — ~1M rows in mature databases) to find the handful of
 * matching rows, making getStartupSnapshot take >10s and stalling the UI on
 * launch. This index makes that lookup selective.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_kind
    ON projection_thread_activities(kind)
  `;
});
