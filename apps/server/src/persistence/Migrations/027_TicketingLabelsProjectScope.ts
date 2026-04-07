import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Migration 027 - Backfill project_id on labels table.
 *
 * Migration 025 was updated after it had already run on some databases,
 * so the labels table may be missing the `project_id` column and the
 * project-scoped unique index.  This migration reconciles the schema.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Add project_id column if missing. Wrapped in a catch so databases where
  // migration 025 already created the column with project_id don't fail.
  yield* sql`ALTER TABLE labels ADD COLUMN project_id TEXT DEFAULT NULL`.pipe(
    Effect.catch(() => Effect.void),
  );

  // Backfill project_id from the first project if any labels already exist.
  yield* sql`
    UPDATE labels
    SET project_id = (SELECT project_id FROM projection_projects LIMIT 1)
    WHERE project_id IS NULL
  `;

  // Create the project-scoped unique index (idempotent).
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_project_name ON labels(project_id, name)`.pipe(
    Effect.catch(() => Effect.void),
  );

  // Ensure ticket_labels label index exists.
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_labels_label ON ticket_labels(label_id)`;
});
