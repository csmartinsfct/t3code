import { describe, expect, it } from "vitest";

import {
  applyOrchestrationPromptOverridePatch,
  hasOrchestrationPromptOverrides,
  listPromptTemplateVariables,
  normalizePromptTemplateVariableReference,
  ORCHESTRATION_PROMPT_DEFAULTS,
  ORCHESTRATION_PROMPT_VARIABLE_REGISTRY,
  renderPromptTemplate,
  resolveOrchestrationPromptDocuments,
  validatePromptTemplateDocument,
} from "./promptTemplates";

describe("prompt template variable registry", () => {
  it("contains the required canonical variables and aliases", () => {
    expect(ORCHESTRATION_PROMPT_VARIABLE_REGISTRY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ticketId",
          aliases: ["ticketIdentifier"],
        }),
        expect.objectContaining({
          key: "ticketTitle",
          aliases: ["ticketName"],
        }),
        expect.objectContaining({
          key: "commitDiff",
          aliases: ["diff"],
        }),
      ]),
    );
  });

  it("filters variable definitions by prompt id", () => {
    expect(listPromptTemplateVariables("review").map((definition) => definition.key)).toEqual(
      expect.arrayContaining([
        "ticketId",
        "ticketTitle",
        "ticketDescription",
        "acceptanceCriteria",
        "worktree",
        "commitDiff",
        "reviewIteration",
      ]),
    );
    expect(listPromptTemplateVariables("review").map((definition) => definition.key)).not.toContain(
      "reviewSummary",
    );
    expect(listPromptTemplateVariables("reReview").map((definition) => definition.key)).toEqual(
      expect.arrayContaining([
        "ticketId",
        "ticketTitle",
        "ticketDescription",
        "acceptanceCriteria",
        "worktree",
        "projectTitle",
        "projectPath",
        "commitDiff",
        "reviewIteration",
        "reviewSummary",
      ]),
    );
    expect(
      listPromptTemplateVariables("reReview").map((definition) => definition.key),
    ).not.toContain("reviewComments");
    expect(listPromptTemplateVariables("resume").map((definition) => definition.key)).toEqual(
      expect.arrayContaining([
        "ticketId",
        "ticketTitle",
        "ticketDescription",
        "acceptanceCriteria",
        "worktree",
        "projectTitle",
        "projectPath",
      ]),
    );
    expect(listPromptTemplateVariables("resume").map((definition) => definition.key)).not.toContain(
      "commitDiff",
    );
    expect(
      listPromptTemplateVariables("resumeFreshAgent").map((definition) => definition.key),
    ).toEqual(
      expect.arrayContaining([
        "ticketId",
        "ticketTitle",
        "ticketDescription",
        "acceptanceCriteria",
        "worktree",
        "projectTitle",
        "projectPath",
      ]),
    );
    expect(
      listPromptTemplateVariables("resumeFreshAgent").map((definition) => definition.key),
    ).not.toContain("commitDiff");
  });

  it("normalizes aliases to canonical keys", () => {
    expect(normalizePromptTemplateVariableReference("ticketIdentifier")).toBe("ticketId");
    expect(normalizePromptTemplateVariableReference("ticketName")).toBe("ticketTitle");
    expect(normalizePromptTemplateVariableReference("diff")).toBe("commitDiff");
    expect(normalizePromptTemplateVariableReference("missing")).toBeNull();
  });
});

