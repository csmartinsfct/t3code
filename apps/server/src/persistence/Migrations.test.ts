import { readdirSync } from "node:fs";

import { assert, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(NodeSqliteClient.layerMemory());

it("registers every migration file exactly once", () => {
  const migrationsDir = new URL("./Migrations/", import.meta.url);
  const migrationFileIds = readdirSync(migrationsDir)
    .filter((name) => /^\d{3}_.+\.ts$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => Number.parseInt(name.slice(0, 3), 10))
    .toSorted((left, right) => left - right);

  assert.deepStrictEqual(
    migrationEntries.map(([id]) => id),
    migrationFileIds,
  );
});

layer("Migrations", (it) => {
  it.effect("fails fast when the recorded migration history has gaps", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 30 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (32, ${"ProjectPromptOverrides"})
      `;

      const exit = yield* Effect.exit(runMigrations());
      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const renderedCause = Cause.pretty(exit.cause);
        assert.equal(renderedCause.includes("missing applied migration(s) 31"), true);
      }
    }),
  );
});
