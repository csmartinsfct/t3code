import { describe, expect, it } from "vitest";

import { extractPorts, extractUrls, normalizeInferenceLogLine } from "./Inference";

describe("managed run inference evidence normalization", () => {
  it("strips ANSI escapes inserted into Vite URLs", () => {
    const line =
      "  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5182\u001b[22m/\u001b[39m";

    expect(normalizeInferenceLogLine(line)).toBe("  ➜  Local:   http://localhost:5182/");
    expect(extractUrls([line])).toEqual(["http://localhost:5182/"]);
    expect(extractPorts([line])).toEqual([5182]);
  });
});
