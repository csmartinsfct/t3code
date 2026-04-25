import { describe, expect, it } from "vitest";

import {
  isDynamicChatUiBlock,
  isDynamicChatUiStatusBlock,
  parseDynamicChatUiPayload,
  parseDynamicChatUiStatusPayload,
} from "./dynamicChatUiParser";

describe("isDynamicChatUiBlock", () => {
  it("accepts colon and dash language names", () => {
    expect(isDynamicChatUiBlock("language-t3:dynamic-chat-ui")).toBe(true);
    expect(isDynamicChatUiBlock("language-t3-dynamic-chat-ui")).toBe(true);
  });

  it("accepts language names inside markdown class strings", () => {
    expect(isDynamicChatUiBlock("code language-t3:dynamic-chat-ui hljs")).toBe(true);
  });

  it("rejects unrelated languages", () => {
    expect(isDynamicChatUiBlock("language-json")).toBe(false);
    expect(isDynamicChatUiBlock(undefined)).toBe(false);
  });
});

describe("isDynamicChatUiStatusBlock", () => {
  it("accepts colon and dash status language names", () => {
    expect(isDynamicChatUiStatusBlock("language-t3:dynamic-chat-ui-status")).toBe(true);
    expect(isDynamicChatUiStatusBlock("language-t3-dynamic-chat-ui-status")).toBe(true);
  });

  it("rejects unrelated languages", () => {
    expect(isDynamicChatUiStatusBlock("language-json")).toBe(false);
    expect(isDynamicChatUiStatusBlock(undefined)).toBe(false);
  });
});

describe("parseDynamicChatUiPayload", () => {
  it("parses a minimal dynamic chat UI payload", () => {
    const result = parseDynamicChatUiPayload(
      JSON.stringify({
        version: 1,
        title: "Scenario explorer",
        html: "<main><h1>Scenario explorer</h1></main>",
      }),
    );

    expect(result).toMatchObject({
      version: 1,
      title: "Scenario explorer",
      description: null,
      html: "<main><h1>Scenario explorer</h1></main>",
      initialHeight: 320,
      maxHeight: 900,
    });
    expect(result?.id).toMatch(/^chat-ui-/);
  });

  it("preserves explicit id, description, and height settings", () => {
    const result = parseDynamicChatUiPayload(
      JSON.stringify({
        version: 1,
        id: "pricing-sim",
        title: "Pricing simulator",
        description: "Interactive slider card.",
        html: "<div>sim</div>",
        initialHeight: 260,
        maxHeight: 500,
      }),
    );

    expect(result).toEqual({
      version: 1,
      id: "pricing-sim",
      title: "Pricing simulator",
      description: "Interactive slider card.",
      html: "<div>sim</div>",
      initialHeight: 260,
      maxHeight: 500,
    });
  });

  it("clamps unsafe height values", () => {
    const result = parseDynamicChatUiPayload(
      JSON.stringify({
        version: 1,
        html: "<div>large</div>",
        initialHeight: 20,
        maxHeight: 10_000,
      }),
    );

    expect(result?.initialHeight).toBe(120);
    expect(result?.maxHeight).toBe(900);
  });

  it("rejects malformed or incomplete payloads", () => {
    expect(parseDynamicChatUiPayload("{")).toBeNull();
    expect(parseDynamicChatUiPayload("{}")).toBeNull();
    expect(parseDynamicChatUiPayload(JSON.stringify({ version: 2, html: "<div />" }))).toBeNull();
    expect(parseDynamicChatUiPayload(JSON.stringify({ version: 1, html: "" }))).toBeNull();
  });
});

describe("parseDynamicChatUiStatusPayload", () => {
  it("parses a generating status payload", () => {
    expect(
      parseDynamicChatUiStatusPayload(
        JSON.stringify({
          version: 1,
          title: "Scenario explorer",
          description: "Building a compact UI.",
          state: "generating",
        }),
      ),
    ).toEqual({
      version: 1,
      title: "Scenario explorer",
      description: "Building a compact UI.",
      state: "generating",
    });
  });
});
