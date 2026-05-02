export type CursorJsonRecord = Record<string, unknown>;

export interface CursorStreamJsonBaseEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly sessionId?: string;
  readonly timestampMs?: number;
  readonly raw: CursorJsonRecord;
}

export interface CursorSystemInitEvent extends CursorStreamJsonBaseEvent {
  readonly type: "system";
  readonly subtype: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly apiKeySource?: string;
  readonly permissionMode?: string;
}

export interface CursorUserEvent extends CursorStreamJsonBaseEvent {
  readonly type: "user";
  readonly message?: unknown;
}

export interface CursorAssistantEvent extends CursorStreamJsonBaseEvent {
  readonly type: "assistant";
  readonly message?: unknown;
  readonly modelCallId?: string;
  readonly text: string;
}

export interface CursorThinkingEvent extends CursorStreamJsonBaseEvent {
  readonly type: "thinking";
  readonly subtype?: "delta" | "completed" | string;
  readonly text?: string;
}

export interface CursorToolCallEvent extends CursorStreamJsonBaseEvent {
  readonly type: "tool_call";
  readonly subtype?: "started" | "completed" | string;
  readonly callId?: string;
  readonly modelCallId?: string;
  readonly toolCall?: unknown;
}

export interface CursorInteractionQueryEvent extends CursorStreamJsonBaseEvent {
  readonly type: "interaction_query";
  readonly subtype?: "request" | "response" | string;
  readonly queryType?: string;
  readonly query?: unknown;
  readonly response?: unknown;
}

export interface CursorUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface CursorResultEvent extends CursorStreamJsonBaseEvent {
  readonly type: "result";
  readonly subtype?: string;
  readonly isError: boolean;
  readonly result?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly durationApiMs?: number;
  readonly usage?: CursorUsage;
}

export interface CursorUnknownEvent extends CursorStreamJsonBaseEvent {
  readonly type: string;
}

export type CursorStreamJsonEvent =
  | CursorSystemInitEvent
  | CursorUserEvent
  | CursorAssistantEvent
  | CursorThinkingEvent
  | CursorToolCallEvent
  | CursorInteractionQueryEvent
  | CursorResultEvent
  | CursorUnknownEvent;

export class CursorStreamJsonParseError extends Error {
  readonly lineNumber: number;
  readonly line: string;

  constructor(message: string, options: { readonly lineNumber: number; readonly line: string }) {
    super(message);
    this.name = "CursorStreamJsonParseError";
    this.lineNumber = options.lineNumber;
    this.line = options.line;
  }
}

function isRecord(value: unknown): value is CursorJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringProp<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const stringValue = optionalString(value);
  return stringValue ? ({ [key]: stringValue } as Partial<Record<K, string>>) : {};
}

function numberProp<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  const numberValue = optionalNumber(value);
  return numberValue !== undefined ? ({ [key]: numberValue } as Partial<Record<K, number>>) : {};
}

function normalizeUsage(value: unknown): CursorUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  } = {};
  const inputTokens = optionalNumber(value.inputTokens);
  const outputTokens = optionalNumber(value.outputTokens);
  const cacheReadTokens = optionalNumber(value.cacheReadTokens);
  const cacheWriteTokens = optionalNumber(value.cacheWriteTokens);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function extractTextFromMessage(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  return message.content
    .map((part) => {
      if (!isRecord(part)) return "";
      return part.type === "text" && typeof part.text === "string" ? part.text : "";
    })
    .join("");
}

function baseEvent(record: CursorJsonRecord): CursorStreamJsonBaseEvent {
  return {
    type: String(record.type),
    ...stringProp("subtype", record.subtype),
    ...stringProp("sessionId", record.session_id),
    ...numberProp("timestampMs", record.timestamp_ms),
    raw: record,
  };
}

