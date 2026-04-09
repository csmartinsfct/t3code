import { describe, expect, it } from "vitest";
import type { ProviderKind, ProviderRateLimitsSnapshot, ServerProvider } from "@t3tools/contracts";

import {
  buildReviewPrompt,
  parseReviewOutputJsonCandidates,
  parseReviewOutputJson,
  selectReviewModel,
} from "./review";
import { ORCHESTRATION_PROMPT_DEFAULTS } from "./promptTemplates";

function makeProvider(
  input: Omit<Partial<ServerProvider>, "provider"> & { provider: ProviderKind },
): ServerProvider {
  return {
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-09T00:00:00.000Z",
    models: [],
    ...input,
  } as ServerProvider;
}

function makeRateLimit(provider: ProviderKind, utilization: number): ProviderRateLimitsSnapshot {
  return {
    provider: provider as ProviderRateLimitsSnapshot["provider"],
    rateLimitInfo: {
      status: "allowed",
    },
    updatedAt: "2026-04-09T00:00:00.000Z",
    oauthUsageTiers: [
      {
        tier: "five_hour",
        utilization,
        resetsAt: null,
      },
    ],
  };
}

describe("buildReviewPrompt", () => {
  it("returns the exact deterministic review prompt template", () => {
    expect(
      buildReviewPrompt(ORCHESTRATION_PROMPT_DEFAULTS.review, {
        ticketIdentifier: "T3CO-22",
        ticketTitle: "Review protocol schema and prompt template",
        ticketDescription: "Define the review contracts.",
        acceptanceCriteria: "- schema\n- prompt",
        diffSummaryOrPatch: "diff --git a/file.ts b/file.ts",
        iteration: 2,
        ticketWorktree: "t3code_orchestration",
      }),
    )
      .toEqual(`You are reviewing completed work for a ticket in an automated orchestration workflow. Evaluate the implementation against the ticket requirements and the provided diff. Return valid JSON only. Do not include markdown fences, commentary, or any text outside the JSON object.

Review the completed work for ticket T3CO-22: Review protocol schema and prompt template.

Ticket description:
Define the review contracts.

Acceptance criteria:
- schema
- prompt

Worktree:
t3code_orchestration

Diff:
diff --git a/file.ts b/file.ts

Review iteration: 2

Return a JSON object matching this shape exactly:
{
  "changesNeeded": boolean,
  "summary": string,
  "comments": [
    {
      "file": string | null,
      "line": number | null,
      "severity": "critical" | "suggestion" | "nit",
      "body": string
    }
  ],
  "suggestions": string[]
}

If the ticket worktree is not null, treat it as part of the task context while reviewing. Set changesNeeded to true if the work should not yet be accepted. Set it to false only if the ticket is ready to be accepted as complete. Return JSON only.`);
  });

  it("renders a null worktree literally when no ticket worktree is provided", () => {
    expect(
      buildReviewPrompt(ORCHESTRATION_PROMPT_DEFAULTS.review, {
        ticketIdentifier: "T3CO-22",
        ticketTitle: "Review protocol schema and prompt template",
        ticketDescription: "desc",
        acceptanceCriteria: "criteria",
        diffSummaryOrPatch: "diff",
        iteration: 1,
        ticketWorktree: null,
      }),
    ).not.toContain("Worktree:");
  });
});

