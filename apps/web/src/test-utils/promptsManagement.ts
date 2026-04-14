import type {
  ListPromptDefinitionsResult,
  PromptId,
  PromptDocumentScopeState,
  PromptDocumentSource,
  PromptDocumentState,
  PromptManagementScope,
  PromptTemplateBlock,
  PromptTemplateVariableDefinition,
  ProjectId,
} from "@t3tools/contracts";

import type { Project } from "../types";

export const PROMPTS_PROJECT_ID = "project-prompts-browser" as ProjectId;
export const PROMPTS_NOW_ISO = "2026-04-11T12:00:00.000Z";

export const PROMPTS_SUPPORTED_VARIABLES: readonly PromptTemplateVariableDefinition[] = [
  {
    key: "ticketId",
    promptIds: ["implement", "review"],
    label: "Ticket ID",
    description: "Identifier of the ticket being worked on.",
    aliases: [],
  },
  {
    key: "worktree",
    promptIds: ["implement", "review"],
    label: "Worktree",
    description: "Path to the worktree for the task.",
    aliases: [],
  },
];

export function createPromptsProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROMPTS_PROJECT_ID,
    name: "Project Alpha",
    cwd: "/repo/project-alpha",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    systemPrompt: null,
    promptOverrides: { orchestration: {} },
    scripts: [],
    createdAt: PROMPTS_NOW_ISO,
    updatedAt: PROMPTS_NOW_ISO,
    ...overrides,
  };
}

export function createPromptDefinitions(
  scope: PromptManagementScope = { scope: "global" },
): ListPromptDefinitionsResult {
  return {
    scope,
    groups: [
      {
        groupId: "orchestration",
        label: "Orchestration",
        description: "Prompts used by ticket orchestration flows.",
      },
    ],
    definitions: [
      {
        groupId: "orchestration",
        promptId: "implement",
        label: "Implement",
        description: "Used when an implementer starts a ticket.",
        supportedVariables: [...PROMPTS_SUPPORTED_VARIABLES],
        constraints: {
          documentVersion: 1,
          supportedConditionTypes: ["exists"],
          interpolationSyntax: "${variable}",
          orderedBlocksMatter: true,
          supportsGlobalScope: true,
          supportsProjectScope: true,
        },
      },
      {
        groupId: "orchestration",
        promptId: "review",
        label: "Review",
        description: "Used when a reviewer evaluates a ticket diff.",
        supportedVariables: [...PROMPTS_SUPPORTED_VARIABLES],
        constraints: {
          documentVersion: 1,
          supportedConditionTypes: ["exists"],
          interpolationSyntax: "${variable}",
          orderedBlocksMatter: true,
          supportsGlobalScope: true,
          supportsProjectScope: true,
        },
      },
    ],
  };
}

export function createPromptDocumentState(input: {
  promptId: PromptId;
  scope: PromptManagementScope;
  scopeState: PromptDocumentScopeState;
  effectiveSource?: PromptDocumentSource;
  shippedBlocks?: readonly PromptTemplateBlock[];
  globalBlocks?: readonly PromptTemplateBlock[];
  projectBlocks?: readonly PromptTemplateBlock[] | null;
  effectiveBlocks?: readonly PromptTemplateBlock[];
}): PromptDocumentState {
  const definition = createPromptDefinitions(input.scope).definitions.find(
    (candidate) => candidate.promptId === input.promptId,
  );
  if (!definition) {
    throw new Error(`Unknown prompt definition ${input.promptId}`);
  }

  const shippedBlocks = input.shippedBlocks ?? [
    { when: null, text: "Work on ticket ${ticketId}." },
    { when: { type: "exists", variable: "worktree" }, text: "Worktree: ${worktree}." },
  ];
  const globalBlocks = input.globalBlocks ?? shippedBlocks;
  const projectBlocks = input.projectBlocks ?? null;

  return {
    scope: input.scope,
    definition,
    shippedDefaultDocument: {
      version: 1,
      blocks: [...shippedBlocks],
    },
    globalDocument: {
      version: 1,
      blocks: [...globalBlocks],
    },
    projectOverrideDocument:
      projectBlocks === null
        ? null
        : {
            version: 1,
            blocks: [...projectBlocks],
          },
    effectiveDocument: {
      version: 1,
      blocks: [...(input.effectiveBlocks ?? projectBlocks ?? globalBlocks)],
    },
    runOverrideDocument: null,
    effectiveSource:
      input.effectiveSource ?? (input.scope.scope === "project" ? "project_override" : "global"),
    scopeState: input.scopeState,
  };
}
