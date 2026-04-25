import {
  AcceptanceCriterion,
  AcceptanceCriterionStatus,
  ArtifactType,
  CommentAuthorType,
  CommentId,
  LabelId,
  ProjectId,
  TemplateId,
  TicketHistoryAction,
  TicketHistoryId,
  TicketId,
  TicketBodyOperation,
  TicketPriority,
  TicketStatus,
  ArtifactId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

// ---------------------------------------------------------------------------
// Persisted row schemas
// ---------------------------------------------------------------------------

export const PersistedTicket = Schema.Struct({
  id: TicketId,
  projectId: ProjectId,
  parentId: Schema.NullOr(TicketId),
  ticketNumber: Schema.Int,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  acceptanceCriteria: Schema.NullOr(Schema.Array(AcceptanceCriterion)),
  status: TicketStatus,
  priority: TicketPriority,
  sortOrder: Schema.Number,
  isArchived: Schema.Boolean,
  worktree: Schema.NullOr(Schema.String),
  criteriaRevision: Schema.optional(Schema.Int),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedTicket = typeof PersistedTicket.Type;

export const PersistedLabel = Schema.Struct({
  id: LabelId,
  projectId: Schema.NullOr(ProjectId),
  name: Schema.String,
  color: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedLabel = typeof PersistedLabel.Type;

export const PersistedComment = Schema.Struct({
  id: CommentId,
  ticketId: TicketId,
  parentId: Schema.NullOr(CommentId),
  authorType: CommentAuthorType,
  authorName: Schema.String,
  authorModel: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedComment = typeof PersistedComment.Type;

export const PersistedArtifact = Schema.Struct({
  id: ArtifactId,
  ticketId: Schema.NullOr(TicketId),
  commentId: Schema.NullOr(CommentId),
  type: ArtifactType,
  title: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedArtifact = typeof PersistedArtifact.Type;

// ---------------------------------------------------------------------------
// Polymorphic ticketing attachment rows (file-backed, shared by ticket &
// comment owners via (owner_kind, owner_id)). Separate from the legacy
// thread-scoped chat attachments.
// ---------------------------------------------------------------------------

export const AttachmentOwnerKindSchema = Schema.Literals(["ticket", "comment"]);
export type AttachmentOwnerKindSchema = typeof AttachmentOwnerKindSchema.Type;

export const PersistedTicketingAttachment = Schema.Struct({
  id: Schema.String,
  ownerKind: AttachmentOwnerKindSchema,
  ownerId: Schema.String,
  relativePath: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  alt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type PersistedTicketingAttachment = typeof PersistedTicketingAttachment.Type;

export const TicketingAttachmentRow = Schema.Struct({
  ...PersistedTicketingAttachment.fields,
});

export const TicketingAttachmentLookupInput = Schema.Struct({ id: Schema.String });
export type TicketingAttachmentLookupInput = typeof TicketingAttachmentLookupInput.Type;

export const TicketingAttachmentsByOwnerInput = Schema.Struct({
  ownerKind: AttachmentOwnerKindSchema,
  ownerId: Schema.String,
});
export type TicketingAttachmentsByOwnerInput = typeof TicketingAttachmentsByOwnerInput.Type;

export const PersistedTicketHistoryEntry = Schema.Struct({
  id: TicketHistoryId,
  ticketId: TicketId,
  action: TicketHistoryAction,
  changes: Schema.Unknown,
  performedBy: Schema.String,
  performedAt: Schema.String,
});
export type PersistedTicketHistoryEntry = typeof PersistedTicketHistoryEntry.Type;

export const PersistedTicketBody = Schema.Struct({
  ticketId: TicketId,
  format: Schema.Literal("markdown"),
  body: Schema.String,
  revision: Schema.Int,
  contentHash: Schema.String,
  sizeBytes: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedTicketBody = typeof PersistedTicketBody.Type;

export const PersistedTicketBodyChange = Schema.Struct({
  id: Schema.String,
  ticketId: TicketId,
  baseRevision: Schema.Int,
  newRevision: Schema.Int,
  operation: TicketBodyOperation,
  patchExcerpt: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  beforeHash: Schema.String,
  afterHash: Schema.String,
  changedLines: Schema.Int,
  changedChars: Schema.Int,
  performedBy: Schema.String,
  performedAt: Schema.String,
});
export type PersistedTicketBodyChange = typeof PersistedTicketBodyChange.Type;

export const PersistedAcceptanceCriterion = Schema.Struct({
  id: Schema.String,
  ticketId: TicketId,
  position: Schema.Int,
  text: Schema.String,
  status: AcceptanceCriterionStatus,
  reason: Schema.NullOr(Schema.String),
  verifiedBy: Schema.NullOr(Schema.String),
  verifiedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedAcceptanceCriterion = typeof PersistedAcceptanceCriterion.Type;

// ---------------------------------------------------------------------------
// Row schemas for reading from SQLite (JSON columns decoded from strings)
// ---------------------------------------------------------------------------

export const TicketRow = Schema.Struct({
  ...PersistedTicket.fields,
  isArchived: Schema.Number,
  /** Kept as raw string | null — parsed in toPersistedTicket */
  acceptanceCriteria: Schema.NullOr(Schema.String),
  criteriaRevision: Schema.Number,
});

export const LabelRow = Schema.Struct({
  ...PersistedLabel.fields,
});

export const CommentRow = Schema.Struct({
  ...PersistedComment.fields,
});

export const ArtifactRow = Schema.Struct({
  ...PersistedArtifact.fields,
  payload: Schema.Unknown.pipe(Schema.fromJsonString),
});

export const TicketHistoryRow = Schema.Struct({
  ...PersistedTicketHistoryEntry.fields,
  changes: Schema.Unknown.pipe(Schema.fromJsonString),
});

export const TicketBodyRow = Schema.Struct({
  ...PersistedTicketBody.fields,
});

export const AcceptanceCriterionRow = Schema.Struct({
  ...PersistedAcceptanceCriterion.fields,
});

// ---------------------------------------------------------------------------
// Lookup input schemas
// ---------------------------------------------------------------------------

export const TicketLookupInput = Schema.Struct({ id: TicketId });
export type TicketLookupInput = typeof TicketLookupInput.Type;

export const TicketIdentifierLookupInput = Schema.Struct({
  identifier: Schema.String,
  projectId: Schema.optional(ProjectId),
});
export type TicketIdentifierLookupInput = typeof TicketIdentifierLookupInput.Type;

export const LabelLookupInput = Schema.Struct({ id: LabelId });
export type LabelLookupInput = typeof LabelLookupInput.Type;

export const CommentLookupInput = Schema.Struct({ id: CommentId });
export type CommentLookupInput = typeof CommentLookupInput.Type;

export const ArtifactLookupInput = Schema.Struct({ id: ArtifactId });
export type ArtifactLookupInput = typeof ArtifactLookupInput.Type;

export const TicketListByProjectInput = Schema.Struct({
  projectId: ProjectId,
  status: Schema.optional(Schema.Array(TicketStatus)),
  priority: Schema.optional(Schema.Array(TicketPriority)),
  parentId: Schema.optional(Schema.NullOr(TicketId)),
  labelId: Schema.optional(LabelId),
  search: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});
export type TicketListByProjectInput = typeof TicketListByProjectInput.Type;

export const TicketListByParentInput = Schema.Struct({ parentId: TicketId });
export type TicketListByParentInput = typeof TicketListByParentInput.Type;

export const AllocateTicketNumberInput = Schema.Struct({ projectId: ProjectId });
export type AllocateTicketNumberInput = typeof AllocateTicketNumberInput.Type;

export const DependencyLookupInput = Schema.Struct({ ticketId: TicketId });
export type DependencyLookupInput = typeof DependencyLookupInput.Type;

export const TicketsByProjectInput = Schema.Struct({ projectId: ProjectId });
export type TicketsByProjectInput = typeof TicketsByProjectInput.Type;

export const CommentsByTicketInput = Schema.Struct({
  ticketId: TicketId,
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});
export type CommentsByTicketInput = typeof CommentsByTicketInput.Type;

export const ArtifactsByTicketInput = Schema.Struct({ ticketId: TicketId });
export type ArtifactsByTicketInput = typeof ArtifactsByTicketInput.Type;

export const ArtifactsByCommentInput = Schema.Struct({ commentId: CommentId });
export type ArtifactsByCommentInput = typeof ArtifactsByCommentInput.Type;

export const HistoryByTicketInput = Schema.Struct({
  ticketId: TicketId,
  limit: Schema.optional(Schema.Int),
  offset: Schema.optional(Schema.Int),
});
export type HistoryByTicketInput = typeof HistoryByTicketInput.Type;

export const TicketBodyLookupInput = Schema.Struct({ ticketId: TicketId });
export type TicketBodyLookupInput = typeof TicketBodyLookupInput.Type;

export const CriteriaByTicketInput = Schema.Struct({ ticketId: TicketId });
export type CriteriaByTicketInput = typeof CriteriaByTicketInput.Type;

export const TicketLabelAssocInput = Schema.Struct({
  ticketId: TicketId,
  labelId: LabelId,
});
export type TicketLabelAssocInput = typeof TicketLabelAssocInput.Type;

export const DependencyAssocInput = Schema.Struct({
  ticketId: TicketId,
  dependsOnTicketId: TicketId,
});
export type DependencyAssocInput = typeof DependencyAssocInput.Type;

export const SetDependenciesRepoInput = Schema.Struct({
  ticketId: TicketId,
  dependsOnTicketIds: Schema.Array(TicketId),
});
export type SetDependenciesRepoInput = typeof SetDependenciesRepoInput.Type;

export const LabelsByProjectInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
});
export type LabelsByProjectInput = typeof LabelsByProjectInput.Type;

export const LabelsByTicketInput = Schema.Struct({ ticketId: TicketId });
export type LabelsByTicketInput = typeof LabelsByTicketInput.Type;

export const CountByParentInput = Schema.Struct({ parentId: TicketId });
export type CountByParentInput = typeof CountByParentInput.Type;

// ---------------------------------------------------------------------------
// Template schemas
// ---------------------------------------------------------------------------

export const PersistedTemplate = Schema.Struct({
  id: TemplateId,
  projectId: Schema.NullOr(ProjectId),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PersistedTemplate = typeof PersistedTemplate.Type;

export const TemplateRow = Schema.Struct({ ...PersistedTemplate.fields });

export const TemplateLookupInput = Schema.Struct({ id: TemplateId });
export type TemplateLookupInput = typeof TemplateLookupInput.Type;

export const TemplatesByProjectInput = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
});
export type TemplatesByProjectInput = typeof TemplatesByProjectInput.Type;

export const LabelsByLabelIdInput = Schema.Struct({ labelId: LabelId });
export type LabelsByLabelIdInput = typeof LabelsByLabelIdInput.Type;

// ---------------------------------------------------------------------------
// Repository shape
// ---------------------------------------------------------------------------

export interface TicketingRepositoryShape {
  // Tickets
  readonly createTicket: (input: PersistedTicket) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateTicket: (input: PersistedTicket) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Batch-resolve ticket UUIDs to their human-readable identifiers. */
  readonly getIdentifierMap: (
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, string>, ProjectionRepositoryError>;
  readonly getById: (
    input: TicketLookupInput,
  ) => Effect.Effect<Option.Option<PersistedTicket>, ProjectionRepositoryError>;
  readonly getByIdentifier: (
    input: TicketIdentifierLookupInput,
  ) => Effect.Effect<Option.Option<PersistedTicket>, ProjectionRepositoryError>;
  readonly listByProject: (
    input: TicketListByProjectInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTicket>, ProjectionRepositoryError>;
  readonly listByParent: (
    input: TicketListByParentInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTicket>, ProjectionRepositoryError>;
  readonly archiveTicket: (
    input: TicketLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly unarchiveTicket: (
    input: TicketLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteTicket: (
    input: TicketLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly allocateTicketNumber: (
    input: AllocateTicketNumberInput,
  ) => Effect.Effect<{ ticketNumber: number; identifier: string }, ProjectionRepositoryError>;
  readonly countByParent: (
    input: CountByParentInput,
  ) => Effect.Effect<number, ProjectionRepositoryError>;

  // Ticket bodies
  readonly getBody: (
    input: TicketBodyLookupInput,
  ) => Effect.Effect<Option.Option<PersistedTicketBody>, ProjectionRepositoryError>;
  readonly upsertBody: (
    input: PersistedTicketBody,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordBodyChange: (
    input: PersistedTicketBodyChange,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  // Acceptance criteria
  readonly listCriteria: (
    input: CriteriaByTicketInput,
  ) => Effect.Effect<ReadonlyArray<PersistedAcceptanceCriterion>, ProjectionRepositoryError>;
  readonly replaceCriteria: (input: {
    readonly ticketId: TicketId;
    readonly criteria: ReadonlyArray<PersistedAcceptanceCriterion>;
    readonly criteriaRevision: number;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateCriteriaRevision: (input: {
    readonly ticketId: TicketId;
    readonly criteriaRevision: number;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  // Batch queries (for eliminating N+1 in list/getTree)
  readonly batchListLabelsForTickets: (input: {
    ticketIds: ReadonlyArray<string>;
  }) => Effect.Effect<
    ReadonlyMap<string, ReadonlyArray<PersistedLabel>>,
    ProjectionRepositoryError
  >;
  readonly batchCountByParents: (input: {
    parentIds: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyMap<string, number>, ProjectionRepositoryError>;
  readonly batchListDependencies: (input: {
    ticketIds: ReadonlyArray<string>;
  }) => Effect.Effect<
    ReadonlyMap<string, ReadonlyArray<{ ticketId: string; dependsOnTicketId: string }>>,
    ProjectionRepositoryError
  >;

  // Dependencies
  readonly addDependency: (
    input: DependencyAssocInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly removeDependency: (
    input: DependencyAssocInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly setDependencies: (
    input: SetDependenciesRepoInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listDependencies: (
    input: DependencyLookupInput,
  ) => Effect.Effect<
    ReadonlyArray<{ ticketId: string; dependsOnTicketId: string }>,
    ProjectionRepositoryError
  >;
  readonly listDependents: (
    input: DependencyLookupInput,
  ) => Effect.Effect<
    ReadonlyArray<{ ticketId: string; dependsOnTicketId: string }>,
    ProjectionRepositoryError
  >;
  readonly listAllTransitiveDependencies: (
    input: DependencyLookupInput,
  ) => Effect.Effect<ReadonlyArray<string>, ProjectionRepositoryError>;

  // Labels
  readonly createLabel: (input: PersistedLabel) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateLabel: (input: PersistedLabel) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getLabel: (
    input: LabelLookupInput,
  ) => Effect.Effect<Option.Option<PersistedLabel>, ProjectionRepositoryError>;
  readonly listLabels: (
    input: LabelsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<PersistedLabel>, ProjectionRepositoryError>;
  readonly deleteLabel: (input: LabelLookupInput) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly addTicketLabel: (
    input: TicketLabelAssocInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly removeTicketLabel: (
    input: TicketLabelAssocInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listLabelsForTicket: (
    input: LabelsByTicketInput,
  ) => Effect.Effect<ReadonlyArray<PersistedLabel>, ProjectionRepositoryError>;
  readonly listGlobalLabels: () => Effect.Effect<
    ReadonlyArray<PersistedLabel>,
    ProjectionRepositoryError
  >;
  readonly listTicketIdsByLabelId: (
    input: LabelsByLabelIdInput,
  ) => Effect.Effect<ReadonlyArray<TicketId>, ProjectionRepositoryError>;

  // Templates
  readonly createTemplate: (
    input: PersistedTemplate,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateTemplate: (
    input: PersistedTemplate,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getTemplate: (
    input: TemplateLookupInput,
  ) => Effect.Effect<Option.Option<PersistedTemplate>, ProjectionRepositoryError>;
  readonly listTemplates: (
    input: TemplatesByProjectInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTemplate>, ProjectionRepositoryError>;
  readonly listGlobalTemplates: () => Effect.Effect<
    ReadonlyArray<PersistedTemplate>,
    ProjectionRepositoryError
  >;
  readonly deleteTemplate: (
    input: TemplateLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  // Comments
  readonly createComment: (
    input: PersistedComment,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updateComment: (
    input: PersistedComment,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getComment: (
    input: CommentLookupInput,
  ) => Effect.Effect<Option.Option<PersistedComment>, ProjectionRepositoryError>;
  readonly listCommentsByTicket: (
    input: CommentsByTicketInput,
  ) => Effect.Effect<ReadonlyArray<PersistedComment>, ProjectionRepositoryError>;
  readonly deleteComment: (
    input: CommentLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  // Artifacts
  readonly createArtifact: (
    input: PersistedArtifact,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getArtifact: (
    input: ArtifactLookupInput,
  ) => Effect.Effect<Option.Option<PersistedArtifact>, ProjectionRepositoryError>;
  readonly listArtifactsByTicket: (
    input: ArtifactsByTicketInput,
  ) => Effect.Effect<ReadonlyArray<PersistedArtifact>, ProjectionRepositoryError>;
  readonly listArtifactsByComment: (
    input: ArtifactsByCommentInput,
  ) => Effect.Effect<ReadonlyArray<PersistedArtifact>, ProjectionRepositoryError>;
  readonly updateArtifactTitle: (input: {
    readonly id: ArtifactId;
    readonly title: string | null;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteArtifact: (
    input: ArtifactLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  // Ticketing attachments (file-backed)
  readonly createTicketingAttachment: (
    input: PersistedTicketingAttachment,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getTicketingAttachment: (
    input: TicketingAttachmentLookupInput,
  ) => Effect.Effect<Option.Option<PersistedTicketingAttachment>, ProjectionRepositoryError>;
  readonly listTicketingAttachmentsByOwner: (
    input: TicketingAttachmentsByOwnerInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTicketingAttachment>, ProjectionRepositoryError>;
  readonly deleteTicketingAttachment: (
    input: TicketingAttachmentLookupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteTicketingAttachmentsByOwner: (
    input: TicketingAttachmentsByOwnerInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTicketingAttachment>, ProjectionRepositoryError>;

  // History
  readonly recordHistory: (
    input: PersistedTicketHistoryEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listHistoryByTicket: (
    input: HistoryByTicketInput,
  ) => Effect.Effect<ReadonlyArray<PersistedTicketHistoryEntry>, ProjectionRepositoryError>;
}

export class TicketingRepository extends ServiceMap.Service<
  TicketingRepository,
  TicketingRepositoryShape
>()("t3/persistence/Services/Ticketing/TicketingRepository") {}
