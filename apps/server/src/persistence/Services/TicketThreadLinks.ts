import { ProjectId, ThreadId, TicketId, TicketThreadLinkType } from "@t3tools/contracts";
import { IsoDateTime } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PersistedTicketThreadLink = Schema.Struct({
  ticketId: TicketId,
  threadId: ThreadId,
  linkType: TicketThreadLinkType,
  sourceMessageId: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PersistedTicketThreadLink = typeof PersistedTicketThreadLink.Type;

export const UpsertStructuredTicketThreadLinkInput = Schema.Struct({
  ticketId: TicketId,
  threadId: ThreadId,
  linkType: Schema.Literals(["origin", "bound"]),
  occurredAt: IsoDateTime,
});
export type UpsertStructuredTicketThreadLinkInput =
  typeof UpsertStructuredTicketThreadLinkInput.Type;

export const ReplaceMentionLinksForMessageInput = Schema.Struct({
  projectId: ProjectId,
  ticketIds: Schema.Array(TicketId),
  threadId: ThreadId,
  messageId: Schema.String,
  occurredAt: IsoDateTime,
});
export type ReplaceMentionLinksForMessageInput = typeof ReplaceMentionLinksForMessageInput.Type;

export const DeleteTicketThreadLinksByMessageIdInput = Schema.Struct({
  threadId: ThreadId,
  messageIds: Schema.Array(Schema.String),
});
export type DeleteTicketThreadLinksByMessageIdInput =
  typeof DeleteTicketThreadLinksByMessageIdInput.Type;

export const ListTicketThreadLinksByTicketInput = Schema.Struct({
  ticketId: TicketId,
});
export type ListTicketThreadLinksByTicketInput = typeof ListTicketThreadLinksByTicketInput.Type;

export const ListTicketThreadLinksByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListTicketThreadLinksByThreadInput = typeof ListTicketThreadLinksByThreadInput.Type;

export const LookupTicketIdsByIdentifiersInput = Schema.Struct({
  projectId: ProjectId,
  identifiers: Schema.Array(Schema.String),
});
export type LookupTicketIdsByIdentifiersInput = typeof LookupTicketIdsByIdentifiersInput.Type;

export const TicketThreadLinkLookupRow = Schema.Struct({
  ticketId: TicketId,
  threadId: ThreadId,
  linkType: TicketThreadLinkType,
  sourceMessageId: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  title: Schema.String,
  threadCreatedAt: IsoDateTime,
  threadUpdatedAt: IsoDateTime,
  threadArchivedAt: Schema.NullOr(IsoDateTime),
  threadDeletedAt: Schema.NullOr(IsoDateTime),
  isOrchestrationThread: Schema.Boolean,
  parentThreadId: Schema.NullOr(ThreadId),
});
export type TicketThreadLinkLookupRow = typeof TicketThreadLinkLookupRow.Type;

export const TicketIdentifierLookupRow = Schema.Struct({
  ticketId: TicketId,
  identifier: Schema.String,
});
export type TicketIdentifierLookupRow = typeof TicketIdentifierLookupRow.Type;

export interface TicketThreadLinkRepositoryShape {
  readonly upsertStructuredLink: (
    input: UpsertStructuredTicketThreadLinkInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly replaceMentionLinksForMessage: (
    input: ReplaceMentionLinksForMessageInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteLinksByMessageId: (
    input: DeleteTicketThreadLinksByMessageIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByTicketId: (
    input: ListTicketThreadLinksByTicketInput,
  ) => Effect.Effect<ReadonlyArray<TicketThreadLinkLookupRow>, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListTicketThreadLinksByThreadInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTicketThreadLink>, ProjectionRepositoryError>;
  readonly lookupTicketIdsByIdentifiers: (
    input: LookupTicketIdsByIdentifiersInput,
  ) => Effect.Effect<ReadonlyArray<TicketIdentifierLookupRow>, ProjectionRepositoryError>;
}

export class TicketThreadLinkRepository extends ServiceMap.Service<
  TicketThreadLinkRepository,
  TicketThreadLinkRepositoryShape
>()("t3/persistence/Services/TicketThreadLinks/TicketThreadLinkRepository") {}