export function parseCursorStreamJsonLine(line: string, lineNumber = 1): CursorStreamJsonEvent {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new CursorStreamJsonParseError("Cursor stream-json line is empty.", {
      lineNumber,
      line,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (cause) {
    throw new CursorStreamJsonParseError(
      cause instanceof Error
        ? `Malformed Cursor stream-json line: ${cause.message}`
        : "Malformed Cursor stream-json line.",
      { lineNumber, line },
    );
  }

  if (!isRecord(parsed)) {
    throw new CursorStreamJsonParseError("Cursor stream-json line must be a JSON object.", {
      lineNumber,
      line,
    });
  }

  const type = optionalString(parsed.type);
  if (!type) {
    throw new CursorStreamJsonParseError("Cursor stream-json line is missing a type.", {
      lineNumber,
      line,
    });
  }

  const base = baseEvent(parsed);
  switch (type) {
    case "system":
      return {
        ...base,
        type: "system",
        subtype: optionalString(parsed.subtype) ?? "unknown",
        ...stringProp("cwd", parsed.cwd),
        ...stringProp("model", parsed.model),
        ...stringProp("apiKeySource", parsed.apiKeySource),
        ...stringProp("permissionMode", parsed.permissionMode),
      };
    case "user":
      return {
        ...base,
        type: "user",
        ...(parsed.message !== undefined ? { message: parsed.message } : {}),
      };
    case "assistant":
      return {
        ...base,
        type: "assistant",
        ...(parsed.message !== undefined ? { message: parsed.message } : {}),
        ...stringProp("modelCallId", parsed.model_call_id),
        text: extractTextFromMessage(parsed.message),
      };
    case "thinking":
      return {
        ...base,
        type: "thinking",
        ...stringProp("subtype", parsed.subtype),
        ...stringProp("text", parsed.text),
      };
    case "tool_call":
      return {
        ...base,
        type: "tool_call",
        ...stringProp("subtype", parsed.subtype),
        ...stringProp("callId", parsed.call_id),
        ...stringProp("modelCallId", parsed.model_call_id),
        ...(parsed.tool_call !== undefined ? { toolCall: parsed.tool_call } : {}),
      };
    case "interaction_query":
      return {
        ...base,
        type: "interaction_query",
        ...stringProp("subtype", parsed.subtype),
        ...stringProp("queryType", parsed.query_type),
        ...(parsed.query !== undefined ? { query: parsed.query } : {}),
        ...(parsed.response !== undefined ? { response: parsed.response } : {}),
      };
    case "result":
      return {
        ...base,
        type: "result",
        ...stringProp("subtype", parsed.subtype),
        isError: parsed.is_error === true,
        ...(typeof parsed.result === "string" ? { result: parsed.result } : {}),
        ...stringProp("requestId", parsed.request_id),
        ...numberProp("durationMs", parsed.duration_ms),
        ...numberProp("durationApiMs", parsed.duration_api_ms),
        ...(normalizeUsage(parsed.usage) ? { usage: normalizeUsage(parsed.usage) } : {}),
      };
    default:
      return base;
  }
}

export class CursorStreamJsonChunkParser {
  private buffer = "";
  private lineNumber = 0;

  push(chunk: string): ReadonlyArray<CursorStreamJsonEvent> {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((line) => this.parseBufferedLine(line));
  }

  finish(): ReadonlyArray<CursorStreamJsonEvent> {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const line = this.buffer;
    this.buffer = "";
    return this.parseBufferedLine(line);
  }

  private parseBufferedLine(line: string): ReadonlyArray<CursorStreamJsonEvent> {
    if (!line.trim()) return [];
    this.lineNumber += 1;
    return [parseCursorStreamJsonLine(line, this.lineNumber)];
  }
}

export function parseCursorStreamJsonChunks(
  chunks: ReadonlyArray<string>,
): ReadonlyArray<CursorStreamJsonEvent> {
  const parser = new CursorStreamJsonChunkParser();
  const events = chunks.flatMap((chunk) => parser.push(chunk));
  return [...events, ...parser.finish()];
}

export function findCursorResultEvent(
  events: ReadonlyArray<CursorStreamJsonEvent>,
): CursorResultEvent | undefined {
  return events.findLast((event): event is CursorResultEvent => event.type === "result");
}
