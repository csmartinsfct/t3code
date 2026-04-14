import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const cols = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('orchestration_runs')
    WHERE name = 'prompt_overrides_json'
  `;

  if (cols.length === 0) {
    yield* sql.unsafe(
      `ALTER TABLE orchestration_runs ADD COLUMN prompt_overrides_json TEXT DEFAULT NULL`,
    );
  }
});
