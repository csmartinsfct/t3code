import {
  baseProviderKind,
  DEFAULT_MODEL_BY_PROVIDER,
  modelSelectionProviderKind,
  providerProfileId,
  type ModelSelection,
  type ProviderKind,
  type ProviderRateLimitsSnapshot,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

export interface ReviewPromptTemplateInput {
  readonly ticketIdentifier: string;
  readonly ticketTitle: string;
  readonly ticketDescription: string;
  readonly acceptanceCriteria: string;
  readonly diffSummaryOrPatch: string;
  readonly iteration: number;
  readonly ticketWorktree: string | null;
}

export const REVIEW_SYSTEM_PROMPT =
  "You are reviewing completed work for a ticket in an automated orchestration workflow. Evaluate the implementation against the ticket requirements and the provided diff. Return valid JSON only. Do not include markdown fences, commentary, or any text outside the JSON object.";

function tryParseJson(text: string): { readonly ok: true; readonly value: unknown } | null {
  try {
    return {
      ok: true,
      value: JSON.parse(text),
    };
  } catch {
    return null;
  }
}

function extractBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (character === "\\") {
        isEscaped = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        return text.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

export function parseReviewOutputJson(text: string): unknown {
  const trimmedText = text.trim();
  const directJson = tryParseJson(trimmedText);
  if (directJson) {
    return directJson.value;
  }

  const fencedJsonBlocks = [...trimmedText.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const match of fencedJsonBlocks) {
    const candidate = match[1]?.trim();
    if (!candidate) {
      continue;
    }
    const parsedCandidate = tryParseJson(candidate);
    if (parsedCandidate) {
      return parsedCandidate.value;
    }
  }

  const embeddedObject = extractBalancedJsonObject(trimmedText);
  if (embeddedObject) {
    const parsedObject = tryParseJson(embeddedObject);
    if (parsedObject) {
      return parsedObject.value;
    }
  }

  throw new SyntaxError("Review output did not contain valid JSON");
}

export function buildReviewUserPrompt(input: ReviewPromptTemplateInput): string {
  return `Review the completed work for ticket ${input.ticketIdentifier}: ${input.ticketTitle}.

Ticket description:
${input.ticketDescription}

Acceptance criteria:
${input.acceptanceCriteria}

Worktree:
${input.ticketWorktree ?? "null"}

Diff:
${input.diffSummaryOrPatch}

Review iteration: ${input.iteration}

Return a JSON object matching this shape exactly:
{
  "changesNeeded": boolean,
  "summary": string,
  "comments": [
    {
      "file": string | null,
      "line": number | null,
      "severity": "critical" | "suggestion" | "nit",
      "body": string
    }
  ],
  "suggestions": string[]
}

If the ticket worktree is not null, treat it as part of the task context while reviewing. Set changesNeeded to true if the work should not yet be accepted. Set it to false only if the ticket is ready to be accepted as complete. Return JSON only.`;
}

export function buildReviewPrompt(input: ReviewPromptTemplateInput): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  return {
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    userPrompt: buildReviewUserPrompt(input),
  };
}

export interface SelectReviewModelInput {
  readonly availableProviders: ReadonlyArray<ServerProvider>;
  readonly rateLimits: ReadonlyArray<ProviderRateLimitsSnapshot>;
  readonly implementationModelSelection: ModelSelection;
}

function isReviewCapableModel(model: ServerProviderModel): boolean {
  const capabilities = model.capabilities;
  if (!capabilities) {
    return false;
  }
  return capabilities.supportsPlan || capabilities.reasoningEffortLevels.length > 0;
}

function pickReviewModel(provider: ServerProvider): string {
  return (
    provider.models.find(isReviewCapableModel)?.slug ??
    provider.models.find((model) => !model.isCustom)?.slug ??
    provider.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[baseProviderKind(provider.provider)]
  );
}

function getFiveHourUtilization(
  rateLimits: ReadonlyArray<ProviderRateLimitsSnapshot>,
  provider: ProviderKind,
): number {
  const snapshot = rateLimits.find((entry) => entry.provider === provider);
  const fiveHourTier = snapshot?.oauthUsageTiers?.find((tier) => tier.tier === "five_hour");
  return typeof fiveHourTier?.utilization === "number"
    ? fiveHourTier.utilization
    : Number.POSITIVE_INFINITY;
}

function pickLowestUtilizationClaudeProfile(
  providers: ReadonlyArray<ServerProvider>,
  rateLimits: ReadonlyArray<ProviderRateLimitsSnapshot>,
): ServerProvider | undefined {
  let best: ServerProvider | undefined;
  for (const provider of providers) {
    if (!best) {
      best = provider;
      continue;
    }

    const utilizationDelta =
      getFiveHourUtilization(rateLimits, provider.provider) -
      getFiveHourUtilization(rateLimits, best.provider);
    if (utilizationDelta < 0) {
      best = provider;
      continue;
    }

    if (utilizationDelta === 0 && provider.provider.localeCompare(best.provider) < 0) {
      best = provider;
    }
  }
  return best;
}

function toModelSelection(provider: ProviderKind, model: string): ModelSelection {
  const base = baseProviderKind(provider);
  if (base === "claudeAgent") {
    const profileId = providerProfileId(provider);
    return {
      provider: "claudeAgent",
      ...(profileId ? { profileId } : {}),
      model,
    };
  }
  return {
    provider: "codex",
    model,
  };
}

export function selectReviewModel(input: SelectReviewModelInput): ModelSelection {
  const implementationProvider = modelSelectionProviderKind(input.implementationModelSelection);
  const implementationBaseProvider = baseProviderKind(implementationProvider);

  const claudeProfiles = [...input.availableProviders].filter(
    (provider) =>
      provider.provider.startsWith("claudeAgent:") && provider.models.some(isReviewCapableModel),
  );

  const bestClaudeProfile = pickLowestUtilizationClaudeProfile(claudeProfiles, input.rateLimits);
  if (bestClaudeProfile) {
    return toModelSelection(bestClaudeProfile.provider, pickReviewModel(bestClaudeProfile));
  }

  const alternateProvider = input.availableProviders.find(
    (provider) => baseProviderKind(provider.provider) !== implementationBaseProvider,
  );
  if (alternateProvider) {
    return toModelSelection(alternateProvider.provider, pickReviewModel(alternateProvider));
  }

  return input.implementationModelSelection;
}
