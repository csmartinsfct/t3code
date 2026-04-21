import type {
  OrchestrationThreadActivity,
  ThreadContextUsageBreakdown,
  ThreadContextUsageCategory,
  ThreadContextUsageMessageBreakdown,
  ThreadContextUsageNamedTokenCount,
  ThreadContextUsageToolTokenCount,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseNamedTokenCount(value: unknown): ThreadContextUsageNamedTokenCount | null {
  const record = asRecord(value);
  const name = asString(record?.name);
  const tokens = asFiniteNumber(record?.tokens);
  if (name === null || tokens === null || tokens < 0) {
    return null;
  }
  return { name, tokens: Math.round(tokens) };
}

function parseUsageCategory(value: unknown): ThreadContextUsageCategory | null {
  const record = asRecord(value);
  const base = parseNamedTokenCount(value);
  if (!record || !base) {
    return null;
  }
  const color = asString(record.color);
  const isDeferred = asBoolean(record.isDeferred);
  return {
    ...base,
    ...(color !== null ? { color } : {}),
    ...(isDeferred !== null ? { isDeferred } : {}),
  };
}

function parseToolTokenCount(value: unknown): ThreadContextUsageToolTokenCount | null {
  const record = asRecord(value);
  const base = parseNamedTokenCount(value);
  if (!record || !base) {
    return null;
  }
  const serverName = asString(record.serverName);
  const isLoaded = asBoolean(record.isLoaded);
  return {
    ...base,
    ...(serverName !== null ? { serverName } : {}),
    ...(isLoaded !== null ? { isLoaded } : {}),
  };
}

function parseArray<T>(value: unknown, parse: (item: unknown) => T | null): Array<T> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.flatMap((item) => {
    const parsed = parse(item);
    return parsed === null ? [] : [parsed];
  });
}

function parseMessageBreakdown(value: unknown): ThreadContextUsageMessageBreakdown | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    toolCallTokens: Math.round(Math.max(0, asFiniteNumber(record.toolCallTokens) ?? 0)),
    toolResultTokens: Math.round(Math.max(0, asFiniteNumber(record.toolResultTokens) ?? 0)),
    attachmentTokens: Math.round(Math.max(0, asFiniteNumber(record.attachmentTokens) ?? 0)),
    assistantMessageTokens: Math.round(
      Math.max(0, asFiniteNumber(record.assistantMessageTokens) ?? 0),
    ),
    userMessageTokens: Math.round(Math.max(0, asFiniteNumber(record.userMessageTokens) ?? 0)),
    redirectedContextTokens: Math.round(
      Math.max(0, asFiniteNumber(record.redirectedContextTokens) ?? 0),
    ),
    unattributedTokens: Math.round(Math.max(0, asFiniteNumber(record.unattributedTokens) ?? 0)),
    toolCallsByType:
      parseArray(record.toolCallsByType, (item) => {
        const itemRecord = asRecord(item);
        const name = asString(itemRecord?.name);
        if (name === null) {
          return null;
        }
        return {
          name,
          callTokens: Math.round(Math.max(0, asFiniteNumber(itemRecord?.callTokens) ?? 0)),
          resultTokens: Math.round(Math.max(0, asFiniteNumber(itemRecord?.resultTokens) ?? 0)),
        };
      }) ?? [],
    attachmentsByType: parseArray(record.attachmentsByType, parseNamedTokenCount) ?? [],
  };
}

function parseContextUsageBreakdown(value: unknown): ThreadContextUsageBreakdown | null {
  const record = asRecord(value);
  const totalTokens = asFiniteNumber(record?.totalTokens);
  const maxTokens = asFiniteNumber(record?.maxTokens);
  const categories = parseArray(record?.categories, parseUsageCategory);
  if (
    !record ||
    totalTokens === null ||
    totalTokens < 0 ||
    maxTokens === null ||
    maxTokens <= 0 ||
    categories === null
  ) {
    return null;
  }

  const rawMaxTokens = asFiniteNumber(record.rawMaxTokens);
  const percentage = asFiniteNumber(record.percentage);
  const model = asString(record.model);
  const mcpTools = parseArray(record.mcpTools, parseToolTokenCount);
  const deferredBuiltinTools = parseArray(record.deferredBuiltinTools, parseToolTokenCount);
  const systemTools = parseArray(record.systemTools, parseNamedTokenCount);
  const systemPromptSections = parseArray(record.systemPromptSections, parseNamedTokenCount);
  const messageBreakdown = parseMessageBreakdown(record.messageBreakdown);
  const isAutoCompactEnabled = asBoolean(record.isAutoCompactEnabled);
  const autoCompactThreshold = asFiniteNumber(record.autoCompactThreshold);

  return {
    totalTokens: Math.round(totalTokens),
    maxTokens: Math.round(maxTokens),
    categories,
    ...(rawMaxTokens !== null && rawMaxTokens > 0
      ? { rawMaxTokens: Math.round(rawMaxTokens) }
      : {}),
    ...(percentage !== null ? { percentage } : {}),
    ...(model !== null ? { model } : {}),
    ...(mcpTools !== null ? { mcpTools } : {}),
    ...(deferredBuiltinTools !== null ? { deferredBuiltinTools } : {}),
    ...(systemTools !== null ? { systemTools } : {}),
    ...(systemPromptSections !== null ? { systemPromptSections } : {}),
    ...(messageBreakdown !== null ? { messageBreakdown } : {}),
    ...(isAutoCompactEnabled !== null ? { isAutoCompactEnabled } : {}),
    ...(autoCompactThreshold !== null && autoCompactThreshold >= 0
      ? { autoCompactThreshold: Math.round(autoCompactThreshold) }
      : {}),
  };
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens <= 0) {
      continue;
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      breakdown: parseContextUsageBreakdown(payload?.breakdown),
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
