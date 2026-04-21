import { Schema } from "effect";
import { OrchestrationRunId, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import {
  CanonicalPromptVariableKey as CanonicalPromptVariableKeySchema,
  PromptConditionType,
  PromptGroupId,
  PromptId as PromptIdSchema,
  PromptDocumentV1,
  PromptTemplateValidationError,
  PromptTemplateVariableDefinition,
  PromptTemplateVersion,
} from "./promptTemplates";

export const PromptManagementScopeKind = Schema.Literals([
  "global",
  "project",
  "orchestration-run",
]);
export type PromptManagementScopeKind = typeof PromptManagementScopeKind.Type;

export const PromptManagementScope = Schema.Struct({
  scope: PromptManagementScopeKind,
  projectId: Schema.optionalKey(ProjectId),
  orchestrationRunId: Schema.optionalKey(OrchestrationRunId),
});
export type PromptManagementScope = typeof PromptManagementScope.Type;

export const PromptGroupDefinition = Schema.Struct({
  groupId: PromptGroupId,
  label: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});
export type PromptGroupDefinition = typeof PromptGroupDefinition.Type;

export const PromptDefinitionConstraints = Schema.Struct({
  documentVersion: PromptTemplateVersion,
  supportedConditionTypes: Schema.Array(PromptConditionType),
  interpolationSyntax: Schema.Literal("${variable}"),
  orderedBlocksMatter: Schema.Boolean,
  supportsGlobalScope: Schema.Boolean,
  supportsProjectScope: Schema.Boolean,
});
export type PromptDefinitionConstraints = typeof PromptDefinitionConstraints.Type;

export const PromptDefinition = Schema.Struct({
  groupId: PromptGroupId,
  promptId: PromptIdSchema,
  label: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  supportedVariables: Schema.Array(PromptTemplateVariableDefinition),
  constraints: PromptDefinitionConstraints,
});
export type PromptDefinition = typeof PromptDefinition.Type;

export const PromptDocumentSource = Schema.Literals([
  "shipped_default",
  "global",
  "project_override",
  "run_override",
]);
export type PromptDocumentSource = typeof PromptDocumentSource.Type;

export const PromptDocumentScopeState = Schema.Literals([
  "default",
  "customized",
  "inherited",
  "overridden",
]);
export type PromptDocumentScopeState = typeof PromptDocumentScopeState.Type;

export const PromptDocumentState = Schema.Struct({
  scope: PromptManagementScope,
  definition: PromptDefinition,
  shippedDefaultDocument: PromptDocumentV1,
  globalDocument: PromptDocumentV1,
  projectOverrideDocument: Schema.NullOr(PromptDocumentV1),
  runOverrideDocument: Schema.NullOr(PromptDocumentV1).pipe(Schema.withDecodingDefault(() => null)),
  effectiveDocument: PromptDocumentV1,
  effectiveSource: PromptDocumentSource,
  scopeState: PromptDocumentScopeState,
});
export type PromptDocumentState = typeof PromptDocumentState.Type;

export const ListPromptDefinitionsInput = PromptManagementScope;
export type ListPromptDefinitionsInput = typeof ListPromptDefinitionsInput.Type;

export const ListPromptDefinitionsResult = Schema.Struct({
  scope: PromptManagementScope,
  groups: Schema.Array(PromptGroupDefinition),
  definitions: Schema.Array(PromptDefinition),
});
export type ListPromptDefinitionsResult = typeof ListPromptDefinitionsResult.Type;

export const PromptDocumentQueryInput = Schema.Struct({
  scope: PromptManagementScopeKind,
  projectId: Schema.optionalKey(ProjectId),
  orchestrationRunId: Schema.optionalKey(OrchestrationRunId),
  promptId: PromptIdSchema,
});
export type PromptDocumentQueryInput = typeof PromptDocumentQueryInput.Type;

export const PromptDocumentValidationResult = Schema.Struct({
  scope: PromptManagementScope,
  promptId: PromptIdSchema,
  ok: Schema.Boolean,
  document: Schema.NullOr(PromptDocumentV1),
  referencedVariables: Schema.Array(CanonicalPromptVariableKeySchema),
  errors: Schema.Array(PromptTemplateValidationError),
});
export type PromptDocumentValidationResult = typeof PromptDocumentValidationResult.Type;

export const ValidatePromptDocumentInput = Schema.Struct({
  scope: PromptManagementScopeKind,
  projectId: Schema.optionalKey(ProjectId),
  orchestrationRunId: Schema.optionalKey(OrchestrationRunId),
  promptId: PromptIdSchema,
  document: Schema.Unknown,
});
export type ValidatePromptDocumentInput = typeof ValidatePromptDocumentInput.Type;

export const PromptPreviewVariable = Schema.Struct({
  key: CanonicalPromptVariableKeySchema,
  value: Schema.String,
});
export type PromptPreviewVariable = typeof PromptPreviewVariable.Type;

export const PreviewPromptDocumentInput = Schema.Struct({
  scope: PromptManagementScopeKind,
  projectId: Schema.optionalKey(ProjectId),
  orchestrationRunId: Schema.optionalKey(OrchestrationRunId),
  promptId: PromptIdSchema,
  document: Schema.optionalKey(Schema.Unknown),
});
export type PreviewPromptDocumentInput = typeof PreviewPromptDocumentInput.Type;

export const PreviewPromptDocumentResult = Schema.Struct({
  scope: PromptManagementScope,
  promptId: PromptIdSchema,
  definition: PromptDefinition,
  document: PromptDocumentV1,
  previewText: Schema.String,
  previewDataLabel: TrimmedNonEmptyString,
  previewVariables: Schema.Array(PromptPreviewVariable),
});
export type PreviewPromptDocumentResult = typeof PreviewPromptDocumentResult.Type;

export const UpdatePromptDocumentInput = Schema.Struct({
  scope: PromptManagementScopeKind,
  projectId: Schema.optionalKey(ProjectId),
  orchestrationRunId: Schema.optionalKey(OrchestrationRunId),
  promptId: PromptIdSchema,
  document: Schema.NullOr(Schema.Unknown),
});
export type UpdatePromptDocumentInput = typeof UpdatePromptDocumentInput.Type;

export const PromptManagementErrorCode = Schema.Literals([
  "invalid_scope",
  "project_not_found",
  "scope_not_authorized",
  "validation_failed",
  "operation_failed",
]);
export type PromptManagementErrorCode = typeof PromptManagementErrorCode.Type;

export class PromptManagementError extends Schema.TaggedErrorClass<PromptManagementError>()(
  "PromptManagementError",
  {
    code: PromptManagementErrorCode,
    message: TrimmedNonEmptyString,
    validationErrors: Schema.optional(Schema.Array(PromptTemplateValidationError)),
    cause: Schema.optional(Schema.Defect),
  },
) {}
