import { Schema } from "effect";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export const TicketId = TrimmedNonEmptyString.pipe(Schema.brand("TicketId"));
export type TicketId = typeof TicketId.Type;

export const LabelId = TrimmedNonEmptyString.pipe(Schema.brand("LabelId"));
export type LabelId = typeof LabelId.Type;

export const CommentId = TrimmedNonEmptyString.pipe(Schema.brand("CommentId"));
export type CommentId = typeof CommentId.Type;

export const ArtifactId = TrimmedNonEmptyString.pipe(Schema.brand("ArtifactId"));
export type ArtifactId = typeof ArtifactId.Type;

export const TicketHistoryId = TrimmedNonEmptyString.pipe(Schema.brand("TicketHistoryId"));
export type TicketHistoryId = typeof TicketHistoryId.Type;

export const TemplateId = TrimmedNonEmptyString.pipe(Schema.brand("TemplateId"));
export type TemplateId = typeof TemplateId.Type;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TicketStatus = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "canceled",
]);
export type TicketStatus = typeof TicketStatus.Type;

export const TicketPriority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type TicketPriority = typeof TicketPriority.Type;

export const CommentAuthorType = Schema.Literals(["human", "llm"]);
export type CommentAuthorType = typeof CommentAuthorType.Type;

export const ArtifactType = Schema.Literals(["figma_url", "mermaid", "image"]);
export type ArtifactType = typeof ArtifactType.Type;

export const AcceptanceCriterionStatus = Schema.Literals(["pending", "met", "not_met"]);
export type AcceptanceCriterionStatus = typeof AcceptanceCriterionStatus.Type;

export const TicketHistoryAction = Schema.Literals([
  "created",
  "updated",
  "status_changed",
  "body_updated",
  "criteria_updated",
  "dependency_added",
  "dependency_removed",
  "label_added",
  "label_removed",
  "comment_added",
  "comment_updated",
  "comment_deleted",
  "artifact_added",
  "artifact_updated",
  "artifact_deleted",
]);
export type TicketHistoryAction = typeof TicketHistoryAction.Type;

export const TicketBodyOperation = Schema.Literals([
  "str_replace",
  "insert",
  "replace_section",
  "append_section",
  "replace_body",
]);
export type TicketBodyOperation = typeof TicketBodyOperation.Type;

export const TicketCriteriaOperation = Schema.Literals(["add", "update", "remove", "reorder"]);
export type TicketCriteriaOperation = typeof TicketCriteriaOperation.Type;

// ---------------------------------------------------------------------------
// Artifact payload schemas (per type)
// ---------------------------------------------------------------------------

export const FigmaUrlPayload = Schema.Struct({
  url: Schema.String,
  nodeId: Schema.optional(Schema.String),
});
export type FigmaUrlPayload = typeof FigmaUrlPayload.Type;

export const MermaidPayload = Schema.Struct({
  source: Schema.String,
});
export type MermaidPayload = typeof MermaidPayload.Type;

export const ImagePayload = Schema.Struct({
  url: Schema.String,
  alt: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
});
export type ImagePayload = typeof ImagePayload.Type;

// ---------------------------------------------------------------------------
// Core domain schemas
// ---------------------------------------------------------------------------

export const AcceptanceCriterion = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyString),
  position: Schema.optional(Schema.Int),
  text: Schema.String,
  status: AcceptanceCriterionStatus,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  verifiedBy: Schema.optional(Schema.NullOr(Schema.String)),
  verifiedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  createdAt: Schema.optional(IsoDateTime),
  updatedAt: Schema.optional(IsoDateTime),
});
export type AcceptanceCriterion = typeof AcceptanceCriterion.Type;

export const TicketBodyMetadata = Schema.Struct({
  revision: Schema.Int,
  contentHash: TrimmedNonEmptyString,
  sizeBytes: Schema.Int,
  lineCount: Schema.Int,
});
export type TicketBodyMetadata = typeof TicketBodyMetadata.Type;

export const TicketBodyEventMetadata = Schema.Struct({
  ticketId: TicketId,
  revision: Schema.Int,
  contentHash: TrimmedNonEmptyString,
  sizeBytes: Schema.Int,
  summary: Schema.optional(Schema.String),
});
export type TicketBodyEventMetadata = typeof TicketBodyEventMetadata.Type;

export const TicketBodyLine = Schema.Struct({
  line: Schema.Int,
  text: Schema.String,
});
export type TicketBodyLine = typeof TicketBodyLine.Type;

