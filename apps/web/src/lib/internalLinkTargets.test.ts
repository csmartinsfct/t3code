import { describe, expect, it } from "vitest";

import { parseInternalLinkTarget, unwrapBacktickedTicketLinks } from "./internalLinkTargets";

describe("parseInternalLinkTarget", () => {
  it("parses ticket links", () => {
    expect(parseInternalLinkTarget("t3://ticket/T3CO-191")).toEqual({
      kind: "ticket",
      identifier: "T3CO-191",
    });
  });

  it("parses encoded identifiers", () => {
    expect(parseInternalLinkTarget("t3://ticket/T3CO-191%20draft")).toEqual({
      kind: "ticket",
      identifier: "T3CO-191 draft",
    });
  });

  it("rejects malformed urls", () => {
    expect(parseInternalLinkTarget("t3://ticket/%E0%A4%A")).toBeNull();
    expect(parseInternalLinkTarget("not a url")).toBeNull();
  });

  it("rejects the wrong protocol or resource kind", () => {
    expect(parseInternalLinkTarget("https://ticket/T3CO-191")).toBeNull();
    expect(parseInternalLinkTarget("t3://run/T3CO-191")).toBeNull();
  });

  it("rejects missing or extra path segments", () => {
    expect(parseInternalLinkTarget("t3://ticket")).toBeNull();
    expect(parseInternalLinkTarget("t3://ticket/")).toBeNull();
    expect(parseInternalLinkTarget("t3://ticket/T3CO-191/extra")).toBeNull();
  });

  it("rejects query strings, fragments, and blank identifiers", () => {
    expect(parseInternalLinkTarget("t3://ticket/T3CO-191?foo=bar")).toBeNull();
    expect(parseInternalLinkTarget("t3://ticket/T3CO-191#details")).toBeNull();
    expect(parseInternalLinkTarget("t3://ticket/%20")).toBeNull();
  });
});

describe("unwrapBacktickedTicketLinks", () => {
  it("strips backticks around a ticket link", () => {
    expect(unwrapBacktickedTicketLinks("`[METR-39](t3://ticket/METR-39)`")).toBe(
      "[METR-39](t3://ticket/METR-39)",
    );
  });

  it("handles multiple ticket links in the same text", () => {
    const input = "see `[A-1](t3://ticket/A-1)` and `[B-2](t3://ticket/B-2)`";
    expect(unwrapBacktickedTicketLinks(input)).toBe(
      "see [A-1](t3://ticket/A-1) and [B-2](t3://ticket/B-2)",
    );
  });

  it("leaves non-ticket backticked content alone", () => {
    const input = "run `bun test` and check `[link](https://example.com)`";
    expect(unwrapBacktickedTicketLinks(input)).toBe(input);
  });

  it("leaves bare ticket links unchanged", () => {
    const input = "[METR-39](t3://ticket/METR-39)";
    expect(unwrapBacktickedTicketLinks(input)).toBe(input);
  });
});