describe("orchestration prompt resolution", () => {
  it("resolves project overrides over current global prompts over shipped defaults", () => {
    const resolved = resolveOrchestrationPromptDocuments({
      globalPrompts: {
        review: {
          version: 1,
          blocks: [{ when: null, text: "Global review ${ticketId}" }],
        },
      },
      projectOverrides: {
        implement: {
          version: 1,
          blocks: [{ when: null, text: "Project implement ${ticketId}" }],
        },
      },
    });

    expect(resolved.implement).toEqual({
      version: 1,
      blocks: [{ when: null, text: "Project implement ${ticketId}" }],
    });
    expect(resolved.review).toEqual({
      version: 1,
      blocks: [{ when: null, text: "Global review ${ticketId}" }],
    });
    expect(resolved.resume).toEqual(ORCHESTRATION_PROMPT_DEFAULTS.resume);
  });

  it("resolves run overrides over project overrides over global", () => {
    const resolved = resolveOrchestrationPromptDocuments({
      globalPrompts: {
        implement: {
          version: 1,
          blocks: [{ when: null, text: "Global implement" }],
        },
      },
      projectOverrides: {
        implement: {
          version: 1,
          blocks: [{ when: null, text: "Project implement" }],
        },
      },
      runOverrides: {
        implement: {
          version: 1,
          blocks: [{ when: null, text: "Run implement" }],
        },
      },
    });

    expect(resolved.implement).toEqual({
      version: 1,
      blocks: [{ when: null, text: "Run implement" }],
    });
    expect(resolved.resume).toEqual(ORCHESTRATION_PROMPT_DEFAULTS.resume);
  });

  it("applies sparse override patches and removes cleared prompt ids", () => {
    const next = applyOrchestrationPromptOverridePatch({
      current: {
        implement: {
          version: 1,
          blocks: [{ when: null, text: "Project implement ${ticketId}" }],
        },
        review: {
          version: 1,
          blocks: [{ when: null, text: "Project review ${ticketId}" }],
        },
      },
      patch: {
        implement: null,
        reviewFeedback: {
          version: 1,
          blocks: [{ when: null, text: "Project feedback ${ticketId}" }],
        },
      },
    });

    expect(next).toEqual({
      review: {
        version: 1,
        blocks: [{ when: null, text: "Project review ${ticketId}" }],
      },
      reviewFeedback: {
        version: 1,
        blocks: [{ when: null, text: "Project feedback ${ticketId}" }],
      },
    });
    expect(hasOrchestrationPromptOverrides(next)).toBe(true);
    expect(hasOrchestrationPromptOverrides({})).toBe(false);
  });
});

