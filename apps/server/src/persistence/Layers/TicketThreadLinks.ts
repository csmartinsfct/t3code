import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Struct } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteTicketThreadLinksByMessageIdInput,
  ListTicketThreadLinksByThreadInput,
  ListTicketThreadLinksByTicketInput,
  LookupTicketIdsByIdentifiersInput,
  PersistedTicketThreadLink,
  ReplaceMentionLinksForMessageInput,
  TicketIdentifierLookupRow,
  TicketThreadLinkLookupRow,
  TicketThreadLinkRepository,
  type TicketThreadLinkLookupRow as TicketThreadLinkLookupRowType,
  type TicketThreadLinkRepositoryShape,
  UpsertStructuredTicketThreadLinkInput,
} from "../Services/TicketThreadLinks.ts";

const TicketThreadLinkLookupRowDbSchema = TicketThreadLinkLookupRow.mapFields(
  Struct.assign({
    isOrchestrationThread: Schema.Number,
  }),
);

function toLookupRow(
  row: typeof TicketThreadLinkLookupRowDbSchema.Type,
): TicketThreadLinkLookupRowType {
  return {
    ...row,
    isOrchestrationThread: row.isOrchestrationThread !== 0,
  };
}

const makeTicketThreadLinkRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertStructuredLinkRow = SqlSchema.void({
    Request: UpsertStructuredTicketThreadLinkInput,
    execute: (row) =>
      sql`
        INSERT INTO ticket_thread_links (
          ticket_id,
          thread_id,
          link_type,
          source_message_id,
          created_at,
          updated_at
        )
        VALUES (
          ${row.ticketId},
          ${row.threadId},
          ${row.linkType},
          '',
          ${row.occurredAt},
          ${row.occurredAt}
        )
        ON CONFLICT (ticket_id, thread_id, link_type, source_message_id)
        DO UPDATE SET
          updated_at = excluded.updated_at
      `,
  });

  const listLinksByTicketIdRows = SqlSchema.findAll({
    Request: ListTicketThreadLinksByTicketInput,
    Result: TicketThreadLinkLookupRowDbSchema,
    execute: ({ ticketId }) =>
      sql`
        SELECT
          links.ticket_id AS "ticketId",
          links.thread_id AS "threadId",
          links.link_type AS "linkType",
          links.source_message_id AS "sourceMessageId",
          links.created_at AS "createdAt",
          links.updated_at AS "updatedAt",
          threads.title,
          threads.created_at AS "threadCreatedAt",
          threads.updated_at AS "threadUpdatedAt",
          threads.archived_at AS "threadArchivedAt",
          threads.deleted_at AS "threadDeletedAt",
          threads.is_orchestration_thread AS "isOrchestrationThread",
          threads.parent_thread_id AS "parentThreadId"
        FROM ticket_thread_links links
        INNER JOIN projection_threads threads ON threads.thread_id = links.thread_id
        WHERE links.ticket_id = ${ticketId}
        ORDER BY links.updated_at DESC, links.created_at DESC, links.thread_id ASC
      `,
  });

  const listLinksByThreadIdRows = SqlSchema.findAll({
    Request: ListTicketThreadLinksByThreadInput,
    Result: PersistedTicketThreadLink,
    execute: ({ threadId }) =>
      sql`
        SELECT
          ticket_id AS "ticketId",
          thread_id AS "threadId",
          link_type AS "linkType",
          source_message_id AS "sourceMessageId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM ticket_thread_links
        WHERE thread_id = ${threadId}
        ORDER BY updated_at DESC, created_at DESC, ticket_id ASC
      `,
  });

  const lookupTicketIdsByIdentifiersRows = SqlSchema.findAll({
    Request: LookupTicketIdsByIdentifiersInput,
    Result: TicketIdentifierLookupRow,
    execute: ({ projectId, identifiers }) =>
      sql`
        SELECT
          id AS "ticketId",
          identifier
        FROM tickets
        WHERE project_id = ${projectId}
          AND UPPER(identifier) IN ${sql.in(identifiers.map((identifier) => identifier.toUpperCase()))}
      `,
  });

  const replaceMentionLinksForMessage: TicketThreadLinkRepositoryShape["replaceMentionLinksForMessage"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
              DELETE FROM ticket_thread_links
              WHERE thread_id = ${input.threadId}
                AND source_message_id = ${input.messageId}
                AND link_type = 'mention'
            `;

            for (const ticketId of input.ticketIds) {
              yield* sql`
                INSERT INTO ticket_thread_links (
                  ticket_id,
                  thread_id,
                  link_type,
                  source_message_id,
                  created_at,
                  updated_at
                )
                VALUES (
                  ${ticketId},
                  ${input.threadId},
                  'mention',
                  ${input.messageId},
                  ${input.occurredAt},
                  ${input.occurredAt}
                )
                ON CONFLICT (ticket_id, thread_id, link_type, source_message_id)
                DO UPDATE SET
                  updated_at = excluded.updated_at
              `;
            }
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError("TicketThreadLinkRepository.replaceMentionLinksForMessage:query"),
          ),
        );

  const deleteLinksByMessageId: TicketThreadLinkRepositoryShape["deleteLinksByMessageId"] = (
    input,
  ) => {
    if (input.messageIds.length === 0) {
      return Effect.void;
    }
    return sql`
      DELETE FROM ticket_thread_links
      WHERE thread_id = ${input.threadId}
        AND link_type = 'mention'
        AND source_message_id IN ${sql.in(input.messageIds)}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("TicketThreadLinkRepository.deleteLinksByMessageId:query"),
      ),
    );
  };

  const upsertStructuredLink: TicketThreadLinkRepositoryShape["upsertStructuredLink"] = (input) =>
    upsertStructuredLinkRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("TicketThreadLinkRepository.upsertStructuredLink:query"),
      ),
    );

  const listByTicketId: TicketThreadLinkRepositoryShape["listByTicketId"] = (input) =>
    listLinksByTicketIdRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("TicketThreadLinkRepository.listByTicketId:query")),
      Effect.map((rows) => rows.map(toLookupRow)),
    );

  const listByThreadId: TicketThreadLinkRepositoryShape["listByThreadId"] = (input) =>
    listLinksByThreadIdRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("TicketThreadLinkRepository.listByThreadId:query")),
    );

  const lookupTicketIdsByIdentifiers: TicketThreadLinkRepositoryShape["lookupTicketIdsByIdentifiers"] =
    (input) => {
      if (input.identifiers.length === 0) {
        return Effect.succeed([]);
      }
      return lookupTicketIdsByIdentifiersRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("TicketThreadLinkRepository.lookupTicketIdsByIdentifiers:query"),
        ),
      );
    };

  return {
    upsertStructuredLink,
    replaceMentionLinksForMessage,
    deleteLinksByMessageId,
    listByTicketId,
    listByThreadId,
    lookupTicketIdsByIdentifiers,
  } satisfies TicketThreadLinkRepositoryShape;
});

export const TicketThreadLinkRepositoryLive = Layer.effect(
  TicketThreadLinkRepository,
  makeTicketThreadLinkRepository,
);
