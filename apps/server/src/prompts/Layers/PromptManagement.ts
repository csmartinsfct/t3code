import {
  CommandId,
  type CanonicalPromptVariableKey,
  type ListPromptDefinitionsInput,
  type ListPromptDefinitionsResult,
  ORCHESTRATION_PROMPT_GROUP_ID,
  ORCHESTRATION_PROMPT_IDS,
  type OrchestrationPromptId,
  type PreviewPromptDocumentInput,
  type PreviewPromptDocumentResult,
  type PromptDefinition,
  type PromptDocumentQueryInput,
  type PromptDocumentState,
  PromptManagementError,
  type PromptManagementScope,
  type PromptPreviewVariable,
  type PromptTemplateValidationError,
  type UpdatePromptDocumentInput,
  type ValidatePromptDocumentInput,
} from "@t3tools/contracts";
import {
  listPromptTemplateVariables,
  renderPromptTemplate,
  validatePromptTemplateDocument,
} from "@t3tools/shared/promptTemplates";
import { Effect, Equal, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  PromptManagementService,
  type PromptManagementShape,
} from "../Services/PromptManagement.ts";

const ORCHESTRATION_GROUP_DEFINITION = {
  groupId: ORCHESTRATION_PROMPT_GROUP_ID,
  label: "Orchestration",
  description: "Templates used when the orchestration runner dispatches automated ticket work.",
} as const satisfies ListPromptDefinitionsResult["groups"][number];

const PROMPT_DEFINITION_CONSTRAINTS = {
  documentVersion: 1,
  supportedConditionTypes: ["exists"],
  interpolationSyntax: "${variable}",
  orderedBlocksMatter: true,
  supportsGlobalScope: true,
  supportsProjectScope: true,
} as const satisfies PromptDefinition["constraints"];

const ORCHESTRATION_PROMPT_METADATA = {
  implement: {
    label: "Implement",
    description: "Used when orchestration dispatches a ticket implementation turn.",
  },
  resume: {
    label: "Resume",
    description: "Used when orchestration resumes an in-flight working thread.",
  },
  resumeFreshAgent: {
    label: "Resume Fresh Agent",
    description: "Used when orchestration resumes a working ticket with a fresh agent session.",
  },
  review: {
    label: "Review",
    description: "Used when orchestration requests structured automated review output.",
  },
  reReview: {
    label: "Re-Review",
    description:
      "Used when orchestration requests structured follow-up review output after earlier findings.",
  },
  reviewFeedback: {
    label: "Review Feedback",
    description: "Used when orchestration asks an agent to address review findings.",
  },
} as const satisfies Record<OrchestrationPromptId, Pick<PromptDefinition, "label" | "description">>;

const PREVIEW_DATA_LABEL = "representative-sample-v1";

const REPRESENTATIVE_PREVIEW_VALUES = {
  ticketId: "T3CO-36",
  ticketTitle: "Prompt metadata, validation, preview, and explicit management APIs",
  ticketDescription:
    "Expose a backend-owned prompt-management surface for UI editing and MCP workflows.",
  acceptanceCriteria:
    "- backend/native APIs\n- prompt-management MCP service\n- backend-owned validation and preview",
  worktree: "prompt-management-preview",
  projectTitle: "T3 Code",
  projectPath: "/Users/example/dev/t3-code",
  commitDiff: [
    "diff --git a/apps/server/src/prompts/http.ts b/apps/server/src/prompts/http.ts",
    '+server.registerTool("preview_prompt_document", ...)',
    '+server.registerTool("update_prompt_document", ...)',
  ].join("\n"),
  reviewIteration: "2",
  reviewSummary: "Preview and validation are wired through the backend-owned prompt service.",
  reviewComments: [
    "apps/server/src/prompts/http.ts: Enforce explicit project scope validation.",
    "apps/server/src/prompts/Layers/PromptManagement.ts: Keep preview data deterministic.",
  ].join("\n"),
} as const satisfies Record<CanonicalPromptVariableKey, string>;

function promptDefinition(promptId: OrchestrationPromptId): PromptDefinition {
  return {
    groupId: ORCHESTRATION_PROMPT_GROUP_ID,
    promptId,
    label: ORCHESTRATION_PROMPT_METADATA[promptId].label,
    description: ORCHESTRATION_PROMPT_METADATA[promptId].description,
    supportedVariables: [...listPromptTemplateVariables(promptId)],
    constraints: PROMPT_DEFINITION_CONSTRAINTS,
  };
}

