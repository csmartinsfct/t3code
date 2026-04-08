import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Migration 028 - Add worktree column to tickets table.
 *
 * Stores an optional git worktree/branch name so ticket work can be isolated.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE tickets ADD COLUMN worktree TEXT DEFAULT NULL`.pipe(Effect.ignore);
});
