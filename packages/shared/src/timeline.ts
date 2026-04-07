const TIMELINE_PREFIX = "[timeline]";
const DEFAULT_TIMELINE_TEXT_PREVIEW_CHARS = 20;

type TimelineLogDetails = unknown;

function normalizeTimelineValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTimelineValue(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const normalizedEntries = Object.entries(value).flatMap(([key, entry]) => {
      const normalized = normalizeTimelineValue(entry, seen);
      return normalized === undefined ? [] : [[key, normalized] as const];
    });
    return Object.fromEntries(normalizedEntries);
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  return String(value);
}

export function formatTimelineLog(
  scope: string,
  event: string,
  details?: TimelineLogDetails,
): string {
  const normalizedDetails = normalizeTimelineValue(details ?? {}, new WeakSet());
  const payload =
    normalizedDetails && typeof normalizedDetails === "object" && !Array.isArray(normalizedDetails)
      ? normalizedDetails
      : { details: normalizedDetails };
  return `${TIMELINE_PREFIX} ${JSON.stringify({
    ts: new Date().toISOString(),
    scope,
    event,
    ...payload,
  })}`;
}

export function isTimelineLogMessage(message: string): boolean {
  return message.includes(TIMELINE_PREFIX);
}

export function summarizeTimelineText(
  text: string,
  maxChars = DEFAULT_TIMELINE_TEXT_PREVIEW_CHARS,
): {
  textLength: number;
  textPreview: string;
} {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return {
      textLength: text.length,
      textPreview: normalized,
    };
  }
  return {
    textLength: text.length,
    textPreview: `${normalized.slice(0, maxChars)}...`,
  };
}
