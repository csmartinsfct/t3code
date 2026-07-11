import { describe, expect, it } from "vitest";

import { parseInlineDirectives } from "./inlineDirective";

describe("parseInlineDirectives", () => {
  it("ignores ordinary text", () => {
    expect(parseInlineDirectives("No inline directives here.")).toEqual([]);
  });

  it("parses a directive and preserves its source span", () => {
    const text = 'before ::codex-inline-vis{file="chart.html"} after';
    const start = text.indexOf("::");
    const raw = '::codex-inline-vis{file="chart.html"}';

    expect(parseInlineDirectives(text)).toEqual([
      {
        name: "codex-inline-vis",
        attributes: 'file="chart.html"',
        start,
        end: start + raw.length,
        raw,
      },
    ]);
  });

  it("parses multiple directives in source order", () => {
    const text = '::first{value="one"} middle ::second{value="two"}';

    expect(parseInlineDirectives(text)).toEqual([
      {
        name: "first",
        attributes: 'value="one"',
        start: 0,
        end: '::first{value="one"}'.length,
        raw: '::first{value="one"}',
      },
      {
        name: "second",
        attributes: 'value="two"',
        start: text.indexOf("::second"),
        end: text.length,
        raw: '::second{value="two"}',
      },
    ]);
  });

  it("decodes escaped quotes and backslashes in attributes", () => {
    const text = String.raw`::demo{label="a \"quoted\" value" path="C:\\tmp"}`;

    expect(parseInlineDirectives(text)).toEqual([
      {
        name: "demo",
        attributes: 'label="a "quoted" value" path="C:\\tmp"',
        start: 0,
        end: text.length,
        raw: text,
      },
    ]);
  });

  it("skips malformed directives with unterminated braces", () => {
    expect(parseInlineDirectives('before ::broken{file="chart.html" after')).toEqual([]);
  });

  it("skips malformed directives with an unterminated quoted value", () => {
    expect(parseInlineDirectives('before ::broken{file="chart.html} after')).toEqual([]);
  });

  it("recovers from a malformed prefix before a valid directive", () => {
    const text = 'before ::broken{noise ::valid{file="chart.html"} after';
    const start = text.indexOf("::valid");
    const raw = '::valid{file="chart.html"}';

    expect(parseInlineDirectives(text)).toEqual([
      {
        name: "valid",
        attributes: 'file="chart.html"',
        start,
        end: start + raw.length,
        raw,
      },
    ]);
  });

  it("keeps dense malformed input bounded", () => {
    const text = "::broken{".repeat(12_000);
    const startedAt = performance.now();

    expect(parseInlineDirectives(text)).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
