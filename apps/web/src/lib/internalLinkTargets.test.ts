import { describe, expect, it } from "vitest";

import { parseInternalLinkTarget } from "./internalLinkTargets";

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