describe("validatePromptTemplateDocument", () => {
  it("normalizes aliases in interpolation tokens and conditions", () => {
    const result = validatePromptTemplateDocument({
      promptId: "review",
      document: {
        version: 1,
        blocks: [
          {
            when: {
              type: "exists",
              variable: "diff",
            },
            text: "Review ${ticketIdentifier}: ${ticketName}\n${diff}\n${reviewIteration}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      document: {
        version: 1,
        blocks: [
          {
            when: {
              type: "exists",
              variable: "commitDiff",
            },
            text: "Review ${ticketId}: ${ticketTitle}\n${commitDiff}\n${reviewIteration}",
          },
        ],
      },
      referencedVariables: ["ticketId", "ticketTitle", "commitDiff", "reviewIteration"],
    });
  });

  it("accepts shared ticket and project variables for resume prompts", () => {
    const result = validatePromptTemplateDocument({
      promptId: "resume",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Resume ${ticketIdentifier} in ${projectTitle} @ ${projectPath}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Resume ${ticketId} in ${projectTitle} @ ${projectPath}",
          },
        ],
      },
      referencedVariables: ["ticketId", "projectTitle", "projectPath"],
    });
  });

  it("accepts shared ticket and project variables for resumeFreshAgent prompts", () => {
    const result = validatePromptTemplateDocument({
      promptId: "resumeFreshAgent",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Take over ${ticketIdentifier} in ${projectTitle} @ ${projectPath}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Take over ${ticketId} in ${projectTitle} @ ${projectPath}",
          },
        ],
      },
      referencedVariables: ["ticketId", "projectTitle", "projectPath"],
    });
  });

  it("accepts reReview-specific variables", () => {
    const result = validatePromptTemplateDocument({
      promptId: "reReview",
      document: {
        version: 1,
        blocks: [
          {
            when: { type: "exists", variable: "reviewSummary" },
            text: "Re-review ${ticketId}\n${reviewSummary}\n${commitDiff}\n${reviewIteration}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      document: {
        version: 1,
        blocks: [
          {
            when: { type: "exists", variable: "reviewSummary" },
            text: "Re-review ${ticketId}\n${reviewSummary}\n${commitDiff}\n${reviewIteration}",
          },
        ],
      },
      referencedVariables: ["ticketId", "reviewSummary", "commitDiff", "reviewIteration"],
    });
  });

  it("rejects invalid versions", () => {
    const result = validatePromptTemplateDocument({
      promptId: "implement",
      document: {
        version: 2,
        blocks: [],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "invalid_version",
          path: ["version"],
          blockIndex: null,
        }),
      ],
    });
  });

  it("rejects malformed interpolation tokens", () => {
    const result = validatePromptTemplateDocument({
      promptId: "implement",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Broken ${ticketId",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "malformed_interpolation_token",
          blockIndex: 0,
          token: "${ticketId",
        }),
      ],
    });
  });

  it("rejects unknown variables", () => {
    const result = validatePromptTemplateDocument({
      promptId: "review",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Hello ${whoEvenIsThis}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "unknown_variable",
          blockIndex: 0,
          variable: "whoEvenIsThis",
          token: "${whoEvenIsThis}",
        }),
      ],
    });
  });

  it("rejects variables that are not allowed for a prompt", () => {
    const result = validatePromptTemplateDocument({
      promptId: "implement",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Implement using ${reviewSummary}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "variable_not_allowed",
          blockIndex: 0,
          variable: "reviewSummary",
        }),
      ],
    });
  });

  it("rejects reviewFeedback-only variables in reReview prompts", () => {
    const result = validatePromptTemplateDocument({
      promptId: "reReview",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
            text: "Re-review using ${reviewComments}",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "variable_not_allowed",
          blockIndex: 0,
          variable: "reviewComments",
        }),
      ],
    });
  });

  it("rejects invalid block shapes", () => {
    const result = validatePromptTemplateDocument({
      promptId: "implement",
      document: {
        version: 1,
        blocks: [
          {
            when: null,
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "invalid_block",
          blockIndex: 0,
          path: ["blocks", "0", "text"],
        }),
      ],
    });
  });

  it("rejects invalid conditions", () => {
    const result = validatePromptTemplateDocument({
      promptId: "reviewFeedback",
      document: {
        version: 1,
        blocks: [
          {
            when: {
              type: "equals",
              variable: "reviewSummary",
            },
            text: "Hello",
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "invalid_condition",
          blockIndex: 0,
          path: ["blocks", "0", "when"],
        }),
      ],
    });
  });

  it("accepts all built-in defaults", () => {
    for (const [promptId, document] of Object.entries(ORCHESTRATION_PROMPT_DEFAULTS)) {
      expect(validatePromptTemplateDocument({ promptId: promptId as never, document })).toEqual(
        expect.objectContaining({
          ok: true,
          document,
        }),
      );
    }
  });
});