export const TicketBodyReadResult = Schema.Struct({
  ticketId: TicketId,
  revision: Schema.Int,
  contentHash: TrimmedNonEmptyString,
  format: Schema.Literal("markdown"),
  sizeBytes: Schema.Int,
  lineCount: Schema.Int,
  startLine: Schema.Int,
  limit: Schema.Int,
  lines: Schema.Array(TicketBodyLine),
  truncated: Schema.Boolean,
  sectionHash: Schema.optional(TrimmedNonEmptyString),
});
export type TicketBodyReadResult = typeof TicketBodyReadResult.Type;

export const TicketBodySearchMatch = Schema.Struct({
  line: Schema.Int,
  text: Schema.String,
  before: Schema.Array(TicketBodyLine),
  after: Schema.Array(TicketBodyLine),
});
export type TicketBodySearchMatch = typeof TicketBodySearchMatch.Type;

export const TicketBodySearchResult = Schema.Struct({
  ticketId: TicketId,
  revision: Schema.Int,
  contentHash: TrimmedNonEmptyString,
  matches: Schema.Array(TicketBodySearchMatch),
  truncated: Schema.Boolean,
});
export type TicketBodySearchResult = typeof TicketBodySearchResult.Type;

export const TicketBodySection = Schema.Struct({
  path: Schema.Array(Schema.String),
  heading: Schema.String,
  level: Schema.Int,
  startLine: Schema.Int,
  endLine: Schema.Int,
  startChar: Schema.Int,
  endChar: Schema.Int,
  sectionHash: TrimmedNonEmptyString,
});
export type TicketBodySection = typeof TicketBodySection.Type;

export const TicketBodySectionsResult = Schema.Struct({
  ticketId: TicketId,
  revision: Schema.Int,
  contentHash: TrimmedNonEmptyString,
  sections: Schema.Array(TicketBodySection),
});
export type TicketBodySectionsResult = typeof TicketBodySectionsResult.Type;

export const TicketBodyEditResult = Schema.Struct({
  ticketId: TicketId,
  revision: Schema.Int,
  contentHash: TrimmedNonEmptyString,
  sizeBytes: Schema.Int,
  lineCount: Schema.Int,
  changedLines: Schema.Int,
  changedChars: Schema.Int,
  summary: Schema.String,
});
export type TicketBodyEditResult = typeof TicketBodyEditResult.Type;

export const TicketCriteriaListResult = Schema.Struct({
  ticketId: TicketId,
  criteriaRevision: Schema.Int,
  criteria: Schema.Array(AcceptanceCriterion),
});
export type TicketCriteriaListResult = typeof TicketCriteriaListResult.Type;

