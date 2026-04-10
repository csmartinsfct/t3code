import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ORCHESTRATION_PROMPT_GROUP_ID = "orchestration" as const;
export const OrchestrationPromptGroupId = Schema.Literal(ORCHESTRATION_PROMPT_GROUP_ID);
export type OrchestrationPromptGroupId = typeof OrchestrationPromptGroupId.Type;

export const ORCHESTRATION_PROMPT_IDS = [
  "implement",
  "resume",
  "resumeFreshAgent",
  "review",
  "reviewFeedback",
] as const;
export type OrchestrationPromptId = (typeof ORCHESTRATION_PROMPT_IDS)[number];
export const OrchestrationPromptId = Schema.Literals(ORCHESTRATION_PROMPT_IDS);

export const OrchestrationPromptOverrides = Schema.Struct({
  implement: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  resume: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  resumeFreshAgent: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  review: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  reviewFeedback: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type OrchestrationPromptOverrides = typeof OrchestrationPromptOverrides.Type;

export const OrchestrationPromptOverridesPatch = Schema.Struct({
  implement: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  resume: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  resumeFreshAgent: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  review: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  reviewFeedback: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type OrchestrationPromptOverridesPatch = typeof OrchestrationPromptOverridesPatch.Type;

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
export const PromptDocumentV1 = PromptTemplateDocument;
export type PromptDocumentV1 = typeof PromptDocumentV1.Type;

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

export const ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS = {
  implement: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Work on ticket ${ticketTitle} - ${ticketId}.",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: " Worktree: ${worktree}.",
      },
      {
        when: null,
        text: " Pull the ticket details and any other context you need yourself. If you get blocked, update the ticket status to blocked and stop. Try to complete the acceptance criteria mentioned in the ticket, if defined. Otherwise try to comply with the specifications in the ticket.",
      },
    ],
  },
  resume: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Continue.",
      },
    ],
  },
  resumeFreshAgent: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Work on ticket ${ticketTitle} - ${ticketId}. You are taking over this ticket with a fresh agent session, and prior work may already exist in the workspace or thread history.",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: " Worktree: ${worktree}.",
      },
      {
        when: null,
        text: " First inspect the current workspace state and determine what remains. Do not overwrite unrelated changes or assume the earlier agent finished correctly. Pull the ticket details and any other context you need yourself. If you get blocked, update the ticket status to blocked and stop. Try to complete the acceptance criteria mentioned in the ticket, if defined. Otherwise try to comply with the specifications in the ticket.",
      },
    ],
  },
  review: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "You are reviewing completed work for a ticket in an automated orchestration workflow. Evaluate the implementation against the ticket requirements and the provided diff. Return valid JSON only. Do not include markdown fences, commentary, or any text outside the JSON object.\n\nReview the completed work for ticket ${ticketId}: ${ticketTitle}.",
      },
      {
        when: { type: "exists", variable: "ticketDescription" },
        text: "\n\nTicket description:\n${ticketDescription}",
      },
      {
        when: { type: "exists", variable: "acceptanceCriteria" },
        text: "\n\nAcceptance criteria:\n${acceptanceCriteria}",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: "\n\nWorktree:\n${worktree}",
      },
      {
        when: null,
        text: '\n\nDiff:\n${commitDiff}\n\nReview iteration: ${reviewIteration}\n\nReturn a JSON object matching this shape exactly:\n{\n  "changesNeeded": boolean,\n  "summary": string,\n  "comments": [\n    {\n      "file": string | null,\n      "line": number | null,\n      "severity": "critical" | "suggestion" | "nit",\n      "body": string\n    }\n  ]\n}\n\nIf the ticket worktree is not null, treat it as part of the task context while reviewing. Set changesNeeded to true if the work should not yet be accepted. Set it to false only if the ticket is ready to be accepted as complete. Return JSON only.',
      },
    ],
  },
  reviewFeedback: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Address the automated review feedback for ticket ${ticketId}.\n\nReview summary: ${reviewSummary}",
      },
      {
        when: { type: "exists", variable: "reviewComments" },
        text: "\n\nReview comments:\n${reviewComments}",
      },
      {
        when: null,
        text: "\n\nApply the needed fixes, then continue until the ticket is ready for review again.",
      },
    ],
  },
} as const satisfies Record<OrchestrationPromptId, PromptDocumentV1>;