describe("runtime conditions", () => {
  const RUNTIMES = {
    devElectron: { isDev: true, isElectron: true },
    devWeb: { isDev: true, isElectron: false },
    prodElectron: { isDev: false, isElectron: true },
    prodWeb: { isDev: false, isElectron: false },
  } as const;

  it("validates admin prompts with runtime conditions", () => {
    const result = validatePromptTemplateDocument({
      groupId: "admin",
      promptId: "browser",
      document: {
        version: 1,
        blocks: [
          { when: null, text: "Always block." },
          { when: { type: "runtime", match: "devElectron" }, text: "Dev electron block." },
          { when: { type: "runtime", match: "anyDev" }, text: "Any dev block." },
        ],
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects exists conditions on admin prompts", () => {
    const result = validatePromptTemplateDocument({
      groupId: "admin",
      promptId: "browser",
      document: {
        version: 1,
        blocks: [{ when: { type: "exists", variable: "ticketId" }, text: "nope" }],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "invalid_condition",
          blockIndex: 0,
        }),
      ],
    });
  });

  it("rejects runtime conditions on orchestration prompts", () => {
    const result = validatePromptTemplateDocument({
      groupId: "orchestration",
      promptId: "implement",
      document: {
        version: 1,
        blocks: [{ when: { type: "runtime", match: "devElectron" }, text: "nope" }],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "invalid_condition",
          blockIndex: 0,
        }),
      ],
    });
  });

  it("rejects unknown runtime match values on admin prompts", () => {
    const result = validatePromptTemplateDocument({
      groupId: "admin",
      promptId: "browser",
      document: {
        version: 1,
        blocks: [{ when: { type: "runtime", match: "bogus" }, text: "nope" }],
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "invalid_condition",
          blockIndex: 0,
        }),
      ],
    });
  });

  it("renders runtime blocks matching the current runtime", () => {
    const doc = {
      version: 1 as const,
      blocks: [
        { when: null, text: "[always]" },
        { when: { type: "runtime" as const, match: "devElectron" as const }, text: "[devE]" },
        { when: { type: "runtime" as const, match: "devWeb" as const }, text: "[devW]" },
        { when: { type: "runtime" as const, match: "prodElectron" as const }, text: "[prodE]" },
        { when: { type: "runtime" as const, match: "prodWeb" as const }, text: "[prodW]" },
        { when: { type: "runtime" as const, match: "anyDev" as const }, text: "[anyDev]" },
        { when: { type: "runtime" as const, match: "anyElectron" as const }, text: "[anyE]" },
      ],
    };

    expect(renderPromptTemplate(doc, {}, { runtime: RUNTIMES.devElectron })).toBe(
      "[always][devE][anyDev][anyE]",
    );
    expect(renderPromptTemplate(doc, {}, { runtime: RUNTIMES.devWeb })).toBe(
      "[always][devW][anyDev]",
    );
    expect(renderPromptTemplate(doc, {}, { runtime: RUNTIMES.prodElectron })).toBe(
      "[always][prodE][anyE]",
    );
    expect(renderPromptTemplate(doc, {}, { runtime: RUNTIMES.prodWeb })).toBe(
      "[always][prodW]",
    );
  });

  it("drops runtime blocks when runtime context is missing", () => {
    const doc = {
      version: 1 as const,
      blocks: [
        { when: null, text: "[always]" },
        { when: { type: "runtime" as const, match: "anyDev" as const }, text: "[anyDev]" },
      ],
    };

    expect(renderPromptTemplate(doc, {})).toBe("[always]");
  });
});

describe("renderPromptTemplate", () => {
  it("renders blocks in order and skips exists blocks with missing values", () => {
    const text = renderPromptTemplate(
      {
        version: 1,
        blocks: [
          {
            when: null,
            text: "A:${ticketId}",
          },
          {
            when: { type: "exists", variable: "acceptanceCriteria" },
            text: "|B:${acceptanceCriteria}",
          },
          {
            when: null,
            text: "|C:${ticketTitle}",
          },
        ],
      },
      {
        ticketId: "T3CO-32",
        ticketTitle: "Prompt templates",
        acceptanceCriteria: "",
      },
    );

    expect(text).toBe("A:T3CO-32|C:Prompt templates");
  });

  it("renders exists blocks when values are present", () => {
    const text = renderPromptTemplate(
      {
        version: 1,
        blocks: [
          {
            when: { type: "exists", variable: "reviewComments" },
            text: "Comments:\n${reviewComments}",
          },
        ],
      },
      {
        reviewComments: "- [critical] src/file.ts:10 - Fix this",
      },
    );

    expect(text).toBe("Comments:\n- [critical] src/file.ts:10 - Fix this");
  });
});
