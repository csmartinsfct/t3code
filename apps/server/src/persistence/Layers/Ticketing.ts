import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  AllocateTicketNumberInput,
  AcceptanceCriterionRow,
  ArtifactLookupInput,
  ArtifactRow,
  ArtifactsByCommentInput,
  ArtifactsByTicketInput,
  CommentLookupInput,
  CommentRow,
  CommentsByTicketInput,
  CountByParentInput,
  CriteriaByTicketInput,
  DependencyAssocInput,
  DependencyLookupInput,
  HistoryByTicketInput,
  LabelLookupInput,
  LabelRow,
  LabelsByLabelIdInput,
  LabelsByProjectInput,
  LabelsByTicketInput,
  PersistedArtifact,
  PersistedAcceptanceCriterion,
  PersistedTicketBody,
  PersistedTicketBodyChange,
  PersistedComment,
  PersistedLabel,
  PersistedTemplate,
  PersistedTicket,
  PersistedTicketHistoryEntry,
  PersistedTicketingAttachment,
  SetDependenciesRepoInput,
  TemplateLookupInput,
  TemplateRow,
  TemplatesByProjectInput,
  TicketHistoryRow,
  TicketBodyLookupInput,
  TicketBodyRow,
  TicketIdentifierLookupInput,
  TicketingAttachmentLookupInput,
  TicketingAttachmentRow,
  TicketingAttachmentsByOwnerInput,
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
  worktree,
  acceptance_criteria_json AS "acceptanceCriteria",
  criteria_revision AS "criteriaRevision",
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

const TICKETING_ATTACHMENT_SELECT = `
  id,
  owner_kind AS "ownerKind",
  owner_id AS "ownerId",
  relative_path AS "relativePath",
  name,
  mime_type AS "mimeType",
  size_bytes AS "sizeBytes",
  width,
  height,
  alt,
  created_at AS "createdAt"
`;

const HISTORY_SELECT = `
  id,
  ticket_id AS "ticketId",
  action,
  changes_json AS "changes",
  performed_by AS "performedBy",
  performed_at AS "performedAt"
`;

