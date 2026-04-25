import type {
  DynamicChatUiArtifactDocument,
  DynamicChatUiArtifactMetadata,
} from "@t3tools/contracts";

const DYNAMIC_CHAT_UI_LANGUAGES = new Set(["t3:dynamic-chat-ui", "t3-dynamic-chat-ui"]);
const DYNAMIC_CHAT_UI_CLASS_LANGUAGES = new Set(
  [...DYNAMIC_CHAT_UI_LANGUAGES].map((language) => `language-${language}`),
);
const DYNAMIC_CHAT_UI_STATUS_LANGUAGES = new Set([
  "t3:dynamic-chat-ui-status",
  "t3-dynamic-chat-ui-status",
]);
const DYNAMIC_CHAT_UI_STATUS_CLASS_LANGUAGES = new Set(
  [...DYNAMIC_CHAT_UI_STATUS_LANGUAGES].map((language) => `language-${language}`),
);

export const MAX_DYNAMIC_CHAT_UI_HTML_CHARS = 400_000;
export const DEFAULT_DYNAMIC_CHAT_UI_HEIGHT = 320;
export const MIN_DYNAMIC_CHAT_UI_HEIGHT = 120;
export const MAX_DYNAMIC_CHAT_UI_HEIGHT = 900;

export interface DynamicChatUiPayload {
  version: 1;
  id: string;
  title: string;
  description: string | null;
  html: string;
  initialHeight: number;
  maxHeight: number;
}

export interface DynamicChatUiStatusPayload {
  version: 1;
  title: string;
  description: string | null;
  state: "generating";
}

export function isDynamicChatUiLanguage(language: string | undefined): boolean {
  if (!language) return false;
  const [firstToken] = language.trim().split(/\s+/);
  return DYNAMIC_CHAT_UI_LANGUAGES.has(firstToken ?? "");
}

export function isDynamicChatUiBlock(className: string | undefined): boolean {
  if (!className) return false;
  return className.split(/\s+/).some((token) => DYNAMIC_CHAT_UI_CLASS_LANGUAGES.has(token.trim()));
}

export function isDynamicChatUiStatusLanguage(language: string | undefined): boolean {
  if (!language) return false;
  const [firstToken] = language.trim().split(/\s+/);
  return DYNAMIC_CHAT_UI_STATUS_LANGUAGES.has(firstToken ?? "");
}

export function isDynamicChatUiStatusBlock(className: string | undefined): boolean {
  if (!className) return false;
  return className
    .split(/\s+/)
    .some((token) => DYNAMIC_CHAT_UI_STATUS_CLASS_LANGUAGES.has(token.trim()));
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value.trim() : null;
}

function clampHeight(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(
    Math.max(Math.round(value), MIN_DYNAMIC_CHAT_UI_HEIGHT),
    MAX_DYNAMIC_CHAT_UI_HEIGHT,
  );
}

function createArtifactId(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `chat-ui-${(hash >>> 0).toString(36)}`;
}

export function parseDynamicChatUiPayload(code: string): DynamicChatUiPayload | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) return null;

    const html = typeof record.html === "string" ? record.html : "";
    if (!html.trim() || html.length > MAX_DYNAMIC_CHAT_UI_HTML_CHARS) {
      return null;
    }

    const id = readString(record, "id") ?? createArtifactId(html);
    const title = readString(record, "title") ?? "Dynamic chat UI";
    const description = readString(record, "description");
    const maxHeight = clampHeight(record.maxHeight, MAX_DYNAMIC_CHAT_UI_HEIGHT);
    const initialHeight = Math.min(
      clampHeight(record.initialHeight ?? record.height, DEFAULT_DYNAMIC_CHAT_UI_HEIGHT),
      maxHeight,
    );

    return {
      version: 1,
      id,
      title,
      description,
      html,
      initialHeight,
      maxHeight,
    };
  } catch {
    return null;
  }
}

export function parseDynamicChatUiStatusPayload(code: string): DynamicChatUiStatusPayload | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || record.state !== "generating") return null;

    const title = readString(record, "title") ?? "Dynamic chat UI";
    const description = readString(record, "description");

    return {
      version: 1,
      title,
      description,
      state: "generating",
    };
  } catch {
    return null;
  }
}

export function toDynamicChatUiArtifactMetadata(
  payload: DynamicChatUiPayload,
): DynamicChatUiArtifactMetadata {
  return {
    id: payload.id,
    title: payload.title,
    description: payload.description,
    initialHeight: payload.initialHeight,
    maxHeight: payload.maxHeight,
  };
}

export function toDynamicChatUiArtifactDocument(
  payload: DynamicChatUiPayload,
): DynamicChatUiArtifactDocument {
  return {
    version: payload.version,
    ...toDynamicChatUiArtifactMetadata(payload),
    html: payload.html,
  };
}

export function extractDynamicChatUiPayloadsFromMarkdown(markdown: string): DynamicChatUiPayload[] {
  const payloads: DynamicChatUiPayload[] = [];
  const fencePattern = /```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```/g;

  for (const match of markdown.matchAll(fencePattern)) {
    const language = match[1];
    const code = match[2] ?? "";
    if (!isDynamicChatUiLanguage(language)) continue;

    const payload = parseDynamicChatUiPayload(code);
    if (!payload) continue;

    payloads.push(payload);
  }

  return payloads;
}

export function extractDynamicChatUiArtifactsFromMarkdown(
  markdown: string,
): DynamicChatUiArtifactDocument[] {
  return extractDynamicChatUiPayloadsFromMarkdown(markdown).map(toDynamicChatUiArtifactDocument);
}

export function stripDynamicChatUiFencesFromMarkdown(markdown: string): string {
  return markdown
    .replace(/```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```/g, (match, language: string) =>
      isDynamicChatUiLanguage(language) ? "" : match,
    )
    .trim();
}
