import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.effect("044_ProjectNameHidden adds a persisted visible-by-default flag", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 43 });

    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, created_at, updated_at
      ) VALUES (
        'project-1', 'Project', '/tmp/project', '[]',
        '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'
      )
    `;

    yield* runMigrations({ toMigrationInclusive: 44 });

    const rows = yield* sql<{ readonly nameHidden: number }>`
      SELECT name_hidden AS "nameHidden"
      FROM projection_projects
      WHERE project_id = 'project-1'
    `;
    assert.deepStrictEqual(rows, [{ nameHidden: 0 }]);

    yield* sql`
      UPDATE projection_projects
      SET name_hidden = 1
      WHERE project_id = 'project-1'
    `;
    const updated = yield* sql<{ readonly nameHidden: number }>`
      SELECT name_hidden AS "nameHidden"
      FROM projection_projects
      WHERE project_id = 'project-1'
    `;
    assert.deepStrictEqual(updated, [{ nameHidden: 1 }]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
