import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Ticket identifiers are human-readable project-local references (e.g. TEST-4),
  // so uniqueness must be scoped to the project instead of the entire database.
  yield* sql`DROP INDEX IF EXISTS idx_tickets_identifier`;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_project_identifier
    ON tickets(project_id, identifier)
  `;
});
