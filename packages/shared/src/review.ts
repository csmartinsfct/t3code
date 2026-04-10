import {
  baseProviderKind,
  DEFAULT_MODEL_BY_PROVIDER,
  modelSelectionProviderKind,
  providerProfileId,
  type ModelSelection,
  type PromptTemplateDocument,
  type ProviderKind,
  type ProviderRateLimitsSnapshot,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { renderPromptTemplate } from "./promptTemplates";

export interface ReviewPromptTemplateInput {
  readonly ticketIdentifier: string;
  readonly ticketTitle: string;
  readonly ticketDescription: string;
  readonly acceptanceCriteria: string;
  readonly diffSummaryOrPatch: string;
  readonly iteration: number;
  readonly ticketWorktree: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

function extractBalancedJsonObjects(
  text: string,
): Array<{ readonly index: number; readonly text: string }> {
  const objects: Array<{ readonly index: number; readonly text: string }> = [];
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
        objects.push({
          index: objectStart,
          text: text.slice(objectStart, index + 1),
        });
        objectStart = -1;
      }
    }
  }

  return objects;
}

export function parseReviewOutputJsonCandidates(text: string): ReadonlyArray<unknown> {
  const trimmedText = text.trim();
  const candidates: Array<{ readonly index: number; readonly text: string }> = [];

  const pushCandidate = (candidateText: string, index: number) => {
    candidates.push({
      index,
      text: candidateText,
    });
  };

  pushCandidate(trimmedText, 0);

  const fencedJsonBlocks = trimmedText.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  for (const match of fencedJsonBlocks) {
    const candidate = match[1]?.trim();
    if (candidate) {
      pushCandidate(candidate, match.index ?? 0);
    }
  }

  for (const candidate of extractBalancedJsonObjects(trimmedText)) {
    pushCandidate(candidate.text, candidate.index);
  }

  const parsedCandidates: unknown[] = [];
  const seenCandidateTexts = new Set<string>();
  for (const candidate of candidates.toSorted((left, right) => left.index - right.index)) {
    if (seenCandidateTexts.has(candidate.text)) {
      continue;
    }
    seenCandidateTexts.add(candidate.text);
    const parsedCandidate = tryParseJson(candidate.text);
    if (parsedCandidate) {
      parsedCandidates.push(parsedCandidate.value);
    }
  }

  if (parsedCandidates.length === 0) {
    throw new SyntaxError("Review output did not contain valid JSON");
  }

  return parsedCandidates;
}

export function parseReviewOutputJson(text: string): unknown {
  return parseReviewOutputJsonCandidates(text)[0];
}

export function normalizeReviewOutputCandidate(candidate: unknown): unknown {
  if (!isRecord(candidate) || !Array.isArray(candidate.suggestions)) {
    return candidate;
  }

  const normalizedComments = Array.isArray(candidate.comments) ? [...candidate.comments] : [];
  const seenSuggestionBodies = new Set(
    normalizedComments.flatMap((comment) =>
      isRecord(comment) && comment.severity === "suggestion" && typeof comment.body === "string"
        ? [comment.body]
        : [],
    ),
  );

  for (const suggestion of candidate.suggestions) {
    if (typeof suggestion !== "string" || suggestion.length === 0) {
      continue;
    }
    if (seenSuggestionBodies.has(suggestion)) {
      continue;
    }
    seenSuggestionBodies.add(suggestion);
    normalizedComments.push({
      file: null,
      line: null,
      severity: "suggestion",
      body: suggestion,
    });
  }

  const normalizedCandidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (key !== "suggestions") {
      normalizedCandidate[key] = value;
    }
  }
  normalizedCandidate.comments = normalizedComments;
  return normalizedCandidate;
}

export function buildReviewPrompt(
  document: PromptTemplateDocument,
  input: ReviewPromptTemplateInput,
): string {
  return renderPromptTemplate(document, {
    ticketId: input.ticketIdentifier,
    ticketTitle: input.ticketTitle,
    ticketDescription: input.ticketDescription,
    acceptanceCriteria: input.acceptanceCriteria,
    worktree: input.ticketWorktree ?? "",
    commitDiff: input.diffSummaryOrPatch,
    reviewIteration: String(input.iteration),
  });
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

/** @deprecated Model selection is now deterministic via orchestration settings and ticket overrides. */
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
