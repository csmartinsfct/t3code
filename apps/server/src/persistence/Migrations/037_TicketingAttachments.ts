import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticketing_attachments (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      alt TEXT,
      created_at TEXT NOT NULL,
      CHECK (owner_kind IN ('ticket', 'comment'))
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticketing_attachments_owner ON ticketing_attachments(owner_kind, owner_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticketing_attachments_relative_path ON ticketing_attachments(relative_path)`;
});
