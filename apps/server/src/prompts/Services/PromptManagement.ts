import type {
  ListPromptDefinitionsInput,
  ListPromptDefinitionsResult,
  PreviewPromptDocumentInput,
  PreviewPromptDocumentResult,
  PromptDocumentQueryInput,
  PromptDocumentState,
  PromptDocumentValidationResult,
  UpdatePromptDocumentInput,
  ValidatePromptDocumentInput,
  PromptManagementError,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface PromptManagementShape {
  readonly listPromptDefinitions: (
    input: ListPromptDefinitionsInput,
  ) => Effect.Effect<ListPromptDefinitionsResult, PromptManagementError>;
  readonly getPromptDocument: (
    input: PromptDocumentQueryInput,
  ) => Effect.Effect<PromptDocumentState, PromptManagementError>;
  readonly validatePromptDocument: (
    input: ValidatePromptDocumentInput,
  ) => Effect.Effect<PromptDocumentValidationResult, PromptManagementError>;
  readonly previewPromptDocument: (
    input: PreviewPromptDocumentInput,
  ) => Effect.Effect<PreviewPromptDocumentResult, PromptManagementError>;
  readonly updatePromptDocument: (
    input: UpdatePromptDocumentInput,
  ) => Effect.Effect<PromptDocumentState, PromptManagementError>;
}

export class PromptManagementService extends ServiceMap.Service<
  PromptManagementService,
  PromptManagementShape
>()("t3/prompts/Services/PromptManagementService") {}
