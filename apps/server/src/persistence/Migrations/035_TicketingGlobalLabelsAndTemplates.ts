import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Migration 035 - Global labels and description templates.
 *
 * 1. Recreates the labels table to make project_id nullable (SQLite does not
 *    support ALTER COLUMN, so we use the table-recreation pattern). This
 *    enables global labels (project_id IS NULL).
 *
 * 2. Creates the ticket_templates table with optional project_id for
 *    global vs project-scoped templates.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ── Recreate labels table with nullable project_id ──────────────────
  // SQLite cannot ALTER COLUMN to remove NOT NULL, so we recreate.

  yield* sql`
    CREATE TABLE IF NOT EXISTS labels_new (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;

  yield* sql`
    INSERT OR IGNORE INTO labels_new (id, project_id, name, color, created_at, updated_at)
    SELECT id, project_id, name, color, created_at, updated_at FROM labels
  `;

  yield* sql`DROP TABLE labels`;
  yield* sql`ALTER TABLE labels_new RENAME TO labels`;

  // Recreate indexes on the new table
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_project_name ON labels(project_id, name)`.pipe(
    Effect.ignore,
  );
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_global_name ON labels(name) WHERE project_id IS NULL`;

  // Recreate ticket_labels foreign key index (CASCADE still works via label id)
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_labels_label ON ticket_labels(label_id)`;

  // ── Description templates table ─────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT NULL,
      name TEXT NOT NULL,
      description TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;

  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_project_name ON ticket_templates(project_id, name)`.pipe(
    Effect.ignore,
  );

  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_global_name ON ticket_templates(name) WHERE project_id IS NULL`;
});
