import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ORCHESTRATION_PROMPT_GROUP_ID = "orchestration" as const;
export const OrchestrationPromptGroupId = Schema.Literal(ORCHESTRATION_PROMPT_GROUP_ID);
export type OrchestrationPromptGroupId = typeof OrchestrationPromptGroupId.Type;

export const ORCHESTRATION_PROMPT_IDS = [
  "implement",
  "resume",
  "review",
  "reviewFeedback",
] as const;
export type OrchestrationPromptId = (typeof ORCHESTRATION_PROMPT_IDS)[number];
export const OrchestrationPromptId = Schema.Literals(ORCHESTRATION_PROMPT_IDS);

export const PROMPT_TEMPLATE_VERSION = 1 as const;
export const PromptTemplateVersion = Schema.Literal(PROMPT_TEMPLATE_VERSION);
export type PromptTemplateVersion = typeof PromptTemplateVersion.Type;

export const CANONICAL_PROMPT_VARIABLE_KEYS = [
  "ticketId",
  "ticketTitle",
  "ticketDescription",
  "acceptanceCriteria",
  "worktree",
  "projectTitle",
  "projectPath",
  "commitDiff",
  "reviewIteration",
  "reviewSummary",
  "reviewComments",
  "reviewSuggestions",
] as const;
export type CanonicalPromptVariableKey = (typeof CANONICAL_PROMPT_VARIABLE_KEYS)[number];
export const CanonicalPromptVariableKey = Schema.Literals(CANONICAL_PROMPT_VARIABLE_KEYS);

export const PromptTemplateCondition = Schema.Struct({
  type: Schema.Literal("exists"),
  variable: CanonicalPromptVariableKey,
});
export type PromptTemplateCondition = typeof PromptTemplateCondition.Type;

export const PromptTemplateBlock = Schema.Struct({
  when: Schema.NullOr(PromptTemplateCondition),
  text: Schema.String,
});
export type PromptTemplateBlock = typeof PromptTemplateBlock.Type;

export const PromptTemplateDocument = Schema.Struct({
  version: PromptTemplateVersion,
  blocks: Schema.Array(PromptTemplateBlock),
});
export type PromptTemplateDocument = typeof PromptTemplateDocument.Type;

export const PromptTemplateVariableDefinition = Schema.Struct({
  key: CanonicalPromptVariableKey,
  promptIds: Schema.Array(OrchestrationPromptId),
  label: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  aliases: Schema.Array(TrimmedNonEmptyString),
});
export type PromptTemplateVariableDefinition = typeof PromptTemplateVariableDefinition.Type;

export const PROMPT_TEMPLATE_VALIDATION_ERROR_CODES = [
  "invalid_document",
  "invalid_version",
  "invalid_block",
  "invalid_condition",
  "malformed_interpolation_token",
  "unknown_variable",
  "variable_not_allowed",
] as const;
export type PromptTemplateValidationErrorCode =
  (typeof PROMPT_TEMPLATE_VALIDATION_ERROR_CODES)[number];
export const PromptTemplateValidationErrorCode = Schema.Literals(
  PROMPT_TEMPLATE_VALIDATION_ERROR_CODES,
);

export const PromptTemplateValidationError = Schema.Struct({
  code: PromptTemplateValidationErrorCode,
  promptGroupId: OrchestrationPromptGroupId,
  promptId: OrchestrationPromptId,
  message: TrimmedNonEmptyString,
  path: Schema.Array(Schema.String),
  blockIndex: Schema.NullOr(NonNegativeInt),
  variable: Schema.NullOr(Schema.String),
  token: Schema.NullOr(Schema.String),
});
export type PromptTemplateValidationError = typeof PromptTemplateValidationError.Type;
