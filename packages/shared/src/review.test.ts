import { describe, expect, it } from "vitest";
import type { ProviderKind, ProviderRateLimitsSnapshot, ServerProvider } from "@t3tools/contracts";

import { buildReviewPrompt, REVIEW_SYSTEM_PROMPT, selectReviewModel } from "./review";

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
      buildReviewPrompt({
        ticketIdentifier: "T3CO-22",
        ticketTitle: "Review protocol schema and prompt template",
        ticketDescription: "Define the review contracts.",
        acceptanceCriteria: "- schema\n- prompt",
        diffSummaryOrPatch: "diff --git a/file.ts b/file.ts",
        iteration: 2,
        ticketWorktree: "t3code_orchestration",
      }),
    ).toEqual({
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt: `Review the completed work for ticket T3CO-22: Review protocol schema and prompt template.

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

If the ticket worktree is not null, treat it as part of the task context while reviewing. Set changesNeeded to true if the work should not yet be accepted. Set it to false only if the ticket is ready to be accepted as complete. Return JSON only.`,
    });
  });

  it("renders a null worktree literally when no ticket worktree is provided", () => {
    expect(
      buildReviewPrompt({
        ticketIdentifier: "T3CO-22",
        ticketTitle: "Review protocol schema and prompt template",
        ticketDescription: "desc",
        acceptanceCriteria: "criteria",
        diffSummaryOrPatch: "diff",
        iteration: 1,
        ticketWorktree: null,
      }).userPrompt,
    ).toContain("Worktree:\nnull");
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