describe("parseReviewOutputJson", () => {
  it("parses review JSON wrapped in prose and fenced code", () => {
    expect(
      parseReviewOutputJson(`The change looks good overall.

\`\`\`json
{
  "changesNeeded": false,
  "summary": "Ready to accept.",
  "comments": [],
  "suggestions": []
}
\`\`\`

No further action needed.`),
    ).toEqual({
      changesNeeded: false,
      summary: "Ready to accept.",
      comments: [],
      suggestions: [],
    });
  });

  it("parses a single embedded JSON object without fences", () => {
    expect(
      parseReviewOutputJson(`I checked the work carefully. {
  "changesNeeded": true,
  "summary": "One fix is still needed.",
  "comments": [],
  "suggestions": ["Update the label in the secondary view too."]
}`),
    ).toEqual({
      changesNeeded: true,
      summary: "One fix is still needed.",
      comments: [],
      suggestions: ["Update the label in the secondary view too."],
    });
  });

  it("throws when the response does not contain valid JSON", () => {
    expect(() => parseReviewOutputJson("This is not JSON at all.")).toThrow(
      "Review output did not contain valid JSON",
    );
  });

  it("returns all parseable JSON candidates in order", () => {
    expect(
      parseReviewOutputJsonCandidates(`Context:
{"kind":"metadata"}

\`\`\`json
{"changesNeeded":false,"summary":"Ready.","comments":[],"suggestions":[]}
\`\`\``),
    ).toEqual([
      { kind: "metadata" },
      {
        changesNeeded: false,
        summary: "Ready.",
        comments: [],
        suggestions: [],
      },
    ]);
  });
});

describe("selectReviewModel", () => {
  it("prefers the claude profile with the lowest five-hour utilization", () => {
    const result = selectReviewModel({
      availableProviders: [
        makeProvider({
          provider: "claudeAgent:alpha" as ProviderKind,
          models: [
            {
              slug: "claude-sonnet-4-6",
              name: "Claude Sonnet 4.6",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [{ value: "high", label: "High", isDefault: true }],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: ["ultrathink"],
              },
            },
          ],
        }),
        makeProvider({
          provider: "claudeAgent:beta" as ProviderKind,
          models: [
            {
              slug: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [{ value: "high", label: "High", isDefault: true }],
                supportsFastMode: true,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: ["ultrathink"],
              },
            },
          ],
        }),
      ],
      rateLimits: [
        makeRateLimit("claudeAgent:alpha", 0.42),
        makeRateLimit("claudeAgent:beta", 0.11),
      ],
      implementationModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
    });

    expect(result).toEqual({
      provider: "claudeAgent",
      profileId: "beta",
      model: "claude-opus-4-6",
    });
  });

  it("falls back to a different configured provider when no claude profile is available", () => {
    const result = selectReviewModel({
      availableProviders: [
        makeProvider({
          provider: "codex",
          models: [
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [{ value: "high", label: "High", isDefault: true }],
                supportsFastMode: true,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: [],
              },
            },
          ],
        }),
        makeProvider({
          provider: "claudeAgent",
          models: [
            {
              slug: "claude-sonnet-4-6",
              name: "Claude Sonnet 4.6",
              isCustom: false,
              capabilities: {
                reasoningEffortLevels: [{ value: "high", label: "High", isDefault: true }],
                supportsFastMode: false,
                supportsThinkingToggle: false,
                supportsPlan: true,
                contextWindowOptions: [],
                promptInjectedEffortLevels: ["ultrathink"],
              },
            },
          ],
        }),
      ],
      rateLimits: [],
      implementationModelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
      },
    });

    expect(result).toEqual({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    });
  });

  it("returns the implementation model selection when no alternate provider exists", () => {
    const implementationModelSelection = {
      provider: "codex" as const,
      model: "gpt-5.4-mini",
      options: {
        reasoningEffort: "medium" as const,
      },
    };

    expect(
      selectReviewModel({
        availableProviders: [
          makeProvider({
            provider: "codex",
            models: [
              {
                slug: "gpt-5.4-mini",
                name: "GPT-5.4 Mini",
                isCustom: false,
                capabilities: {
                  reasoningEffortLevels: [{ value: "high", label: "High", isDefault: true }],
                  supportsFastMode: true,
                  supportsThinkingToggle: false,
                  supportsPlan: true,
                  contextWindowOptions: [],
                  promptInjectedEffortLevels: [],
                },
              },
            ],
          }),
        ],
        rateLimits: [],
        implementationModelSelection,
      }),
    ).toBe(implementationModelSelection);
  });
});
