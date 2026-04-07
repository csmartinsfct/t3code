import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Extend projection_projects with ticket numbering support
  yield* sql`ALTER TABLE projection_projects ADD COLUMN next_ticket_number INTEGER NOT NULL DEFAULT 1`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN ticket_prefix TEXT DEFAULT NULL`;

  // Tickets
  yield* sql`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      ticket_number INTEGER NOT NULL,
      identifier TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria_json TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'none',
      sort_order REAL NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id),
      FOREIGN KEY (parent_id) REFERENCES tickets(id) ON DELETE SET NULL
    )
  `;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_project_number ON tickets(project_id, ticket_number)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_tickets_project_status ON tickets(project_id, status, is_archived)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_tickets_project_sort ON tickets(project_id, sort_order)`;

  // Labels (project-scoped)
  yield* sql`
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_project_name ON labels(project_id, name)`;

  // Ticket-label associations
  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_labels (
      ticket_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      PRIMARY KEY (ticket_id, label_id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_labels_label ON ticket_labels(label_id)`;

  // Ticket dependencies
  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_dependencies (
      ticket_id TEXT NOT NULL,
      depends_on_ticket_id TEXT NOT NULL,
      PRIMARY KEY (ticket_id, depends_on_ticket_id),
      CHECK (ticket_id != depends_on_ticket_id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_deps_depends_on ON ticket_dependencies(depends_on_ticket_id)`;

  // Comments
  yield* sql`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      parent_id TEXT,
      author_type TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_model TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id, created_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)`;

  // Artifacts
  yield* sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      ticket_id TEXT,
      comment_id TEXT,
      type TEXT NOT NULL,
      title TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((ticket_id IS NOT NULL AND comment_id IS NULL) OR (ticket_id IS NULL AND comment_id IS NOT NULL)),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_artifacts_ticket ON artifacts(ticket_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_artifacts_comment ON artifacts(comment_id)`;

  // Ticket history
  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id, performed_at DESC)`;
});
