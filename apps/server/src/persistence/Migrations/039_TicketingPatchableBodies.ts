import { createHash, randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const EMPTY_BODY_HASH = createHash("sha256").update("").digest("hex");
const HISTORY_EXCERPT_CAP = 16 * 1024;

type TicketRow = {
  readonly id: string;
  readonly description: string | null;
  readonly acceptanceCriteriaJson: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type LegacyCriterion = {
  readonly text?: unknown;
  readonly status?: unknown;
  readonly reason?: unknown;
  readonly verifiedBy?: unknown;
  readonly verifiedAt?: unknown;
};

const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");
const sizeBytes = (input: string) => Buffer.byteLength(input, "utf8");
const parseCriteriaJson = (json: string): unknown =>
  Effect.runSync(
    Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: () => null,
    }),
  );

const hasColumn = (sql: SqlClient.SqlClient, table: string, column: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(${sql.literal(table)})
    `;
    return rows.some((row) => row.name === column);
  });

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* hasColumn(sql, "tickets", "criteria_revision"))) {
    yield* sql`ALTER TABLE tickets ADD COLUMN criteria_revision INTEGER NOT NULL DEFAULT 1`;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_bodies (
      ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT 'markdown',
      body TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_bodies_revision ON ticket_bodies(revision)`;

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_body_changes (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      base_revision INTEGER NOT NULL,
      new_revision INTEGER NOT NULL,
      operation TEXT NOT NULL,
      patch_excerpt TEXT,
      summary TEXT,
      before_hash TEXT NOT NULL,
      after_hash TEXT NOT NULL,
      changed_lines INTEGER NOT NULL DEFAULT 0,
      changed_chars INTEGER NOT NULL DEFAULT 0,
      performed_by TEXT NOT NULL,
      performed_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_body_changes_ticket_revision ON ticket_body_changes(ticket_id, new_revision DESC)`;

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_acceptance_criteria (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      verified_by TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ticket_acceptance_criteria_ticket_position ON ticket_acceptance_criteria(ticket_id, position)`;

  const tickets = yield* sql<TicketRow>`
    SELECT
      id,
      description,
      acceptance_criteria_json AS "acceptanceCriteriaJson",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM tickets
  `;

  for (const ticket of tickets) {
    const body = ticket.description ?? "";
    yield* sql`
      INSERT OR IGNORE INTO ticket_bodies (
        ticket_id, format, body, revision, content_hash, size_bytes, created_at, updated_at
      )
      VALUES (
        ${ticket.id}, 'markdown', ${body}, 1, ${body === "" ? EMPTY_BODY_HASH : sha256(body)},
        ${sizeBytes(body)}, ${ticket.createdAt}, ${ticket.updatedAt}
      )
    `;

    const existingCriteria = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM ticket_acceptance_criteria WHERE ticket_id = ${ticket.id}
    `;
    if ((existingCriteria[0]?.count ?? 0) > 0 || !ticket.acceptanceCriteriaJson) {
      continue;
    }

    const parsed = parseCriteriaJson(ticket.acceptanceCriteriaJson);
    if (!Array.isArray(parsed)) continue;

    let position = 100;
    for (const raw of parsed as LegacyCriterion[]) {
      if (!raw || typeof raw !== "object" || typeof raw.text !== "string") continue;
      const status =
        raw.status === "met" || raw.status === "not_met" || raw.status === "pending"
          ? raw.status
          : "pending";
      yield* sql`
        INSERT INTO ticket_acceptance_criteria (
          id, ticket_id, position, text, status, reason, verified_by, verified_at, created_at, updated_at
        )
        VALUES (
          ${randomUUID()}, ${ticket.id}, ${position}, ${raw.text}, ${status},
          ${typeof raw.reason === "string" ? raw.reason : null},
          ${typeof raw.verifiedBy === "string" ? raw.verifiedBy : null},
          ${typeof raw.verifiedAt === "string" ? raw.verifiedAt : null},
          ${ticket.createdAt}, ${ticket.updatedAt}
        )
      `;
      position += 100;
    }
  }

  yield* sql`
    DELETE FROM ticket_history
    WHERE length(COALESCE(changes_json, '')) > ${HISTORY_EXCERPT_CAP}
      AND (
        changes_json LIKE '%"description"%'
        OR changes_json LIKE '%"acceptanceCriteria"%'
      )
  `;
});