export const Label = Schema.Struct({
  id: LabelId,
  projectId: Schema.NullOr(ProjectId),
  name: TrimmedNonEmptyString,
  color: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Label = typeof Label.Type;

export const Template = Schema.Struct({
  id: TemplateId,
  projectId: Schema.NullOr(ProjectId),
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Template = typeof Template.Type;

export const TicketDependency = Schema.Struct({
  ticketId: TicketId,
  dependsOnTicketId: TicketId,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TicketStatus,
});
export type TicketDependency = typeof TicketDependency.Type;

export const Comment = Schema.Struct({
  id: CommentId,
  ticketId: TicketId,
  parentId: Schema.NullOr(CommentId),
  authorType: CommentAuthorType,
  authorName: TrimmedNonEmptyString,
  authorModel: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Comment = typeof Comment.Type;

export const Artifact = Schema.Struct({
  id: ArtifactId,
  ticketId: Schema.NullOr(TicketId),
  commentId: Schema.NullOr(CommentId),
  type: ArtifactType,
  title: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Artifact = typeof Artifact.Type;

export const TicketHistoryEntry = Schema.Struct({
  id: TicketHistoryId,
  ticketId: TicketId,
  action: TicketHistoryAction,
  changes: Schema.Unknown,
  performedBy: Schema.String,
  performedAt: IsoDateTime,
});
export type TicketHistoryEntry = typeof TicketHistoryEntry.Type;

export const TicketSummary = Schema.Struct({
  id: TicketId,
  projectId: ProjectId,
  parentId: Schema.NullOr(TicketId),
  ticketNumber: Schema.Int,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TicketStatus,
  priority: TicketPriority,
  sortOrder: Schema.Number,
  isArchived: Schema.Boolean,
  worktree: Schema.NullOr(Schema.String),
  labels: Schema.Array(Label),
  subTicketCount: Schema.Int,
  dependencyCount: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TicketSummary = typeof TicketSummary.Type;

export const Ticket = Schema.Struct({
  id: TicketId,
  projectId: ProjectId,
  parentId: Schema.NullOr(TicketId),
  ticketNumber: Schema.Int,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  body: Schema.optional(TicketBodyMetadata),
  bodyPreview: Schema.optional(Schema.Array(TicketBodyLine)),
  status: TicketStatus,
  priority: TicketPriority,
  sortOrder: Schema.Number,
  isArchived: Schema.Boolean,
  worktree: Schema.NullOr(Schema.String),
  acceptanceCriteria: Schema.NullOr(Schema.Array(AcceptanceCriterion)),
  criteriaRevision: Schema.optional(Schema.Int),
  labels: Schema.Array(Label),
  dependencies: Schema.Array(TicketDependency),
  subTickets: Schema.Array(TicketSummary),
  comments: Schema.Array(Comment),
  artifacts: Schema.Array(Artifact),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Ticket = typeof Ticket.Type;

export const TicketThreadLinkType = Schema.Literals(["origin", "bound", "mention"]);
export type TicketThreadLinkType = typeof TicketThreadLinkType.Type;

export const TicketLinkedThread = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  isOrchestrationThread: Schema.Boolean,
  parentThreadId: Schema.NullOr(ThreadId),
  linkedAt: IsoDateTime,
});
export type TicketLinkedThread = typeof TicketLinkedThread.Type;

export const TicketThreadLinks = Schema.Struct({
  ticketId: TicketId,
  originThread: Schema.NullOr(TicketLinkedThread),
});
export type TicketThreadLinks = typeof TicketThreadLinks.Type;

export interface TicketTreeNode {
  readonly ticket: TicketSummary;
  readonly children: ReadonlyArray<TicketTreeNode>;
  readonly dependencies: ReadonlyArray<TicketDependency>;
}

/**
 * Pass-through schema for TicketTreeNode — avoids recursive Schema.suspend which
 * introduces `unknown` into the Requirements channel and poisons the entire RpcGroup.
 * The struct matches the non-recursive fields; the cast makes the type correct.
 * Actual encode/decode works because Effect RPC uses JSON serialization which
 * handles the recursive children natively.
 */
export const TicketTreeNodeWire = Schema.Struct({
  ticket: TicketSummary,
  children: Schema.Array(Schema.Unknown),
  dependencies: Schema.Array(TicketDependency),
});

export const TicketTreeNode = TicketTreeNodeWire as unknown as Schema.Schema<TicketTreeNode>;

export interface TicketTreeResult {
  readonly roots: ReadonlyArray<TicketTreeNode>;
  readonly truncated: boolean;
  readonly totalCount: number;
}

/**
 * Pass-through schema for TicketTreeResult — uses TicketTreeNodeWire (the actual
 * runtime schema) for `roots`, then casts to the recursive type. Same pattern as
 * TicketTreeNode above.
 */
export const TicketTreeResultWire = Schema.Struct({
  /** Top-level subtree nodes (children of the requested root, or top-level project tickets). */
  roots: Schema.Array(TicketTreeNodeWire),
  /** True when the result was capped by the server's subtree limit. */
  truncated: Schema.Boolean,
  /**
   * Number of ticket nodes in the returned subtree (excluding the root). When `truncated`
   * is true this equals the cap; the actual subtree may be larger.
   */
  totalCount: Schema.Int,
});

export const TicketTreeResult = TicketTreeResultWire as unknown as Schema.Schema<TicketTreeResult>;

// ---------------------------------------------------------------------------
// RPC input schemas
// ---------------------------------------------------------------------------

export const TicketCreateInput = Schema.Struct({
  projectId: ProjectId,
  parentId: Schema.optional(Schema.NullOr(TicketId)),
  originThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  acceptanceCriteria: Schema.optional(Schema.NullOr(Schema.Array(AcceptanceCriterion))),
  status: Schema.optional(TicketStatus),
  priority: Schema.optional(TicketPriority),
  sortOrder: Schema.optional(Schema.Number),
  worktree: Schema.optional(Schema.NullOr(Schema.String)),
  labelIds: Schema.optional(Schema.Array(LabelId)),
  dependencyIds: Schema.optional(Schema.Array(TicketId)),
  templateId: Schema.optional(Schema.NullOr(TemplateId)),
});
export type TicketCreateInput = typeof TicketCreateInput.Type;

export const TicketThreadLinksInput = Schema.Struct({
  ticketId: TicketId,
});
export type TicketThreadLinksInput = typeof TicketThreadLinksInput.Type;

export const TicketUpdateInput = Schema.Struct({
  id: TicketId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  expectedRevision: Schema.optional(Schema.Int),
  acceptanceCriteria: Schema.optional(Schema.NullOr(Schema.Array(AcceptanceCriterion))),
  expectedCriteriaRevision: Schema.optional(Schema.Int),
  status: Schema.optional(TicketStatus),
  priority: Schema.optional(TicketPriority),
  parentId: Schema.optional(Schema.NullOr(TicketId)),
  sortOrder: Schema.optional(Schema.Number),
  worktree: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TicketUpdateInput = typeof TicketUpdateInput.Type;

export const TicketListInput = Schema.Struct({
  projectId: ProjectId,
  status: Schema.optional(Schema.Array(TicketStatus)),
  priority: Schema.optional(Schema.Array(TicketPriority)),
  parentId: Schema.optional(Schema.NullOr(TicketId)),
  labelId: Schema.optional(LabelId),
  search: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type TicketListInput = typeof TicketListInput.Type;

export const TicketGetByIdInput = Schema.Struct({
  id: TicketId,
  projectId: Schema.optional(ProjectId),
  includeBody: Schema.optional(Schema.Boolean),
});
export type TicketGetByIdInput = typeof TicketGetByIdInput.Type;

export const TicketGetByIdentifierInput = Schema.Struct({
  identifier: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  includeBody: Schema.optional(Schema.Boolean),
});
export type TicketGetByIdentifierInput = typeof TicketGetByIdentifierInput.Type;

export const TicketDeleteInput = Schema.Struct({ id: TicketId });
export type TicketDeleteInput = typeof TicketDeleteInput.Type;

export const TicketArchiveInput = Schema.Struct({ id: TicketId });
export type TicketArchiveInput = typeof TicketArchiveInput.Type;

export const TicketUnarchiveInput = Schema.Struct({ id: TicketId });
export type TicketUnarchiveInput = typeof TicketUnarchiveInput.Type;

export const TicketSearchInput = Schema.Struct({
  projectId: ProjectId,
  query: Schema.String,
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type TicketSearchInput = typeof TicketSearchInput.Type;

export const TicketTreeInput = Schema.Struct({
  projectId: ProjectId,
  rootTicketId: Schema.optional(TicketId),
});
export type TicketTreeInput = typeof TicketTreeInput.Type;

export const TicketReorderInput = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: TicketId, sortOrder: Schema.Number })),
});
export type TicketReorderInput = typeof TicketReorderInput.Type;

export const DependencyInput = Schema.Struct({
  ticketId: TicketId,
  dependsOnTicketId: TicketId,
});
export type DependencyInput = typeof DependencyInput.Type;

export const SetDependenciesInput = Schema.Struct({
  ticketId: TicketId,
  dependsOnTicketIds: Schema.Array(TicketId),
});
export type SetDependenciesInput = typeof SetDependenciesInput.Type;

export const UpdateCriterionStatusInput = Schema.Struct({
  ticketId: TicketId,
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  status: AcceptanceCriterionStatus,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});
export type UpdateCriterionStatusInput = typeof UpdateCriterionStatusInput.Type;

export const TicketBodyGetInput = Schema.Struct({
  ticketId: TicketId,
  startLine: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  sectionPath: Schema.optional(Schema.Array(Schema.String)),
});
export type TicketBodyGetInput = typeof TicketBodyGetInput.Type;

export const TicketBodySearchInput = Schema.Struct({
  ticketId: TicketId,
  query: Schema.String,
  contextLines: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type TicketBodySearchInput = typeof TicketBodySearchInput.Type;

export const TicketBodySectionsInput = Schema.Struct({
  ticketId: TicketId,
  maxDepth: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type TicketBodySectionsInput = typeof TicketBodySectionsInput.Type;

export const TicketBodyEditInput = Schema.Struct({
  ticketId: TicketId,
  expectedRevision: Schema.Int,
  expectedSectionHash: Schema.optional(Schema.String),
  operation: TicketBodyOperation,
  oldStr: Schema.optional(Schema.String),
  newStr: Schema.optional(Schema.String),
  occurrence: Schema.optional(Schema.Literals(["first", "last", "all"])),
  requireUnique: Schema.optional(Schema.Boolean),
  insertLine: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  insertText: Schema.optional(Schema.String),
  sectionPath: Schema.optional(Schema.Array(Schema.String)),
  heading: Schema.optional(Schema.String),
  markdown: Schema.optional(Schema.String),
  parentSectionPath: Schema.optional(Schema.Array(Schema.String)),
  body: Schema.optional(Schema.String),
});
export type TicketBodyEditInput = typeof TicketBodyEditInput.Type;

export const TicketCriteriaListInput = Schema.Struct({
  ticketId: TicketId,
});
export type TicketCriteriaListInput = typeof TicketCriteriaListInput.Type;

export const TicketCriteriaEditInput = Schema.Struct({
  ticketId: TicketId,
  expectedCriteriaRevision: Schema.Int,
  operation: TicketCriteriaOperation,
  criterionId: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  status: Schema.optional(AcceptanceCriterionStatus),
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  verifiedBy: Schema.optional(Schema.NullOr(Schema.String)),
  verifiedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  afterCriterionId: Schema.optional(Schema.String),
  beforeCriterionId: Schema.optional(Schema.String),
  criterionIds: Schema.optional(Schema.Array(Schema.String)),
});
export type TicketCriteriaEditInput = typeof TicketCriteriaEditInput.Type;

export const LabelCreateInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  name: TrimmedNonEmptyString,
  color: TrimmedNonEmptyString,
});
export type LabelCreateInput = typeof LabelCreateInput.Type;

export const LabelUpdateInput = Schema.Struct({
  id: LabelId,
  name: Schema.optional(TrimmedNonEmptyString),
  color: Schema.optional(TrimmedNonEmptyString),
});
export type LabelUpdateInput = typeof LabelUpdateInput.Type;

export const LabelDeleteInput = Schema.Struct({ id: LabelId });
export type LabelDeleteInput = typeof LabelDeleteInput.Type;

export const LabelListInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
});
export type LabelListInput = typeof LabelListInput.Type;

export const TicketLabelInput = Schema.Struct({
  ticketId: TicketId,
  labelId: LabelId,
});
export type TicketLabelInput = typeof TicketLabelInput.Type;

// ---------------------------------------------------------------------------
// Template input schemas
// ---------------------------------------------------------------------------

export const TemplateCreateInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.String,
});
export type TemplateCreateInput = typeof TemplateCreateInput.Type;

export const TemplateUpdateInput = Schema.Struct({
  id: TemplateId,
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.optional(Schema.String),
});
export type TemplateUpdateInput = typeof TemplateUpdateInput.Type;

export const TemplateDeleteInput = Schema.Struct({ id: TemplateId });
export type TemplateDeleteInput = typeof TemplateDeleteInput.Type;

export const TemplateListInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
});
export type TemplateListInput = typeof TemplateListInput.Type;

export const TemplateGetInput = Schema.Struct({ id: TemplateId });
export type TemplateGetInput = typeof TemplateGetInput.Type;

// ---------------------------------------------------------------------------
// Comment / Artifact input schemas
// ---------------------------------------------------------------------------

export const CommentCreateInput = Schema.Struct({
  ticketId: TicketId,
  parentId: Schema.optional(Schema.NullOr(CommentId)),
  authorType: CommentAuthorType,
  authorName: TrimmedNonEmptyString,
  authorModel: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.String,
});
export type CommentCreateInput = typeof CommentCreateInput.Type;

export const CommentUpdateInput = Schema.Struct({
  id: CommentId,
  body: Schema.String,
});
export type CommentUpdateInput = typeof CommentUpdateInput.Type;

export const CommentDeleteInput = Schema.Struct({ id: CommentId });
export type CommentDeleteInput = typeof CommentDeleteInput.Type;

export const CommentListInput = Schema.Struct({
  ticketId: TicketId,
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type CommentListInput = typeof CommentListInput.Type;

export const ArtifactCreateInput = Schema.Struct({
  ticketId: Schema.optional(Schema.NullOr(TicketId)),
  commentId: Schema.optional(Schema.NullOr(CommentId)),
  type: ArtifactType,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  payload: Schema.Unknown,
});
export type ArtifactCreateInput = typeof ArtifactCreateInput.Type;

export const ArtifactUpdateInput = Schema.Struct({
  id: ArtifactId,
  title: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ArtifactUpdateInput = typeof ArtifactUpdateInput.Type;

export const ArtifactDeleteInput = Schema.Struct({ id: ArtifactId });
export type ArtifactDeleteInput = typeof ArtifactDeleteInput.Type;

export const ArtifactListInput = Schema.Struct({ ticketId: TicketId });
export type ArtifactListInput = typeof ArtifactListInput.Type;

export const TicketHistoryInput = Schema.Struct({
  ticketId: TicketId,
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type TicketHistoryInput = typeof TicketHistoryInput.Type;

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

export const TicketingStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ticket_upserted"),
    projectId: ProjectId,
    ticket: TicketSummary,
    body: Schema.optional(TicketBodyEventMetadata),
  }),
  Schema.Struct({
    type: Schema.Literal("ticket_deleted"),
    projectId: ProjectId,
    ticketId: TicketId,
  }),
  Schema.Struct({
    type: Schema.Literal("label_upserted"),
    label: Label,
  }),
  Schema.Struct({
    type: Schema.Literal("label_deleted"),
    labelId: LabelId,
  }),
  Schema.Struct({
    type: Schema.Literal("comment_upserted"),
    ticketId: TicketId,
    comment: Comment,
  }),
  Schema.Struct({
    type: Schema.Literal("comment_deleted"),
    ticketId: TicketId,
    commentId: CommentId,
  }),
  Schema.Struct({
    type: Schema.Literal("artifact_upserted"),
    ticketId: Schema.NullOr(TicketId),
    commentId: Schema.NullOr(CommentId),
    artifact: Artifact,
  }),
  Schema.Struct({
    type: Schema.Literal("artifact_deleted"),
    ticketId: Schema.NullOr(TicketId),
    commentId: Schema.NullOr(CommentId),
    artifactId: ArtifactId,
  }),
  Schema.Struct({
    type: Schema.Literal("template_upserted"),
    template: Template,
  }),
  Schema.Struct({
    type: Schema.Literal("template_deleted"),
    templateId: TemplateId,
  }),
]);
export type TicketingStreamEvent = typeof TicketingStreamEvent.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TicketNotFoundError extends Schema.TaggedErrorClass<TicketNotFoundError>()(
  "TicketNotFoundError",
  {
    ticketId: TrimmedNonEmptyString,
  },
) {
  override get message() {
    return `Unknown ticket: ${this.ticketId}`;
  }
}

export class LabelNotFoundError extends Schema.TaggedErrorClass<LabelNotFoundError>()(
  "LabelNotFoundError",
  {
    labelId: LabelId,
  },
) {
  override get message() {
    return `Unknown label: ${this.labelId}`;
  }
}

export class TemplateNotFoundError extends Schema.TaggedErrorClass<TemplateNotFoundError>()(
  "TemplateNotFoundError",
  {
    templateId: TemplateId,
  },
) {
  override get message() {
    return `Unknown template: ${this.templateId}`;
  }
}

export class CommentNotFoundError extends Schema.TaggedErrorClass<CommentNotFoundError>()(
  "CommentNotFoundError",
  {
    commentId: CommentId,
  },
) {
  override get message() {
    return `Unknown comment: ${this.commentId}`;
  }
}

export class DependencyCycleError extends Schema.TaggedErrorClass<DependencyCycleError>()(
  "DependencyCycleError",
  {
    ticketId: TicketId,
    dependsOnTicketId: TicketId,
    cycle: Schema.Array(TrimmedNonEmptyString),
  },
) {
  override get message() {
    return `Adding dependency would create a cycle: ${this.cycle.join(" → ")}`;
  }
}

export class TicketingOperationError extends Schema.TaggedErrorClass<TicketingOperationError>()(
  "TicketingOperationError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class TicketingValidationError extends Schema.TaggedErrorClass<TicketingValidationError>()(
  "TicketingValidationError",
  {
    field: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}

export const TicketingError = Schema.Union([
  TicketNotFoundError,
  LabelNotFoundError,
  TemplateNotFoundError,
  CommentNotFoundError,
  DependencyCycleError,
  TicketingOperationError,
  TicketingValidationError,
]);
export type TicketingError = typeof TicketingError.Type;
