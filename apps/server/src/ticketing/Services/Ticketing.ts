import type {
  Artifact,
  ArtifactCreateInput,
  ArtifactDeleteInput,
  ArtifactListInput,
  ArtifactUpdateInput,
  Comment,
  CommentCreateInput,
  CommentDeleteInput,
  CommentListInput,
  CommentUpdateInput,
  DependencyInput,
  Label,
  LabelCreateInput,
  LabelDeleteInput,
  LabelListInput,
  LabelUpdateInput,
  SetDependenciesInput,
  Template,
  TemplateCreateInput,
  TemplateDeleteInput,
  TemplateGetInput,
  TemplateListInput,
  TemplateUpdateInput,
  Ticket,
  TicketArchiveInput,
  TicketBodyEditInput,
  TicketBodyEditResult,
  TicketBodyGetInput,
  TicketBodyReadResult,
  TicketBodySearchInput,
  TicketBodySearchResult,
  TicketBodySectionsInput,
  TicketBodySectionsResult,
  TicketCreateInput,
  TicketCriteriaEditInput,
  TicketCriteriaListInput,
  TicketCriteriaListResult,
  TicketUpdateInput,
  TicketDeleteInput,
  TicketUnarchiveInput,
  TicketGetByIdInput,
  TicketGetByIdentifierInput,
  TicketHistoryEntry,
  TicketHistoryInput,
  TicketThreadLinks,
  TicketThreadLinksInput,
  TicketId,
  TicketingError,
  TicketingStreamEvent,
  TicketLabelInput,
  TicketListInput,
  TicketReorderInput,
  TicketSearchInput,
  TicketSummary,
  TicketTreeInput,
  TicketTreeNode,
  UpdateCriterionStatusInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface TicketingServiceShape {
  /** Resolve a UUID or human-readable identifier (e.g. "ZBD-7") to a TicketId (UUID). */
  readonly resolveId: (idOrIdentifier: string) => Effect.Effect<TicketId, TicketingError>;

  /** Batch-resolve ticket UUIDs to their human-readable identifiers. */
  readonly resolveIdentifiers: (
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, string>, TicketingError>;

  // Tickets
  readonly list: (
    input: TicketListInput,
  ) => Effect.Effect<ReadonlyArray<TicketSummary>, TicketingError>;
  readonly getById: (input: TicketGetByIdInput) => Effect.Effect<Ticket, TicketingError>;
  readonly getByIdentifier: (
    input: TicketGetByIdentifierInput,
  ) => Effect.Effect<Ticket, TicketingError>;
  readonly getThreadLinks: (
    input: TicketThreadLinksInput,
  ) => Effect.Effect<TicketThreadLinks, TicketingError>;
  readonly getBody: (
    input: TicketBodyGetInput,
  ) => Effect.Effect<TicketBodyReadResult, TicketingError>;
  readonly searchBody: (
    input: TicketBodySearchInput,
  ) => Effect.Effect<TicketBodySearchResult, TicketingError>;
  readonly getBodySections: (
    input: TicketBodySectionsInput,
  ) => Effect.Effect<TicketBodySectionsResult, TicketingError>;
  readonly editBody: (
    input: TicketBodyEditInput,
  ) => Effect.Effect<TicketBodyEditResult, TicketingError>;
  readonly listCriteria: (
    input: TicketCriteriaListInput,
  ) => Effect.Effect<TicketCriteriaListResult, TicketingError>;
  readonly editCriteria: (
    input: TicketCriteriaEditInput,
  ) => Effect.Effect<TicketCriteriaListResult, TicketingError>;
  readonly create: (input: TicketCreateInput) => Effect.Effect<Ticket, TicketingError>;
  readonly update: (input: TicketUpdateInput) => Effect.Effect<Ticket, TicketingError>;
  readonly delete: (input: TicketDeleteInput) => Effect.Effect<void, TicketingError>;
  readonly archive: (input: TicketArchiveInput) => Effect.Effect<Ticket, TicketingError>;
  readonly unarchive: (input: TicketUnarchiveInput) => Effect.Effect<Ticket, TicketingError>;
  readonly reorder: (input: TicketReorderInput) => Effect.Effect<void, TicketingError>;
  readonly search: (
    input: TicketSearchInput,
  ) => Effect.Effect<ReadonlyArray<TicketSummary>, TicketingError>;
  readonly getTree: (
    input: TicketTreeInput,
  ) => Effect.Effect<ReadonlyArray<TicketTreeNode>, TicketingError>;

  // Dependencies
  readonly setDependencies: (input: SetDependenciesInput) => Effect.Effect<void, TicketingError>;
  readonly addDependency: (input: DependencyInput) => Effect.Effect<void, TicketingError>;
  readonly removeDependency: (input: DependencyInput) => Effect.Effect<void, TicketingError>;

  // Acceptance criteria
  readonly updateCriterionStatus: (
    input: UpdateCriterionStatusInput,
  ) => Effect.Effect<Ticket, TicketingError>;

  // History
  readonly getHistory: (
    input: TicketHistoryInput,
  ) => Effect.Effect<ReadonlyArray<TicketHistoryEntry>, TicketingError>;

  // Labels
  readonly listLabels: (
    input: LabelListInput,
  ) => Effect.Effect<ReadonlyArray<Label>, TicketingError>;
  readonly createLabel: (input: LabelCreateInput) => Effect.Effect<Label, TicketingError>;
  readonly updateLabel: (input: LabelUpdateInput) => Effect.Effect<Label, TicketingError>;
  readonly deleteLabel: (input: LabelDeleteInput) => Effect.Effect<void, TicketingError>;
  readonly addTicketLabel: (input: TicketLabelInput) => Effect.Effect<void, TicketingError>;
  readonly removeTicketLabel: (input: TicketLabelInput) => Effect.Effect<void, TicketingError>;

  // Templates
  readonly listTemplates: (
    input: TemplateListInput,
  ) => Effect.Effect<ReadonlyArray<Template>, TicketingError>;
  readonly getTemplate: (input: TemplateGetInput) => Effect.Effect<Template, TicketingError>;
  readonly createTemplate: (input: TemplateCreateInput) => Effect.Effect<Template, TicketingError>;
  readonly updateTemplate: (input: TemplateUpdateInput) => Effect.Effect<Template, TicketingError>;
  readonly deleteTemplate: (input: TemplateDeleteInput) => Effect.Effect<void, TicketingError>;

  // Shipped defaults
  readonly ensureShippedDefaults: () => Effect.Effect<void, TicketingError>;

  // Comments
  readonly listComments: (
    input: CommentListInput,
  ) => Effect.Effect<ReadonlyArray<Comment>, TicketingError>;
  readonly createComment: (input: CommentCreateInput) => Effect.Effect<Comment, TicketingError>;
  readonly updateComment: (input: CommentUpdateInput) => Effect.Effect<Comment, TicketingError>;
  readonly deleteComment: (input: CommentDeleteInput) => Effect.Effect<void, TicketingError>;

  // Artifacts
  readonly listArtifacts: (
    input: ArtifactListInput,
  ) => Effect.Effect<ReadonlyArray<Artifact>, TicketingError>;
  readonly createArtifact: (input: ArtifactCreateInput) => Effect.Effect<Artifact, TicketingError>;
  readonly updateArtifact: (input: ArtifactUpdateInput) => Effect.Effect<Artifact, TicketingError>;
  readonly deleteArtifact: (input: ArtifactDeleteInput) => Effect.Effect<void, TicketingError>;

  // Streaming
  readonly streamEvents: Stream.Stream<TicketingStreamEvent>;
}

export class TicketingService extends ServiceMap.Service<TicketingService, TicketingServiceShape>()(
  "t3/ticketing/Services/Ticketing/TicketingService",
) {}
