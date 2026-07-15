import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('projection_projects')
    WHERE name = 'name_hidden'
  `;

  if (columns.length === 0) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN name_hidden INTEGER NOT NULL DEFAULT 0
      CHECK (name_hidden IN (0, 1))
    `;
  }
});
