import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Migration 035 - Global labels and description templates.
 *
 * 1. Adds a partial unique index for global (project_id IS NULL) label names.
 *    The labels.project_id column already tolerates NULLs (added via ALTER in
 *    migration 027 which does not enforce NOT NULL).
 *
 * 2. Creates the ticket_templates table with optional project_id for
 *    global vs project-scoped templates.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Partial unique index for global label names (project_id IS NULL).
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_global_name ON labels(name) WHERE project_id IS NULL`;

  // Description templates table
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

  // Project-scoped unique index (SQLite treats NULLs as distinct, so this
  // covers project-scoped templates only).
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_project_name ON ticket_templates(project_id, name)`.pipe(
    Effect.ignore,
  );

  // Partial unique index for global template names.
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_global_name ON ticket_templates(name) WHERE project_id IS NULL`;
});
