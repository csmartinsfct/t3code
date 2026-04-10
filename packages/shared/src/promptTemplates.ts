import type {
  CanonicalPromptVariableKey,
  OrchestrationPromptId,
  OrchestrationPromptOverrides,
  OrchestrationPromptOverridesPatch,
  PromptTemplateDocument,
  PromptTemplateValidationError,
  PromptTemplateVariableDefinition,
} from "@t3tools/contracts";
import {
  ORCHESTRATION_PROMPT_IDS,
  ORCHESTRATION_PROMPT_GROUP_ID,
  ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS,
  PROMPT_TEMPLATE_VERSION,
} from "@t3tools/contracts";

export const ORCHESTRATION_PROMPT_VARIABLE_REGISTRY = [
  {
    key: "ticketId",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Ticket ID",
    description: "Canonical ticket identifier such as T3CO-32.",
    aliases: ["ticketIdentifier"],
  },
  {
    key: "ticketTitle",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Ticket title",
    description: "Human-readable ticket title.",
    aliases: ["ticketName"],
  },
  {
    key: "ticketDescription",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Ticket description",
    description: "Resolved ticket description text.",
    aliases: [],
  },
  {
    key: "acceptanceCriteria",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Acceptance criteria",
    description: "Formatted acceptance criteria for the ticket.",
    aliases: [],
  },
  {
    key: "worktree",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Worktree",
    description: "Worktree or branch name associated with the ticket.",
    aliases: [],
  },
  {
    key: "projectTitle",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Project title",
    description: "Project title for the current ticket context.",
    aliases: [],
  },
  {
    key: "projectPath",
    promptIds: ORCHESTRATION_PROMPT_IDS,
    label: "Project path",
    description: "Workspace path for the current project.",
    aliases: [],
  },
  {
    key: "commitDiff",
    promptIds: ["review"],
    label: "Commit diff",
    description: "Diff or diff summary being reviewed.",
    aliases: ["diff"],
  },
  {
    key: "reviewIteration",
    promptIds: ["review"],
    label: "Review iteration",
    description: "Current review attempt number.",
    aliases: [],
  },
  {
    key: "reviewSummary",
    promptIds: ["reviewFeedback"],
    label: "Review summary",
    description: "High-level automated review summary.",
    aliases: [],
  },
  {
    key: "reviewComments",
    promptIds: ["reviewFeedback"],
    label: "Review comments",
    description: "Formatted automated review comments.",
    aliases: [],
  },
] as const satisfies ReadonlyArray<PromptTemplateVariableDefinition>;

export type PromptTemplateVariableMap = Partial<
  Record<CanonicalPromptVariableKey, string | null | undefined>
>;

type ValidationResult =
  | {
      readonly ok: true;
      readonly document: PromptTemplateDocument;
      readonly referencedVariables: ReadonlyArray<CanonicalPromptVariableKey>;
    }
  | {
      readonly ok: false;
      readonly errors: ReadonlyArray<PromptTemplateValidationError>;
    };

const VARIABLE_DEFINITION_BY_KEY = new Map(
  ORCHESTRATION_PROMPT_VARIABLE_REGISTRY.map((definition) => [definition.key, definition]),
);

const CANONICAL_VARIABLE_BY_REFERENCE = new Map<string, CanonicalPromptVariableKey>(
  ORCHESTRATION_PROMPT_VARIABLE_REGISTRY.flatMap((definition) => [
    [definition.key, definition.key],
    ...definition.aliases.map((alias) => [alias, definition.key] as const),
  ]),
);

type InterpolationToken = {
  readonly name: string;
  readonly raw: string;
};

export const ORCHESTRATION_PROMPT_DEFAULTS = ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS satisfies Record<
  OrchestrationPromptId,
  PromptTemplateDocument
>;

export function resolveOrchestrationPromptDocuments(input?: {
  readonly projectOverrides?: OrchestrationPromptOverrides | null | undefined;
  readonly globalPrompts?: Partial<Record<OrchestrationPromptId, PromptTemplateDocument>> | null;
  readonly shippedDefaults?: Readonly<Record<OrchestrationPromptId, PromptTemplateDocument>>;
}): Record<OrchestrationPromptId, PromptTemplateDocument> {
  return {
    ...(input?.shippedDefaults ?? ORCHESTRATION_PROMPT_DEFAULTS),
    ...(input?.globalPrompts ?? {}),
    ...(input?.projectOverrides ?? {}),
  };
}

export function applyOrchestrationPromptOverridePatch(input: {
  readonly current?: OrchestrationPromptOverrides | null | undefined;
  readonly patch?: OrchestrationPromptOverridesPatch | null | undefined;
}): OrchestrationPromptOverrides {
  const next: Partial<Record<OrchestrationPromptId, PromptTemplateDocument>> = {
    ...(input.current ?? {}),
  };

  for (const promptId of ORCHESTRATION_PROMPT_IDS) {
    const value = input.patch?.[promptId];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete next[promptId];
      continue;
    }
    next[promptId] = value;
  }

  return next;
}