const BODY_SELECT = `
  ticket_id AS "ticketId",
  format,
  body,
  revision,
  content_hash AS "contentHash",
  size_bytes AS "sizeBytes",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const CRITERION_SELECT = `
  id,
  ticket_id AS "ticketId",
  position,
  text,
  status,
  reason,
  verified_by AS "verifiedBy",
  verified_at AS "verifiedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const DEP_SELECT = `
  d.ticket_id AS "ticketId",
  d.depends_on_ticket_id AS "dependsOnTicketId",
  t.identifier AS "identifier",
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
          title, description, worktree,
          acceptance_criteria_json,
          status, priority, sort_order, is_archived, criteria_revision,
          created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.projectId}, ${row.parentId}, ${row.ticketNumber}, ${row.identifier},
          ${row.title}, ${row.description}, ${row.worktree},
          ${row.acceptanceCriteria ? JSON.stringify(row.acceptanceCriteria) : null},
          ${row.status}, ${row.priority}, ${row.sortOrder}, ${row.isArchived ? 1 : 0}, ${row.criteriaRevision ?? 1},
          ${row.createdAt}, ${row.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          parent_id = excluded.parent_id,
          title = excluded.title,
          description = excluded.description,
          worktree = excluded.worktree,
          acceptance_criteria_json = excluded.acceptance_criteria_json,
          status = excluded.status,
          priority = excluded.priority,
          sort_order = excluded.sort_order,
          is_archived = excluded.is_archived,
          criteria_revision = excluded.criteria_revision,
          updated_at = excluded.updated_at
      `,
  });

  const getTicketById = SqlSchema.findOneOption({
    Request: TicketLookupInput,
    Result: TicketRow,
    execute: ({ id }) => sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE id = ${id}`,
  });

  const listTicketsByProject = SqlSchema.findAll({
    Request: TicketsByProjectInput,
    Result: TicketRow,
    execute: ({ projectId }) =>
      sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE project_id = ${projectId} AND is_archived = 0 ORDER BY sort_order ASC, created_at ASC`,
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
    identifier: Schema.String,
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

  const listLabelsByProject = (input: typeof LabelsByProjectInput.Type) =>
    Effect.gen(function* () {
      const rows = input.projectId
        ? yield* sql`SELECT ${sql.literal(LABEL_SELECT)} FROM labels WHERE project_id = ${input.projectId} OR project_id IS NULL ORDER BY name ASC`
        : yield* sql`SELECT ${sql.literal(LABEL_SELECT)} FROM labels WHERE project_id IS NULL ORDER BY name ASC`;
      return rows as unknown as ReadonlyArray<typeof LabelRow.Type>;
    });

  const listGlobalLabels_ = () =>
    Effect.gen(function* () {
      const rows =
        yield* sql`SELECT ${sql.literal(LABEL_SELECT)} FROM labels WHERE project_id IS NULL ORDER BY name ASC`;
      return rows as unknown as ReadonlyArray<typeof LabelRow.Type>;
    });

  const TicketIdRow = Schema.Struct({ ticketId: Schema.String });

  const listTicketIdsByLabelId_ = SqlSchema.findAll({
    Request: LabelsByLabelIdInput,
    Result: TicketIdRow,
    execute: ({ labelId }) =>
      sql`SELECT ticket_id AS "ticketId" FROM ticket_labels WHERE label_id = ${labelId}`,
  });

  // ---- Templates ----

  const TEMPLATE_SELECT = `
    id,
    project_id AS "projectId",
    name,
    description,
    body,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const writeTemplate = SqlSchema.void({
    Request: PersistedTemplate,
    execute: (row) =>
      sql`
        INSERT INTO ticket_templates (id, project_id, name, description, body, created_at, updated_at)
        VALUES (${row.id}, ${row.projectId}, ${row.name}, ${row.description}, ${row.body}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          body = excluded.body,
          updated_at = excluded.updated_at
      `,
  });

  const getTemplate_ = SqlSchema.findOneOption({
    Request: TemplateLookupInput,
    Result: TemplateRow,
    execute: ({ id }) =>
      sql`SELECT ${sql.literal(TEMPLATE_SELECT)} FROM ticket_templates WHERE id = ${id}`,
  });

  const listTemplatesByScope = (input: typeof TemplatesByProjectInput.Type) =>
    Effect.gen(function* () {
      const rows = input.projectId
        ? yield* sql`SELECT ${sql.literal(TEMPLATE_SELECT)} FROM ticket_templates WHERE project_id = ${input.projectId} OR project_id IS NULL ORDER BY name ASC`
        : yield* sql`SELECT ${sql.literal(TEMPLATE_SELECT)} FROM ticket_templates WHERE project_id IS NULL ORDER BY name ASC`;
      return rows as unknown as ReadonlyArray<typeof TemplateRow.Type>;
    });

  const listGlobalTemplates_ = () =>
    Effect.gen(function* () {
      const rows =
        yield* sql`SELECT ${sql.literal(TEMPLATE_SELECT)} FROM ticket_templates WHERE project_id IS NULL ORDER BY name ASC`;
      return rows as unknown as ReadonlyArray<typeof TemplateRow.Type>;
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

  // ---- Ticketing attachments (file-backed, polymorphic owner) ----

  const writeTicketingAttachment = SqlSchema.void({
    Request: PersistedTicketingAttachment,
    execute: (row) =>
      sql`
        INSERT INTO ticketing_attachments (
          id, owner_kind, owner_id, relative_path, name, mime_type, size_bytes, width, height, alt, created_at
        ) VALUES (
          ${row.id}, ${row.ownerKind}, ${row.ownerId}, ${row.relativePath}, ${row.name}, ${row.mimeType}, ${row.sizeBytes}, ${row.width}, ${row.height}, ${row.alt}, ${row.createdAt}
        )
      `,
  });

  const getTicketingAttachment_ = SqlSchema.findOneOption({
    Request: TicketingAttachmentLookupInput,
    Result: TicketingAttachmentRow,
    execute: ({ id }) =>
      sql`SELECT ${sql.literal(TICKETING_ATTACHMENT_SELECT)} FROM ticketing_attachments WHERE id = ${id}`,
  });

  const listTicketingAttachmentsByOwner_ = SqlSchema.findAll({
    Request: TicketingAttachmentsByOwnerInput,
    Result: TicketingAttachmentRow,
    execute: ({ ownerKind, ownerId }) =>
      sql`SELECT ${sql.literal(TICKETING_ATTACHMENT_SELECT)} FROM ticketing_attachments WHERE owner_kind = ${ownerKind} AND owner_id = ${ownerId} ORDER BY created_at ASC`,
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

  // ---- Ticket bodies ----

  const getBody_ = SqlSchema.findOneOption({
    Request: TicketBodyLookupInput,
    Result: TicketBodyRow,
    execute: ({ ticketId }) =>
      sql`SELECT ${sql.literal(BODY_SELECT)} FROM ticket_bodies WHERE ticket_id = ${ticketId}`,
  });

  const writeBody = SqlSchema.void({
    Request: PersistedTicketBody,
    execute: (row) =>
      sql`
        INSERT INTO ticket_bodies (
          ticket_id, format, body, revision, content_hash, size_bytes, created_at, updated_at
        )
        VALUES (
          ${row.ticketId}, ${row.format}, ${row.body}, ${row.revision}, ${row.contentHash},
          ${row.sizeBytes}, ${row.createdAt}, ${row.updatedAt}
        )
        ON CONFLICT (ticket_id) DO UPDATE SET
          format = excluded.format,
          body = excluded.body,
          revision = excluded.revision,
          content_hash = excluded.content_hash,
          size_bytes = excluded.size_bytes,
          updated_at = excluded.updated_at
      `,
  });

  const writeBodyChange = SqlSchema.void({
    Request: PersistedTicketBodyChange,
    execute: (row) =>
      sql`
        INSERT INTO ticket_body_changes (
          id, ticket_id, base_revision, new_revision, operation, patch_excerpt, summary,
          before_hash, after_hash, changed_lines, changed_chars, performed_by, performed_at
        )
        VALUES (
          ${row.id}, ${row.ticketId}, ${row.baseRevision}, ${row.newRevision}, ${row.operation},
          ${row.patchExcerpt}, ${row.summary}, ${row.beforeHash}, ${row.afterHash},
          ${row.changedLines}, ${row.changedChars}, ${row.performedBy}, ${row.performedAt}
        )
      `,
  });

  // ---- Acceptance criteria ----

  const listCriteria_ = SqlSchema.findAll({
    Request: CriteriaByTicketInput,
    Result: AcceptanceCriterionRow,
    execute: ({ ticketId }) =>
      sql`SELECT ${sql.literal(CRITERION_SELECT)} FROM ticket_acceptance_criteria WHERE ticket_id = ${ticketId} ORDER BY position ASC, created_at ASC`,
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
      Effect.gen(function* () {
        if (!input.identifier) return Option.none();
        const rows =
          input.projectId === undefined
            ? yield* sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE identifier = ${input.identifier}`
            : yield* sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets WHERE identifier = ${input.identifier} AND project_id = ${input.projectId}`;
        const typedRows = rows as ReadonlyArray<typeof TicketRow.Type>;
        const row = typedRows[0];
        return row ? Option.some(toPersistedTicket(row)) : Option.none();
      }).pipe(Effect.mapError(toPersistenceSqlError("TicketingRepository.getByIdentifier:query"))),
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
        const paginationClause =
          input.limit !== undefined || input.offset !== undefined
            ? ` LIMIT ${input.limit ?? -1} OFFSET ${input.offset ?? 0}`
            : "";

        const rawRows =
          yield* sql`SELECT ${sql.literal(TICKET_SELECT)} FROM tickets ${sql.literal(joinClause)} WHERE ${sql.literal(where)} ORDER BY sort_order ASC, created_at ASC${sql.literal(paginationClause)}`;
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
    unarchiveTicket: ({ id }) =>
      sql`UPDATE tickets SET is_archived = 0, updated_at = ${new Date().toISOString()} WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.unarchiveTicket:query")),
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

    getBody: (input) =>
      getBody_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getBody:query")),
      ),
    upsertBody: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* writeBody(input);
            yield* sql`UPDATE tickets SET description = ${input.body}, updated_at = ${input.updatedAt} WHERE id = ${input.ticketId}`;
          }),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError(toPersistenceSqlError("TicketingRepository.upsertBody:query")),
        ),
    recordBodyChange: (input) =>
      writeBodyChange(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.recordBodyChange:query")),
      ),
    listCriteria: (input) =>
      listCriteria_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listCriteria:query")),
      ),
    replaceCriteria: ({ ticketId, criteria, criteriaRevision, updatedAt }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM ticket_acceptance_criteria WHERE ticket_id = ${ticketId}`;
            for (const criterion of criteria) {
              yield* sql`
                INSERT INTO ticket_acceptance_criteria (
                  id, ticket_id, position, text, status, reason, verified_by, verified_at, created_at, updated_at
                )
                VALUES (
                  ${criterion.id}, ${criterion.ticketId}, ${criterion.position}, ${criterion.text},
                  ${criterion.status}, ${criterion.reason}, ${criterion.verifiedBy}, ${criterion.verifiedAt},
                  ${criterion.createdAt}, ${criterion.updatedAt}
                )
              `;
            }
            yield* sql`
              UPDATE tickets
              SET acceptance_criteria_json = ${JSON.stringify(
                criteria.map((criterion) => ({
                  id: criterion.id,
                  position: criterion.position,
                  text: criterion.text,
                  status: criterion.status,
                  reason: criterion.reason,
                  verifiedBy: criterion.verifiedBy,
                  verifiedAt: criterion.verifiedAt,
                  createdAt: criterion.createdAt,
                  updatedAt: criterion.updatedAt,
                })),
              )},
              criteria_revision = ${criteriaRevision},
              updated_at = ${updatedAt}
              WHERE id = ${ticketId}
            `;
          }),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError(toPersistenceSqlError("TicketingRepository.replaceCriteria:query")),
        ),
    updateCriteriaRevision: ({ ticketId, criteriaRevision, updatedAt }) =>
      sql`
        UPDATE tickets
        SET criteria_revision = ${criteriaRevision}, updated_at = ${updatedAt}
        WHERE id = ${ticketId}
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.updateCriteriaRevision:query")),
      ),

    // Batch queries
    batchListLabelsForTickets: ({ ticketIds }) =>
      Effect.gen(function* () {
        if (ticketIds.length === 0)
          return new Map<string, ReadonlyArray<typeof LabelRow.Type>>() as ReadonlyMap<
            string,
            ReadonlyArray<typeof LabelRow.Type>
          >;
        const placeholders = ticketIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
        const rawRows = yield* sql`
          SELECT
            tl.ticket_id AS "ticketId",
            l.id,
            l.project_id AS "projectId",
            l.name,
            l.color,
            l.created_at AS "createdAt",
            l.updated_at AS "updatedAt"
          FROM labels l
          INNER JOIN ticket_labels tl ON tl.label_id = l.id
          WHERE tl.ticket_id IN (${sql.literal(placeholders)})
          ORDER BY l.name ASC
        `;
        const typed = rawRows as unknown as ReadonlyArray<
          typeof LabelRow.Type & { ticketId: string }
        >;
        const map = new Map<string, Array<typeof LabelRow.Type>>();
        for (const id of ticketIds) map.set(id, []);
        for (const row of typed) {
          const { ticketId, ...label } = row;
          map.get(ticketId)?.push(label);
        }
        return map as ReadonlyMap<string, ReadonlyArray<typeof LabelRow.Type>>;
      }).pipe(
        Effect.mapError(
          toPersistenceSqlError("TicketingRepository.batchListLabelsForTickets:query"),
        ),
      ),
    batchCountByParents: ({ parentIds }) =>
      Effect.gen(function* () {
        if (parentIds.length === 0) return new Map<string, number>() as ReadonlyMap<string, number>;
        const placeholders = parentIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
        const rawRows = yield* sql`
          SELECT parent_id AS "parentId", COUNT(*) AS cnt
          FROM tickets
          WHERE parent_id IN (${sql.literal(placeholders)})
          GROUP BY parent_id
        `;
        const typed = rawRows as unknown as ReadonlyArray<{ parentId: string; cnt: number }>;
        const map = new Map<string, number>();
        for (const id of parentIds) map.set(id, 0);
        for (const row of typed) map.set(row.parentId, row.cnt);
        return map as ReadonlyMap<string, number>;
      }).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.batchCountByParents:query")),
      ),
    batchListDependencies: ({ ticketIds }) =>
      Effect.gen(function* () {
        if (ticketIds.length === 0)
          return new Map<
            string,
            ReadonlyArray<{ ticketId: string; dependsOnTicketId: string }>
          >() as ReadonlyMap<
            string,
            ReadonlyArray<{ ticketId: string; dependsOnTicketId: string }>
          >;
        const placeholders = ticketIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
        const rawRows = yield* sql`
          SELECT ${sql.literal(DEP_SELECT)}
          FROM ticket_dependencies d
          JOIN tickets t ON t.id = d.depends_on_ticket_id
          WHERE d.ticket_id IN (${sql.literal(placeholders)})
        `;
        const typed = rawRows as unknown as ReadonlyArray<typeof DepRow.Type>;
        const map = new Map<string, Array<typeof DepRow.Type>>();
        for (const id of ticketIds) map.set(id, []);
        for (const row of typed) map.get(row.ticketId)?.push(row);
        return map as ReadonlyMap<
          string,
          ReadonlyArray<{ ticketId: string; dependsOnTicketId: string }>
        >;
      }).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.batchListDependencies:query")),
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
    listGlobalLabels: () =>
      listGlobalLabels_().pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listGlobalLabels:query")),
      ),
    listTicketIdsByLabelId: (input) =>
      listTicketIdsByLabelId_(input).pipe(
        Effect.map((rows) => rows.map((r) => r.ticketId as import("@t3tools/contracts").TicketId)),
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listTicketIdsByLabelId:query")),
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

    // Templates
    createTemplate: (input) =>
      writeTemplate(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.createTemplate:query")),
      ),
    updateTemplate: (input) =>
      writeTemplate(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.updateTemplate:query")),
      ),
    getTemplate: (input) =>
      getTemplate_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getTemplate:query")),
      ),
    listTemplates: (input) =>
      listTemplatesByScope(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listTemplates:query")),
      ),
    listGlobalTemplates: () =>
      listGlobalTemplates_().pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.listGlobalTemplates:query")),
      ),
    deleteTemplate: ({ id }) =>
      sql`DELETE FROM ticket_templates WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.deleteTemplate:query")),
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
    // Ticketing attachments (file-backed)
    createTicketingAttachment: (input) =>
      writeTicketingAttachment(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("TicketingRepository.createTicketingAttachment:query"),
        ),
      ),
    getTicketingAttachment: (input) =>
      getTicketingAttachment_(input).pipe(
        Effect.mapError(toPersistenceSqlError("TicketingRepository.getTicketingAttachment:query")),
      ),
    listTicketingAttachmentsByOwner: (input) =>
      listTicketingAttachmentsByOwner_(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("TicketingRepository.listTicketingAttachmentsByOwner:query"),
        ),
      ),
    deleteTicketingAttachment: ({ id }) =>
      sql`DELETE FROM ticketing_attachments WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("TicketingRepository.deleteTicketingAttachment:query"),
        ),
      ),
    deleteTicketingAttachmentsByOwner: ({ ownerKind, ownerId }) =>
      Effect.gen(function* () {
        const rows = yield* listTicketingAttachmentsByOwner_({ ownerKind, ownerId }).pipe(
          Effect.mapError(
            toPersistenceSqlError("TicketingRepository.deleteTicketingAttachmentsByOwner:query"),
          ),
        );
        yield* sql`DELETE FROM ticketing_attachments WHERE owner_kind = ${ownerKind} AND owner_id = ${ownerId}`.pipe(
          Effect.asVoid,
          Effect.mapError(
            toPersistenceSqlError("TicketingRepository.deleteTicketingAttachmentsByOwner:query"),
          ),
        );
        return rows;
      }),

    updateArtifactTitle: ({ id, title, updatedAt }) =>
      sql`UPDATE artifacts SET title = ${title}, updated_at = ${updatedAt} WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("TicketingRepository.updateArtifactTitle:query")),
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
