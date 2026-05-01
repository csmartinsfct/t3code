import { describe, expect, it } from "vitest";

import {
  extractPorts,
  extractUrls,
  normalizeHealthCheck,
  normalizeInferenceLogLine,
} from "./Inference";

describe("managed run inference evidence normalization", () => {
  it("strips ANSI escapes inserted into Vite URLs", () => {
    const line =
      "  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5182\u001b[22m/\u001b[39m";

    expect(normalizeInferenceLogLine(line)).toBe("  ➜  Local:   http://localhost:5182/");
    expect(extractUrls([line])).toEqual(["http://localhost:5182/"]);
    expect(extractPorts([line])).toEqual([5182]);
  });

  it("extracts T3 dev-runner server and web ports", () => {
    const line =
      "[21:52:17.369] INFO (#1): [dev-runner] mode=dev source=default ports serverPort=3773 webPort=5733 baseDir=/Users/cristianomartins/.t3";

    expect(extractPorts([line])).toEqual([3773, 5733]);
  });

  it("accepts null LLM optional fields by omitting them before contract decoding", () => {
    expect(normalizeHealthCheck({ type: "port", port: 5733, host: null })).toEqual({
      type: "port",
      port: 5733,
    });
    expect(
      normalizeHealthCheck({ type: "command", command: "curl -f /health", cwd: null }),
    ).toEqual({
      type: "command",
      command: "curl -f /health",
    });
  });
});
