import { randomUUID } from "node:crypto";

import type { DynamicChatUiArtifactMetadata } from "@t3tools/contracts";
import {
  MAX_DYNAMIC_CHAT_UI_HEIGHT,
  MAX_DYNAMIC_CHAT_UI_HTML_CHARS,
  MIN_DYNAMIC_CHAT_UI_HEIGHT,
  type DynamicChatUiPayload,
} from "@t3tools/shared/dynamicChatUi";

import { readTrimmed } from "./tool";

export function generatedArtifactId(): string {
  return `chat-ui-${randomUUID()}`;
}

export function clampHeight(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(
    Math.max(Math.round(value), MIN_DYNAMIC_CHAT_UI_HEIGHT),
    MAX_DYNAMIC_CHAT_UI_HEIGHT,
  );
}

export function metadataForPayload(payload: DynamicChatUiPayload): DynamicChatUiArtifactMetadata {
  return {
    id: payload.id,
    title: payload.title,
    description: payload.description,
    initialHeight: payload.initialHeight,
    maxHeight: payload.maxHeight,
  };
}

export function buildDynamicChatUiBlock(input: Record<string, unknown>) {
  const html = typeof input.html === "string" ? input.html : "";
  if (!html.trim()) {
    return { error: "html is required." } as const;
  }
  if (html.length > MAX_DYNAMIC_CHAT_UI_HTML_CHARS) {
    return {
      error: `html must be ${MAX_DYNAMIC_CHAT_UI_HTML_CHARS} characters or fewer.`,
    } as const;
  }

  const title = readTrimmed(input, "title");
  if (!title) {
    return { error: "title is required." } as const;
  }

  const maxHeight = clampHeight(input.maxHeight, MAX_DYNAMIC_CHAT_UI_HEIGHT);
  const initialHeight = clampHeight(input.initialHeight, 320);
  const id = readTrimmed(input, "id") ?? generatedArtifactId();
  const description = readTrimmed(input, "description");
  const payload = {
    version: 1 as const,
    id,
    title,
    description: description ?? null,
    initialHeight,
    maxHeight,
    html,
  };
  const marker = {
    version: payload.version,
    id: payload.id,
    title: payload.title,
    description: payload.description,
    initialHeight: payload.initialHeight,
    maxHeight: payload.maxHeight,
  };

  return {
    block: ["```t3:dynamic-chat-ui", JSON.stringify(marker, null, 2), "```"].join("\n"),
    payload,
  } as const;
}

export function buildDynamicChatUiStatusBlock(input: {
  readonly title: string;
  readonly description?: string | null;
}): string {
  return [
    "```t3:dynamic-chat-ui-status",
    JSON.stringify(
      {
        version: 1,
        title: input.title,
        description: input.description ?? "Creating an interactive UI for this chat.",
        state: "generating",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}
