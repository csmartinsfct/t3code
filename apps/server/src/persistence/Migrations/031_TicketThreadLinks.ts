import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_thread_links (
      ticket_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ticket_id, thread_id, link_type, source_message_id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES projection_threads(thread_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_ticket_thread_links_ticket_updated_at
    ON ticket_thread_links(ticket_id, updated_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_ticket_thread_links_thread_updated_at
    ON ticket_thread_links(thread_id, updated_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_ticket_thread_links_ticket_link_type
    ON ticket_thread_links(ticket_id, link_type)
  `;
});
