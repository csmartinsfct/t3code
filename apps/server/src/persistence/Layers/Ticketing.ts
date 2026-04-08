import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  AllocateTicketNumberInput,
  ArtifactLookupInput,
  ArtifactRow,
  ArtifactsByCommentInput,
  ArtifactsByTicketInput,
  CommentLookupInput,
  CommentRow,
  CommentsByTicketInput,
  CountByParentInput,
  DependencyAssocInput,
  DependencyLookupInput,
  HistoryByTicketInput,
  LabelLookupInput,
  LabelRow,
  LabelsByProjectInput,
  LabelsByTicketInput,
  PersistedArtifact,
  PersistedComment,
  PersistedLabel,
  PersistedTicket,
  PersistedTicketHistoryEntry,
  SetDependenciesRepoInput,
  TicketHistoryRow,
  TicketIdentifierLookupInput,
  TicketingRepository,
  type TicketingRepositoryShape,
  TicketLabelAssocInput,
  TicketListByParentInput,
  TicketListByProjectInput,
  TicketLookupInput,
  TicketRow,
  TicketsByProjectInput,
} from "../Services/Ticketing.ts";
import type { PersistedTicket as PersistedTicketType } from "../Services/Ticketing.ts";

const toPersistedTicket = (row: typeof TicketRow.Type): PersistedTicketType => ({
  ...row,
  isArchived: row.isArchived === 1,
  acceptanceCriteria: (() => {
    if (!row.acceptanceCriteria) return null;
    const parsed = JSON.parse(row.acceptanceCriteria);
    return Array.isArray(parsed) ? parsed : null;
  })(),
});

const TICKET_SELECT = `
  id,
  project_id AS "projectId",
  parent_id AS "parentId",
  ticket_number AS "ticketNumber",
  identifier,
  title,
  description,
  acceptance_criteria_json AS "acceptanceCriteria",
  status,
  priority,
  sort_order AS "sortOrder",
  CASE WHEN is_archived = 1 THEN 1 ELSE 0 END AS "isArchived",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const LABEL_SELECT = `
  id,
  project_id AS "projectId",
  name,
  color,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const COMMENT_SELECT = `
  id,
  ticket_id AS "ticketId",
  parent_id AS "parentId",
  author_type AS "authorType",
  author_name AS "authorName",
  author_model AS "authorModel",
  body,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const ARTIFACT_SELECT = `
  id,
  ticket_id AS "ticketId",
  comment_id AS "commentId",
  type,
  title,
  payload_json AS "payload",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const HISTORY_SELECT = `
  id,
  ticket_id AS "ticketId",
  action,
  changes_json AS "changes",
  performed_by AS "performedBy",
  performed_at AS "performedAt"
`;

const DEP_SELECT = `
  d.ticket_id AS "ticketId",
  d.depends_on_ticket_id AS "dependsOnTicketId",
  t.title AS "title",
  t.status AS "status"
`;

const TransitiveDepRow = Schema.Struct({ ticketId: Schema.String });

const IdIdentifierRow = Schema.Struct({ id: Schema.String, identifier: Schema.String });

const CountRow = Schema.Struct({ cnt: Schema.Number });

const makeTicketingRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ---- Tickets ----

  const writeTicket = SqlSchema.void({
    Request: PersistedTicket,
    execute: (row) =>
      sql`
        INSERT INTO tickets (
          id, project_id, parent_id, ticket_number, identifier,
          title, description, acceptance_criteria_json,
          status, priority, sort_order, is_archived,
          created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.projectId}, ${row.parentId}, ${row.ticketNumber}, ${row.identifier},
          ${row.title}, ${row.description},
          ${row.acceptanceCriteria ? JSON.stringify(row.acceptanceCriteria) : null},
          ${row.status}, ${row.priority}, ${row.sortOrder}, ${row.isArchived ? 1 : 0},
          ${row.createdAt}, ${row.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          parent_id = excluded.parent_id,
          title = excluded.title,
          description = excluded.description,
          acceptance_criteria_json = excluded.acceptance_criteria_json,
          status = excluded.status,
          priority = excluded.priority,
          sort_order = excluded.sort_order,
          is_archived = excluded.is_archived,
          updated_at = excluded.updated_at
      `,
  });

  const getTicketById = SqlSchema.findOneOption({
    Request: TicketLookupInput,
    Result: TicketRow,
    execute: ({ id }) => sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE id = ${id}`,
  });

  const getTicketByIdentifier = SqlSchema.findOneOption({
    Request: TicketIdentifierLookupInput,
    Result: TicketRow,
    execute: ({ identifier }) =>
      sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE identifier = ${identifier}`,
  });

  const listTicketsByProject = SqlSchema.findAll({
    Request: TicketsByProjectInput,
    Result: TicketRow,
    execute: ({ projectId }) =>
      sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE project_id = ${projectId} AND is_archived = 0 ORDER BY sort_order ASC, created_at DESC`,
  });

  const listTicketsByParent = SqlSchema.findAll({
    Request: TicketListByParentInput,
    Result: TicketRow,
    execute: ({ parentId }) =>
      sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE parent_id = ${parentId} ORDER BY sort_order ASC, created_at ASC`,
  });

  const countChildren = SqlSchema.findAll({
    Request: CountByParentInput,
    Result: CountRow,
    execute: ({ parentId }) =>
      sql`SELECT COUNT(*) AS cnt FROM tickets WHERE parent_id = ${parentId}`,
  });

  // ---- Dependencies ----

  const DepRow = Schema.Struct({
    ticketId: Schema.String,
    dependsOnTicketId: Schema.String,
    title: Schema.String,
    status: Schema.String,
  });

  const listDeps = SqlSchema.findAll({
    Request: DependencyLookupInput,
    Result: DepRow,
    execute: ({ ticketId }) =>
      sql`SELECT ${sql.literal(DEP_SELECT)} FROM ticket_dependencies d JOIN tickets t ON t.id = d.depends_on_ticket_id WHERE d.ticket_id = ${ticketId}`,
  });

  const listDependents_ = SqlSchema.findAll({
    Request: DependencyLookupInput,
    Result: DepRow,
    execute: ({ ticketId }) =>
      sql`SELECT ${sql.literal(DEP_SELECT)} FROM ticket_dependencies d JOIN tickets t ON t.id = d.ticket_id WHERE d.depends_on_ticket_id = ${ticketId}`,
  });

  const transitiveDeps = SqlSchema.findAll({
    Request: DependencyLookupInput,
    Result: TransitiveDepRow,
    execute: ({ ticketId }) =>
      sql`
        WITH RECURSIVE transitive_deps(ticket_id) AS (
          SELECT depends_on_ticket_id FROM ticket_dependencies WHERE ticket_id = ${ticketId}
          UNION
          SELECT td.depends_on_ticket_id
          FROM ticket_dependencies td
          INNER JOIN transitive_deps t ON t.ticket_id = td.ticket_id
        )
        SELECT ticket_id AS "ticketId" FROM transitive_deps
      `,
  });

  // ---- Labels ----

  const writeLabel = SqlSchema.void({
    Request: PersistedLabel,
    execute: (row) =>
      sql`
        INSERT INTO labels (id, project_id, name, color, created_at, updated_at)
        VALUES (${row.id}, ${row.projectId}, ${row.name}, ${row.color}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          color = excluded.color,
          updated_at = excluded.updated_at
      `,
  });

  const getLabel_ = SqlSchema.findOneOption({
    Request: LabelLookupInput,
    Result: LabelRow,
    execute: ({ id }) => sql`SELECT ${sql.literal(LABEL_SELECT)} FROM labels WHERE id = ${id}`,
  });

  const listLabelsByProject = SqlSchema.findAll({
    Request: LabelsByProjectInput,
    Result: LabelRow,
    execute: ({ projectId }) =>
      sql`SELECT ${sql.literal(LABEL_SELECT)} FROM labels WHERE project_id = ${projectId} ORDER BY name ASC`,
  });

  // ---- Comments ----

  const writeComment = SqlSchema.void({
    Request: PersistedComment,
    execute: (row) =>
      sql`
        INSERT INTO comments (id, ticket_id, parent_id, author_type, author_name, author_model, body, created_at, updated_at)
        VALUES (${row.id}, ${row.ticketId}, ${row.parentId}, ${row.authorType}, ${row.authorName}, ${row.authorModel}, ${row.body}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          body = excluded.body,
          updated_at = excluded.updated_at
      `,
  });

  const getComment_ = SqlSchema.findOneOption({
    Request: CommentLookupInput,
    Result: CommentRow,
    execute: ({ id }) => sql`SELECT ${sql.literal(COMMENT_SELECT)} FROM comments WHERE id = ${id}`,
  });

  const listCommentsByTicket_ = SqlSchema.findAll({
    Request: CommentsByTicketInput,
    Result: CommentRow,
    execute: ({ ticketId, limit, offset }) =>
      sql`SELECT ${sql.literal(COMMENT_SELECT)} FROM comments WHERE ticket_id = ${ticketId} ORDER BY created_at ASC LIMIT ${limit ?? 100} OFFSET ${offset ?? 0}`,
  });

  // ---- Artifacts ----

  const writeArtifact = SqlSchema.void({
    Request: PersistedArtifact,
    execute: (row) =>
      sql`
        INSERT INTO artifacts (id, ticket_id, comment_id, type, title, payload_json, created_at, updated_at)
        VALUES (${row.id}, ${row.ticketId}, ${row.commentId}, ${row.type}, ${row.title}, ${JSON.stringify(row.payload)}, ${row.createdAt}, ${row.updatedAt})
      `,
  });

  const getArtifact_ = SqlSchema.findOneOption({
    Request: ArtifactLookupInput,
    Result: ArtifactRow,
    execute: ({ id }) =>
      sql`SELECT ${sql.literal(ARTIFACT_SELECT)} FROM artifacts WHERE id = ${id}`,
  });

  const listArtifactsByTicket_ = SqlSchema.findAll({
    Request: ArtifactsByTicketInput,
    Result: ArtifactRow,
    execute: ({ ticketId }) =>
      sql`SELECT ${sql.literal(ARTIFACT_SELECT)} FROM artifacts WHERE ticket_id = ${ticketId} ORDER BY created_at ASC`,
  });

  const listArtifactsByComment_ = SqlSchema.findAll({
    Request: ArtifactsByCommentInput,
    Result: ArtifactRow,
    execute: ({ commentId }) =>
      sql`SELECT ${sql.literal(ARTIFACT_SELECT)} FROM artifacts WHERE comment_id = ${commentId} ORDER BY created_at ASC`,
  });

  // ---- History ----

  const writeHistory = SqlSchema.void({
    Request: PersistedTicketHistoryEntry,
    execute: (row) =>
      sql`
        INSERT INTO ticket_history (id, ticket_id, action, changes_json, performed_by, performed_at)
        VALUES (${row.id}, ${row.ticketId}, ${row.action}, ${JSON.stringify(row.changes)}, ${row.performedBy}, ${row.performedAt})
      `,
  });

  const listHistory = SqlSchema.findAll({
    Request: HistoryByTicketInput,
    Result: TicketHistoryRow,
    execute: ({ ticketId, limit, offset }) =>
      sql`SELECT ${sql.literal(HISTORY_SELECT)} FROM ticket_history WHERE ticket_id = ${ticketId} ORDER BY performed_at DESC LIMIT ${limit ?? 50} OFFSET ${offset ?? 0}`,
  });

  // ---- Allocate ticket number (atomic) ----

  const ProjectNumberRow = Schema.Struct({
    nextTicketNumber: Schema.Number,
    ticketPrefix: Schema.NullOr(Schema.String),
    title: Schema.String,
  });

  const getProjectNumber = SqlSchema.findOneOption({
    Request: AllocateTicketNumberInput,
    Result: ProjectNumberRow,
    execute: ({ projectId }) =>
      sql`SELECT next_ticket_number AS "nextTicketNumber", ticket_prefix AS "ticketPrefix", title FROM projection_projects WHERE project_id = ${projectId}`,
  });

  // ----  Return shape ----

  return {
    createTicket: (input) =>
      writeTicket(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.createTicket:query")),
      ),
    updateTicket: (input) =>
      writeTicket(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.updateTicket:query")),
      ),
    getIdentifierMap: (ids) =>
      Effect.gen(function* () {
        if (ids.length === 0) return new Map<string, string>();
        const placeholders = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
        const rows =
          yield* sql`SELECT id, identifier FROM tickets WHERE id IN (${sql.literal(placeholders)})`;
        const typed = rows as unknown as ReadonlyArray<typeof IdIdentifierRow.Type>;
        return new Map(typed.map((r) => [r.id, r.identifier]));
      }).pipe(Effect.mapError(toPersistenceSqlError("TicketingRepository.getIdentifierMap:query"))),
    getById: (input) =>
      getTicketById(input).pipe(
        Effect.map((opt) => opt.pipe(Option.map(toPersistedTicket))),
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getById:query")),
      ),
    getByIdentifier: (input) =>
      getTicketByIdentifier(input).pipe(
        Effect.map((opt) => opt.pipe(Option.map(toPersistedTicket))),
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getByIdentifier:query")),
      ),
    listByProject: (input) =>
      Effect.gen(function* () {
        // For advanced filtering we build raw queries
        const conditions: string[] = [`project_id = '${input.projectId}'`];
        if (!input.includeArchived) conditions.push("is_archived = 0");
        if (input.status && input.status.length > 0) {
          conditions.push(`status IN (${input.status.map((s) => `'${s}'`).join(",")})`);
        }
        if (input.priority && input.priority.length > 0) {
          conditions.push(`priority IN (${input.priority.map((p) => `'${p}'`).join(",")})`);
        }
        if (input.parentId !== undefined) {
          conditions.push(
            input.parentId === null ? "parent_id IS NULL" : `parent_id = '${input.parentId}'`,
          );
        }
        if (input.search) {
          const escaped = input.search.replace(/'/g, "''");
          conditions.push(
            `(title LIKE '%${escaped}%' OR description LIKE '%${escaped}%' OR identifier LIKE '%${escaped}%')`,
          );
        }

        let joinClause = "";
        if (input.labelId) {
          joinClause = `INNER JOIN ticket_labels tl ON tl.ticket_id = tickets.id AND tl.label_id = '${input.labelId}'`;
        }

        const where = conditions.join(" AND ");
        const limit = input.limit ?? 100;
        const offset = input.offset ?? 0;

        const rawRows =
          yield* sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets ${sql.literal(joinClause)} WHERE ${sql.literal(where)} ORDER BY sort_order ASC, created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const rows = rawRows as unknown as ReadonlyArray<typeof TicketRow.Type>;
        return rows.map(toPersistedTicket);
      }).pipe(Effect.mapError(toPersistenceSqlError("TicketingRepository.listByProject:query"))),
    listByParent: (input) =>
      listTicketsByParent(input).pipe(
        Effect.map((rows) => rows.map(toPersistedTicket)),
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listByParent:query")),
      ),
    archiveTicket: ({ id }) =>
      sql`UPDATE tickets SET is_archived = 1, updated_at = ${new Date().toISOString()} WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.archiveTicket:query")),
      ),
    deleteTicket: ({ id }) =>
      sql`DELETE FROM tickets WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.deleteTicket:query")),
      ),
    allocateTicketNumber: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const row = yield* getProjectNumber(input).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(new Error(`Project not found: ${input.projectId}`)),
                  onSome: Effect.succeed,
                }),
              ),
            );
            const num = row.nextTicketNumber;
            const prefix =
              row.ticketPrefix ??
              row.title
                .replace(/[^a-zA-Z0-9]/g, "")
                .slice(0, 4)
                .toUpperCase();
            const identifier = `${prefix}-${num}`;
            yield* sql`UPDATE projection_projects SET next_ticket_number = next_ticket_number + 1 WHERE project_id = ${input.projectId}`;
            return { ticketNumber: num, identifier };
          }),
        )
        .pipe(
          Effect.mapError(toPersistenceSqlError("TicketingRepository.allocateTicketNumber:query")),
        ),
    countByParent: (input) =>
      countChildren(input).pipe(
        Effect.map((rows) => (rows.length > 0 ? rows[0]!.cnt : 0)),
        Effect.mapError(toPersistenceSqlError("TicketingRepository.countByParent:query")),
      ),

    // Dependencies
    addDependency: ({ ticketId, dependsOnTicketId }) =>
      sql`INSERT OR IGNORE INTO ticket_dependencies (ticket_id, depends_on_ticket_id) VALUES (${ticketId}, ${dependsOnTicketId})`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.addDependency:query")),
      ),
    removeDependency: ({ ticketId, dependsOnTicketId }) =>
      sql`DELETE FROM ticket_dependencies WHERE ticket_id = ${ticketId} AND depends_on_ticket_id = ${dependsOnTicketId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.removeDependency:query")),
      ),
    setDependencies: ({ ticketId, dependsOnTicketIds }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM ticket_dependencies WHERE ticket_id = ${ticketId}`;
            for (const depId of dependsOnTicketIds) {
              yield* sql`INSERT INTO ticket_dependencies (ticket_id, depends_on_ticket_id) VALUES (${ticketId}, ${depId})`;
            }
          }),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError(toPersistenceSqlError("TicketingRepository.setDependencies:query")),
        ),
    listDependencies: (input) =>
      listDeps(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listDependencies:query")),
      ),
    listDependents: (input) =>
      listDependents_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listDependents:query")),
      ),
    listAllTransitiveDependencies: (input) =>
      transitiveDeps(input).pipe(
        Effect.map((rows) => rows.map((r) => r.ticketId)),
        Effect.mapError(
          toPersistenceSqlError("TicketingRepository.listAllTransitiveDependencies:query"),
        ),
      ),

    // Labels
    createLabel: (input) =>
      writeLabel(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.createLabel:query")),
      ),
    updateLabel: (input) =>
      writeLabel(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.updateLabel:query")),
      ),
    getLabel: (input) =>
      getLabel_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getLabel:query")),
      ),
    listLabels: (input) =>
      listLabelsByProject(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listLabels:query")),
      ),
    deleteLabel: ({ id }) =>
      sql`DELETE FROM labels WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.deleteLabel:query")),
      ),
    addTicketLabel: ({ ticketId, labelId }) =>
      sql`INSERT OR IGNORE INTO ticket_labels (ticket_id, label_id) VALUES (${ticketId}, ${labelId})`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.addTicketLabel:query")),
      ),
    removeTicketLabel: ({ ticketId, labelId }) =>
      sql`DELETE FROM ticket_labels WHERE ticket_id = ${ticketId} AND label_id = ${labelId}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.removeTicketLabel:query")),
      ),
    listLabelsForTicket: (input) =>
      Effect.gen(function* () {
        const rawRows = yield* sql`
          SELECT
            l.id,
            l.project_id AS "projectId",
            l.name,
            l.color,
            l.created_at AS "createdAt",
            l.updated_at AS "updatedAt"
          FROM labels l
          INNER JOIN ticket_labels tl ON tl.label_id = l.id
          WHERE tl.ticket_id = ${input.ticketId}
          ORDER BY l.name ASC
        `;
        return rawRows as unknown as ReadonlyArray<typeof LabelRow.Type>;
      }).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listLabelsForTicket:query")),
      ),

    // Comments
    createComment: (input) =>
      writeComment(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.createComment:query")),
      ),
    updateComment: (input) =>
      writeComment(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.updateComment:query")),
      ),
    getComment: (input) =>
      getComment_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getComment:query")),
      ),
    listCommentsByTicket: (input) =>
      listCommentsByTicket_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listCommentsByTicket:query")),
      ),
    deleteComment: ({ id }) =>
      sql`DELETE FROM comments WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.deleteComment:query")),
      ),

    // Artifacts
    createArtifact: (input) =>
      writeArtifact(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.createArtifact:query")),
      ),
    getArtifact: (input) =>
      getArtifact_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getArtifact:query")),
      ),
    listArtifactsByTicket: (input) =>
      listArtifactsByTicket_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listArtifactsByTicket:query")),
      ),
    listArtifactsByComment: (input) =>
      listArtifactsByComment_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listArtifactsByComment:query")),
      ),
    deleteArtifact: ({ id }) =>
      sql`DELETE FROM artifacts WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.deleteArtifact:query")),
      ),

    // History
    recordHistory: (input) =>
      writeHistory(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.recordHistory:query")),
      ),
    listHistoryByTicket: (input) =>
      listHistory(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listHistoryByTicket:query")),
      ),
  } satisfies TicketingRepositoryShape;
});

export const TicketingRepositoryLive = Layer.effect(TicketingRepository, makeTicketingRepository);
