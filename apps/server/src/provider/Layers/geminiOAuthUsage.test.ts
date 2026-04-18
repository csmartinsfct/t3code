import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchGeminiOAuthUsage,
  parseGeminiQuotaResponse,
  resetGeminiOAuthUsageCache,
} from "./geminiOAuthUsage.ts";

const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseGeminiQuotaResponse", () => {
  it("normalizes remaining fractions to utilization and sorts most constrained first", () => {
    const tiers = parseGeminiQuotaResponse({
      buckets: [
        {
          modelId: "gemini-2.5-flash",
          remainingFraction: 0.9,
          resetTime: "2026-04-19T01:47:09Z",
        },
        {
          modelId: "gemini-3.1-pro-preview",
          remainingFraction: 0.25,
          resetTime: "2026-04-19T02:04:33Z",
        },
        { modelId: "missing-fraction" },
        { remainingFraction: 0.1 },
      ],
    });

    expect(tiers).toEqual([
      {
        tier: "gemini-3.1-pro-preview",
        utilization: 0.75,
        resetsAt: "2026-04-19T02:04:33Z",
      },
      {
        tier: "gemini-2.5-flash",
        utilization: 0.09999999999999998,
        resetsAt: "2026-04-19T01:47:09Z",
      },
    ]);
  });

  it("accepts alternate bucket wrappers defensively", () => {
    const tiers = parseGeminiQuotaResponse({
      quota: {
        quotaBuckets: [{ model_id: "gemini-2.5-pro", remaining_fraction: 0.5 }],
      },
    });

    expect(tiers).toEqual([
      {
        tier: "gemini-2.5-pro",
        utilization: 0.5,
        resetsAt: null,
      },
    ]);
  });
});

describe("fetchGeminiOAuthUsage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetGeminiOAuthUsageCache();
    vi.restoreAllMocks();
  });

  it("loads the Code Assist project and fetches per-model quota buckets", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "t3code-gemini-quota-"));
    writeFileSync(
      join(homePath, "oauth_creds.json"),
      JSON.stringify({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expiry_date: Date.now() + 10 * 60_000,
      }),
    );

    const requests: Array<{ url: string; body: unknown }> = [];
    const mockFetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const url = String(input);
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      if (url.endsWith(":loadCodeAssist")) {
        return jsonResponse({ cloudaicompanionProject: "project-123" });
      }

      if (url.endsWith(":retrieveUserQuota")) {
        return jsonResponse({
          buckets: [
            {
              modelId: "gemini-3.1-pro-preview",
              remainingFraction: 0.8,
              resetTime: "2026-04-19T02:04:33Z",
            },
          ],
        });
      }

      return jsonResponse({ error: "unexpected URL" }, 404);
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const tiers = await fetchGeminiOAuthUsage(homePath);

    expect(requests.map((request) => request.url)).toEqual([
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    ]);
    expect(requests[1]?.body).toEqual({ project: "project-123" });
    expect(tiers).toEqual([
      {
        tier: "gemini-3.1-pro-preview",
        utilization: 0.19999999999999996,
        resetsAt: "2026-04-19T02:04:33Z",
      },
    ]);
  });
});
