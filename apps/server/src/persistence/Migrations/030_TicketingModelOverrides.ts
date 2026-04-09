import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const cols = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('tickets')
    WHERE name IN ('implementer_model_json', 'reviewer_model_json')
  `;
  const existing = new Set(cols.map((c) => c.name));

  if (!existing.has("implementer_model_json")) {
    yield* sql.unsafe(`ALTER TABLE tickets ADD COLUMN implementer_model_json TEXT DEFAULT NULL`);
  }
  if (!existing.has("reviewer_model_json")) {
    yield* sql.unsafe(`ALTER TABLE tickets ADD COLUMN reviewer_model_json TEXT DEFAULT NULL`);
  }
});
