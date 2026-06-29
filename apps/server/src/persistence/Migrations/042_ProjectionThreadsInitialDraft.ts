import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

const hasColumn = (sql: SqlClient.SqlClient, table: string, column: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(${sql.literal(table)})
    `;
    return rows.some((row) => row.name === column);
  });

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* hasColumn(sql, "projection_threads", "initial_draft_json"))) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN initial_draft_json TEXT
    `;
  }
});