function invalidScopeError(message: string) {
  return Effect.fail(
    new PromptManagementError({
      code: "invalid_scope",
      message,
    }),
  );
}

function projectNotFoundError(message: string, cause?: unknown) {
  return Effect.fail(
    new PromptManagementError({
      code: "project_not_found",
      message,
      ...(cause !== undefined ? { cause } : {}),
    }),
  );
}

function validationFailedError(errors: ReadonlyArray<PromptTemplateValidationError>) {
  return Effect.fail(
    new PromptManagementError({
      code: "validation_failed",
      message: "Prompt document validation failed.",
      validationErrors: [...errors],
    }),
  );
}

function settingsReadError(message: string, cause?: unknown) {
  return new PromptManagementError({
    code: "operation_failed",
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function operationFailedError(message: string, cause?: unknown) {
  return new PromptManagementError({
    code: "operation_failed",
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function toPreviewVariables(
  variableKeys: ReadonlyArray<CanonicalPromptVariableKey>,
): ReadonlyArray<PromptPreviewVariable> {
  return variableKeys.map((key) => ({
    key,
    value: REPRESENTATIVE_PREVIEW_VALUES[key],
  }));
}

type ProjectPromptManagementScope = {
  readonly scope: "project";
  readonly projectId: NonNullable<PromptManagementScope["projectId"]>;
};

export const PromptManagementLive = Layer.effect(
  PromptManagementService,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const startup = yield* ServerRuntimeStartup;

    const normalizeScope = (
      input:
        | ListPromptDefinitionsInput
        | PromptDocumentQueryInput
        | PreviewPromptDocumentInput
        | UpdatePromptDocumentInput
        | ValidatePromptDocumentInput,
    ) =>
      Effect.gen(function* () {
        if (input.scope === "global") {
          if (input.projectId !== undefined) {
            return yield* invalidScopeError(
              "Global prompt operations must not include a projectId.",
            );
          }
          return { scope: "global" } as const satisfies PromptManagementScope;
        }

        if (!input.projectId) {
          return yield* invalidScopeError(
            "Project-scoped prompt operations must include a projectId.",
          );
        }

        return {
          scope: "project",
          projectId: input.projectId,
        } as const satisfies PromptManagementScope;
      });

    const getProjectForScope = (scope: PromptManagementScope) =>
      Effect.gen(function* () {
        if (scope.scope === "global") {
          return null;
        }

        const snapshot = yield* projectionSnapshotQuery
          .getSnapshot()
          .pipe(
            Effect.mapError((cause) =>
              settingsReadError(`Failed to load project ${scope.projectId}.`, cause),
            ),
          );
        const project = snapshot.projects.find(
          (candidate) => candidate.id === scope.projectId && candidate.deletedAt === null,
        );
        if (!project) {
          return yield* projectNotFoundError(`Project ${scope.projectId} was not found.`);
        }
        return project;
      });

    const getDocumentState = (scope: PromptManagementScope, promptId: OrchestrationPromptId) =>
      Effect.gen(function* () {
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError((cause) =>
            settingsReadError(`Failed to read prompt settings: ${cause.message}`, cause),
          ),
        );
        const project = yield* getProjectForScope(scope);

        const shippedDefaultDocument = settings.promptDefaults.orchestration[promptId];
        const globalDocument = settings.prompts.orchestration[promptId];
        const projectOverrideDocument = project?.promptOverrides.orchestration[promptId] ?? null;
        const effectiveDocument = projectOverrideDocument ?? globalDocument;
        const effectiveSource =
          projectOverrideDocument !== null
            ? "project_override"
            : Equal.equals(globalDocument, shippedDefaultDocument)
              ? "shipped_default"
              : "global";
        const scopeState =
          scope.scope === "project"
            ? projectOverrideDocument !== null
              ? "overridden"
              : "inherited"
            : Equal.equals(globalDocument, shippedDefaultDocument)
              ? "default"
              : "customized";

        return {
          scope,
          definition: promptDefinition(promptId),
          shippedDefaultDocument,
          globalDocument,
          projectOverrideDocument,
          effectiveDocument,
          effectiveSource,
          scopeState,
        } as const satisfies PromptDocumentState;
      });

    const validateDocument = (
      scope: PromptManagementScope,
      promptId: OrchestrationPromptId,
      document: unknown,
    ) => {
      const validation = validatePromptTemplateDocument({ promptId, document });
      if (!validation.ok) {
        return {
          scope,
          promptId,
          ok: false,
          document: null,
          referencedVariables: [],
          errors: [...validation.errors],
        } as const;
      }

      return {
        scope,
        promptId,
        ok: true,
        document: validation.document,
        referencedVariables: [...validation.referencedVariables],
        errors: [],
      } as const;
    };

    const updateGlobalPromptDocument = (
      promptId: OrchestrationPromptId,
      document: PromptDocumentState["effectiveDocument"] | null,
    ) =>
      serverSettings
        .updateSettings({
          prompts: {
            orchestration: {
              [promptId]: document,
            },
          },
        })
        .pipe(
          Effect.mapError((cause) =>
            operationFailedError("Failed to update global prompt settings.", cause),
          ),
        );

    const updateProjectPromptDocument = (
      scope: ProjectPromptManagementScope,
      promptId: OrchestrationPromptId,
      document: PromptDocumentState["effectiveDocument"] | null,
    ) =>
      Effect.gen(function* () {
        const command = {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe(`cmd-prompt-${crypto.randomUUID()}`),
          projectId: scope.projectId,
          promptOverrides: {
            orchestration: {
              [promptId]: document,
            },
          },
        } as const;

        yield* startup
          .enqueueCommand(orchestrationEngine.dispatch(command))
          .pipe(
            Effect.mapError((cause) =>
              operationFailedError("Failed to persist project prompt override.", cause),
            ),
          );
      });

    const service: PromptManagementShape = {
      listPromptDefinitions: (input) =>
        Effect.gen(function* () {
          const scope = yield* normalizeScope(input);
          yield* getProjectForScope(scope);

          return {
            scope,
            groups: [ORCHESTRATION_GROUP_DEFINITION],
            definitions: ORCHESTRATION_PROMPT_IDS.map((promptId) => promptDefinition(promptId)),
          } satisfies ListPromptDefinitionsResult;
        }),

      getPromptDocument: (input) =>
        Effect.gen(function* () {
          const scope = yield* normalizeScope(input);
          return yield* getDocumentState(scope, input.promptId);
        }),

      validatePromptDocument: (input) =>
        Effect.gen(function* () {
          const scope = yield* normalizeScope(input);
          yield* getProjectForScope(scope);
          return validateDocument(scope, input.promptId, input.document);
        }),

      previewPromptDocument: (input) =>
        Effect.gen(function* () {
          const scope = yield* normalizeScope(input);
          const state = yield* getDocumentState(scope, input.promptId);
          const validation = validateDocument(
            scope,
            input.promptId,
            input.document === undefined ? state.effectiveDocument : input.document,
          );
          if (!validation.ok || validation.document === null) {
            return yield* validationFailedError(validation.errors);
          }

          return {
            scope,
            promptId: input.promptId,
            definition: state.definition,
            document: validation.document,
            previewText: renderPromptTemplate(validation.document, REPRESENTATIVE_PREVIEW_VALUES),
            previewDataLabel: PREVIEW_DATA_LABEL,
            previewVariables: toPreviewVariables(validation.referencedVariables),
          } satisfies PreviewPromptDocumentResult;
        }),

      updatePromptDocument: (input) =>
        Effect.gen(function* () {
          const scope = yield* normalizeScope(input);
          yield* getProjectForScope(scope);

          if (input.document !== null) {
            const validation = validateDocument(scope, input.promptId, input.document);
            if (!validation.ok || validation.document === null) {
              return yield* validationFailedError(validation.errors);
            }

            if (scope.scope === "global") {
              yield* updateGlobalPromptDocument(input.promptId, validation.document);
            } else {
              yield* updateProjectPromptDocument(
                { scope: "project", projectId: scope.projectId },
                input.promptId,
                validation.document,
              );
            }

            return yield* getDocumentState(scope, input.promptId);
          }

          if (scope.scope === "global") {
            yield* updateGlobalPromptDocument(input.promptId, null);
          } else {
            yield* updateProjectPromptDocument(
              { scope: "project", projectId: scope.projectId },
              input.promptId,
              null,
            );
          }

          return yield* getDocumentState(scope, input.promptId);
        }),
    };

    return service;
  }),
);