export function hasOrchestrationPromptOverrides(
  overrides?: OrchestrationPromptOverrides | null | undefined,
): boolean {
  return ORCHESTRATION_PROMPT_IDS.some((promptId) => overrides?.[promptId] !== undefined);
}

export function listPromptTemplateVariables(
  promptId?: OrchestrationPromptId,
): ReadonlyArray<PromptTemplateVariableDefinition> {
  if (!promptId) {
    return ORCHESTRATION_PROMPT_VARIABLE_REGISTRY;
  }
  return ORCHESTRATION_PROMPT_VARIABLE_REGISTRY.filter((definition) =>
    (definition.promptIds as ReadonlyArray<OrchestrationPromptId>).includes(promptId),
  );
}

export function normalizePromptTemplateVariableReference(
  variableName: string,
): CanonicalPromptVariableKey | null {
  return CANONICAL_VARIABLE_BY_REFERENCE.get(variableName) ?? null;
}

export function validatePromptTemplateDocument(input: {
  readonly promptId: OrchestrationPromptId;
  readonly document: unknown;
}): ValidationResult {
  const errors: PromptTemplateValidationError[] = [];
  const normalizedBlocks: Array<PromptTemplateDocument["blocks"][number]> = [];
  const referencedVariables = new Set<CanonicalPromptVariableKey>();

  const pushError = (error: Omit<PromptTemplateValidationError, "promptGroupId" | "promptId">) => {
    errors.push({
      promptGroupId: ORCHESTRATION_PROMPT_GROUP_ID,
      promptId: input.promptId,
      ...error,
    });
  };

  if (!isRecord(input.document)) {
    pushError({
      code: "invalid_document",
      message: "Prompt document must be an object.",
      path: [],
      blockIndex: null,
      variable: null,
      token: null,
    });
    return { ok: false, errors };
  }

  if (input.document.version !== PROMPT_TEMPLATE_VERSION) {
    pushError({
      code: "invalid_version",
      message: `Prompt document version must be exactly ${PROMPT_TEMPLATE_VERSION}.`,
      path: ["version"],
      blockIndex: null,
      variable: null,
      token: null,
    });
  }

  if (!Array.isArray(input.document.blocks)) {
    pushError({
      code: "invalid_block",
      message: "Prompt document blocks must be an array.",
      path: ["blocks"],
      blockIndex: null,
      variable: null,
      token: null,
    });
  } else {
    input.document.blocks.forEach((block, blockIndex) => {
      const blockPath = ["blocks", String(blockIndex)];
      if (!isRecord(block)) {
        pushError({
          code: "invalid_block",
          message: "Prompt block must be an object with when and text fields.",
          path: blockPath,
          blockIndex,
          variable: null,
          token: null,
        });
        return;
      }

      if (!("when" in block)) {
        pushError({
          code: "invalid_block",
          message: "Prompt block is missing the when field.",
          path: [...blockPath, "when"],
          blockIndex,
          variable: null,
          token: null,
        });
      }

      if (typeof block.text !== "string") {
        pushError({
          code: "invalid_block",
          message: "Prompt block text must be a string.",
          path: [...blockPath, "text"],
          blockIndex,
          variable: null,
          token: null,
        });
        return;
      }

      const normalizedText = normalizeBlockText({
        promptId: input.promptId,
        text: block.text,
        blockIndex,
        pushError,
        referencedVariables,
      });

      const normalizedWhen = normalizeCondition({
        promptId: input.promptId,
        when: block.when,
        blockIndex,
        pushError,
        referencedVariables,
      });

      if (normalizedText && normalizedWhen !== undefined) {
        normalizedBlocks.push({
          when: normalizedWhen,
          text: normalizedText,
        });
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    document: {
      version: PROMPT_TEMPLATE_VERSION,
      blocks: normalizedBlocks,
    },
    referencedVariables: [...referencedVariables],
  };
}

export function renderPromptTemplate(
  document: PromptTemplateDocument,
  variables: PromptTemplateVariableMap,
): string {
  return document.blocks
    .filter((block) => shouldRenderBlock(block.when, variables))
    .map((block) =>
      block.text.replaceAll(/\$\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, variableName: string) => {
        const value = variables[variableName as CanonicalPromptVariableKey];
        return value ?? "";
      }),
    )
    .join("");
}

function normalizeBlockText(input: {
  readonly promptId: OrchestrationPromptId;
  readonly text: string;
  readonly blockIndex: number;
  readonly pushError: (
    error: Omit<PromptTemplateValidationError, "promptGroupId" | "promptId">,
  ) => void;
  readonly referencedVariables: Set<CanonicalPromptVariableKey>;
}): string | null {
  const parsedTokens = parseInterpolationTokens(input.text);
  if (!parsedTokens.ok) {
    for (const issue of parsedTokens.issues) {
      input.pushError({
        code: "malformed_interpolation_token",
        message: issue.message,
        path: ["blocks", String(input.blockIndex), "text"],
        blockIndex: input.blockIndex,
        variable: null,
        token: issue.token,
      });
    }
    return null;
  }

  for (const token of parsedTokens.tokens) {
    const normalizedVariable = normalizeVariableForPrompt({
      promptId: input.promptId,
      variable: token.name,
      blockIndex: input.blockIndex,
      path: ["blocks", String(input.blockIndex), "text"],
      token: token.raw,
      pushError: input.pushError,
    });
    if (!normalizedVariable) {
      return null;
    }
    input.referencedVariables.add(normalizedVariable);
  }

  return input.text.replaceAll(/\$\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, variableName: string) => {
    const normalizedVariable = normalizePromptTemplateVariableReference(variableName);
    return normalizedVariable ? `\${${normalizedVariable}}` : `\${${variableName}}`;
  });
}

function normalizeCondition(input: {
  readonly promptId: OrchestrationPromptId;
  readonly when: unknown;
  readonly blockIndex: number;
  readonly pushError: (
    error: Omit<PromptTemplateValidationError, "promptGroupId" | "promptId">,
  ) => void;
  readonly referencedVariables: Set<CanonicalPromptVariableKey>;
}): PromptTemplateDocument["blocks"][number]["when"] | undefined {
  if (input.when === null) {
    return null;
  }

  if (!isRecord(input.when)) {
    input.pushError({
      code: "invalid_condition",
      message: "Prompt block condition must be null or an exists condition.",
      path: ["blocks", String(input.blockIndex), "when"],
      blockIndex: input.blockIndex,
      variable: null,
      token: null,
    });
    return undefined;
  }

  if (input.when.type !== "exists" || typeof input.when.variable !== "string") {
    input.pushError({
      code: "invalid_condition",
      message: 'Prompt block condition must be { type: "exists", variable: <key> }.',
      path: ["blocks", String(input.blockIndex), "when"],
      blockIndex: input.blockIndex,
      variable: typeof input.when.variable === "string" ? input.when.variable : null,
      token: null,
    });
    return undefined;
  }

  const normalizedVariable = normalizeVariableForPrompt({
    promptId: input.promptId,
    variable: input.when.variable,
    blockIndex: input.blockIndex,
    path: ["blocks", String(input.blockIndex), "when", "variable"],
    token: null,
    pushError: input.pushError,
  });
  if (!normalizedVariable) {
    return undefined;
  }

  input.referencedVariables.add(normalizedVariable);
  return {
    type: "exists",
    variable: normalizedVariable,
  };
}

function normalizeVariableForPrompt(input: {
  readonly promptId: OrchestrationPromptId;
  readonly variable: string;
  readonly blockIndex: number;
  readonly path: string[];
  readonly token: string | null;
  readonly pushError: (
    error: Omit<PromptTemplateValidationError, "promptGroupId" | "promptId">,
  ) => void;
}): CanonicalPromptVariableKey | null {
  const normalizedVariable = normalizePromptTemplateVariableReference(input.variable);
  if (!normalizedVariable) {
    input.pushError({
      code: "unknown_variable",
      message: `Unknown prompt variable: ${input.variable}.`,
      path: input.path,
      blockIndex: input.blockIndex,
      variable: input.variable,
      token: input.token,
    });
    return null;
  }

  const definition = VARIABLE_DEFINITION_BY_KEY.get(normalizedVariable);
  if (
    !definition ||
    !(definition.promptIds as ReadonlyArray<OrchestrationPromptId>).includes(input.promptId)
  ) {
    input.pushError({
      code: "variable_not_allowed",
      message: `Prompt variable ${normalizedVariable} is not allowed for ${input.promptId}.`,
      path: input.path,
      blockIndex: input.blockIndex,
      variable: normalizedVariable,
      token: input.token,
    });
    return null;
  }

  return normalizedVariable;
}

function shouldRenderBlock(
  when: PromptTemplateDocument["blocks"][number]["when"],
  variables: PromptTemplateVariableMap,
): boolean {
  if (when === null) {
    return true;
  }
  const value = variables[when.variable];
  return typeof value === "string" ? value.length > 0 : value != null;
}

function parseInterpolationTokens(text: string):
  | { readonly ok: true; readonly tokens: ReadonlyArray<InterpolationToken> }
  | {
      readonly ok: false;
      readonly issues: ReadonlyArray<{ token: string | null; message: string }>;
    } {
  const tokens: InterpolationToken[] = [];
  const issues: Array<{ token: string | null; message: string }> = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "$" || text[index + 1] !== "{") {
      continue;
    }

    const endIndex = text.indexOf("}", index + 2);
    if (endIndex === -1) {
      issues.push({
        token: text.slice(index),
        message: "Interpolation token is missing a closing }.",
      });
      break;
    }

    const raw = text.slice(index, endIndex + 1);
    const name = text.slice(index + 2, endIndex);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
      issues.push({
        token: raw,
        message: `Interpolation token ${raw} is malformed.`,
      });
      index = endIndex;
      continue;
    }

    tokens.push({ raw, name });
    index = endIndex;
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, tokens };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
