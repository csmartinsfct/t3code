import { createHash } from "node:crypto";

import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration039 from "./039_TicketingPatchableBodies.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

it.effect("039_TicketingPatchableBodies backfills bodies, criteria, and trims large history", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 38 });

    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, created_at, updated_at,
        next_ticket_number, ticket_prefix
      )
      VALUES (
        'project-1', 'Project', '/tmp/project', '[]', '2026-04-25T00:00:00.000Z',
        '2026-04-25T00:00:00.000Z', 3, 'TST'
      )
    `;
    yield* sql`
      INSERT INTO tickets (
        id, project_id, parent_id, ticket_number, identifier, title, description,
        acceptance_criteria_json, status, priority, sort_order, is_archived, created_at, updated_at
      )
      VALUES (
        'ticket-1', 'project-1', NULL, 1, 'TST-1', 'Ticket', '## Body',
        '[{"text":"Do it","status":"met","reason":"done","verifiedBy":"agent","verifiedAt":"2026-04-25T00:01:00.000Z"}]',
        'todo', 'none', 100, 0, '2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO tickets (
        id, project_id, parent_id, ticket_number, identifier, title, description,
        acceptance_criteria_json, status, priority, sort_order, is_archived, created_at, updated_at
      )
      VALUES (
        'ticket-2', 'project-1', NULL, 2, 'TST-2', 'Empty body', NULL, NULL,
        'todo', 'none', 200, 0, '2026-04-25T00:00:00.000Z', '2026-04-25T00:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO ticket_history (id, ticket_id, action, changes_json, performed_by, performed_at)
      VALUES (
        'history-1', 'ticket-1', 'updated',
        ${JSON.stringify({ description: { old: "x".repeat(20_000), new: "y".repeat(20_000) } })},
        'user', '2026-04-25T00:02:00.000Z'
      )
    `;

    yield* runMigrations({ toMigrationInclusive: 39 });
    yield* Migration039;

    const bodies = yield* sql<{
      readonly ticketId: string;
      readonly body: string;
      readonly contentHash: string;
      readonly sizeBytes: number;
      readonly revision: number;
    }>`
      SELECT ticket_id AS "ticketId", body, content_hash AS "contentHash", size_bytes AS "sizeBytes", revision
      FROM ticket_bodies
      ORDER BY ticket_id ASC
    `;
    assert.deepStrictEqual(
      bodies.map((body) => ({
        ticketId: body.ticketId,
        body: body.body,
        contentHash: body.contentHash,
        sizeBytes: body.sizeBytes,
        revision: body.revision,
      })),
      [
        {
          ticketId: "ticket-1",
          body: "## Body",
          contentHash: sha256("## Body"),
          sizeBytes: Buffer.byteLength("## Body", "utf8"),
          revision: 1,
        },
        {
          ticketId: "ticket-2",
          body: "",
          contentHash: sha256(""),
          sizeBytes: 0,
          revision: 1,
        },
      ],
    );

    const criteria = yield* sql<{
      readonly ticketId: string;
      readonly position: number;
      readonly text: string;
      readonly status: string;
      readonly reason: string | null;
      readonly verifiedBy: string | null;
      readonly verifiedAt: string | null;
    }>`
      SELECT
        ticket_id AS "ticketId", position, text, status, reason,
        verified_by AS "verifiedBy", verified_at AS "verifiedAt"
      FROM ticket_acceptance_criteria
    `;
    assert.strictEqual(criteria.length, 1);
    assert.deepStrictEqual(
      {
        ticketId: criteria[0]!.ticketId,
        position: criteria[0]!.position,
        text: criteria[0]!.text,
        status: criteria[0]!.status,
        reason: criteria[0]!.reason,
        verifiedBy: criteria[0]!.verifiedBy,
        verifiedAt: criteria[0]!.verifiedAt,
      },
      {
        ticketId: "ticket-1",
        position: 100,
        text: "Do it",
        status: "met",
        reason: "done",
        verifiedBy: "agent",
        verifiedAt: "2026-04-25T00:01:00.000Z",
      },
    );

    const history = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM ticket_history
    `;
    assert.strictEqual(history[0]?.count, 0);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
