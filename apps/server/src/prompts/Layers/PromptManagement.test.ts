import { DEFAULT_SERVER_SETTINGS, type OrchestrationCommand, ProjectId } from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { PromptManagementService } from "../Services/PromptManagement.ts";
import { PromptManagementLive } from "./PromptManagement.ts";

const projectId = ProjectId.makeUnsafe("project-prompts");
const now = "2026-04-10T10:00:00.000Z";

const makeProject = (
  promptOverrides: {
    readonly orchestration: Record<string, unknown>;
  } = { orchestration: {} },
) => ({
  id: projectId,
  title: "Prompt Project",
  workspaceRoot: "/tmp/prompt-project",
  defaultModelSelection: {
    provider: "codex" as const,
    model: "gpt-5-codex",
  },
  systemPrompt: null,
  promptOverrides,
  scripts: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

const makeSnapshot = (
  promptOverrides: {
    readonly orchestration: Record<string, unknown>;
  } = { orchestration: {} },
) => ({
  snapshotSequence: 0,
  updatedAt: now,
  projects: [makeProject(promptOverrides)],
  threads: [],
});

function makePromptManagementLayer(options?: {
  settingsOverrides?: Parameters<typeof ServerSettingsService.layerTest>[0];
  getSnapshot?: () => ReturnType<typeof makeSnapshot>;
  dispatch?: (command: OrchestrationCommand) => Effect.Effect<{ sequence: number }>;
}) {
  return PromptManagementLive.pipe(
    Layer.provide(ServerSettingsService.layerTest(options?.settingsOverrides ?? {})),
    Layer.provide(
      Layer.succeed(ProjectionSnapshotQuery, {
        getSnapshot: () => Effect.succeed(options?.getSnapshot?.() ?? makeSnapshot()),
        getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 0 }),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      }),
    ),
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        getReadModel: () => Effect.succeed(makeSnapshot()),
        readEvents: () => Stream.empty,
        dispatch:
          options?.dispatch ??
          (() =>
            Effect.succeed({
              sequence: 1,
            })),
        streamDomainEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.succeed(ServerRuntimeStartup, {
        awaitCommandReady: Effect.void,
        markHttpListening: Effect.void,
        enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) => effect,
      }),
    ),
  );
}

describe("PromptManagementLive", () => {
  it("lists resumeFreshAgent as an orchestration prompt definition", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const promptManagement = yield* PromptManagementService;
        return yield* promptManagement.listPromptDefinitions({
          scope: "global",
        });
      }).pipe(Effect.provide(makePromptManagementLayer())),
    );

    expect(
      result.definitions.find((definition) => definition.promptId === "resumeFreshAgent"),
    ).toMatchObject({
      groupId: "orchestration",
      promptId: "resumeFreshAgent",
      label: "Resume Fresh Agent",
      description: expect.stringContaining("fresh agent session"),
    });
  });

  it("returns effective project override state with global fallback metadata", async () => {
    const globalDocument = {
      version: 1,
      blocks: [{ when: null, text: "Global implement ${ticketId}" }],
    } as const;
    const projectDocument = {
      version: 1,
      blocks: [{ when: null, text: "Project implement ${ticketId} @ ${worktree}" }],
    } as const;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const promptManagement = yield* PromptManagementService;
        return yield* promptManagement.getPromptDocument({
          scope: "project",
          projectId,
          promptId: "implement",
        });
      }).pipe(
        Effect.provide(
          makePromptManagementLayer({
            settingsOverrides: {
              prompts: { orchestration: { implement: globalDocument } },
            },
            getSnapshot: () =>
              makeSnapshot({
                orchestration: {
                  implement: projectDocument,
                },
              }),
          }),
        ),
      ),
    );

    expect(result.scopeState).toBe("overridden");
    expect(result.effectiveSource).toBe("project_override");
    expect(result.globalDocument).toEqual(globalDocument);
    expect(result.projectOverrideDocument).toEqual(projectDocument);
    expect(result.effectiveDocument).toEqual(projectDocument);
  });

  it("validates and normalizes alias-based prompt documents", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const promptManagement = yield* PromptManagementService;
        return yield* promptManagement.validatePromptDocument({
          scope: "global",
          promptId: "review",
          document: {
            version: 1,
            blocks: [
              {
                when: { type: "exists", variable: "diff" },
                text: "Review ${ticketIdentifier}: ${ticketName}\n${diff}\n${reviewIteration}",
              },
            ],
          },
        });
      }).pipe(Effect.provide(makePromptManagementLayer())),
    );

    expect(result).toEqual({
      scope: { scope: "global" },
      promptId: "review",
      ok: true,
      document: {
        version: 1,
        blocks: [
          {
            when: { type: "exists", variable: "commitDiff" },
            text: "Review ${ticketId}: ${ticketTitle}\n${commitDiff}\n${reviewIteration}",
          },
        ],
      },
      referencedVariables: ["ticketId", "ticketTitle", "commitDiff", "reviewIteration"],
      errors: [],
    });
  });

  it("renders deterministic preview output for the effective document", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const promptManagement = yield* PromptManagementService;
        return yield* promptManagement.previewPromptDocument({
          scope: "global",
          promptId: "implement",
        });
      }).pipe(Effect.provide(makePromptManagementLayer())),
    );

    expect(result.previewDataLabel).toBe("representative-sample-v1");
    expect(result.previewText).toContain(
      "Work on ticket Prompt metadata, validation, preview, and explicit management APIs - T3CO-36.",
    );
    expect(result.previewText).toContain("Worktree: prompt-management-preview.");
    expect(result.previewVariables).toEqual([
      {
        key: "ticketTitle",
        value: "Prompt metadata, validation, preview, and explicit management APIs",
      },
      { key: "ticketId", value: "T3CO-36" },
      { key: "worktree", value: "prompt-management-preview" },
    ]);
  });

  it("updates and resets global prompt documents through server settings", async () => {
    const customDocument = {
      version: 1,
      blocks: [{ when: null, text: "Handle ${ticketId} for ${projectTitle}" }],
    } as const;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const promptManagement = yield* PromptManagementService;
        const updated = yield* promptManagement.updatePromptDocument({
          scope: "global",
          promptId: "implement",
          document: customDocument,
        });
        const reset = yield* promptManagement.updatePromptDocument({
          scope: "global",
          promptId: "implement",
          document: null,
        });
        return { updated, reset };
      }).pipe(Effect.provide(makePromptManagementLayer())),
    );

    expect(result.updated.scopeState).toBe("customized");
    expect(result.updated.globalDocument).toEqual(customDocument);
    expect(result.updated.effectiveDocument).toEqual(customDocument);
    expect(result.reset.scopeState).toBe("default");
    expect(result.reset.globalDocument).toEqual(
      DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration.implement,
    );
    expect(result.reset.effectiveDocument).toEqual(
      DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration.implement,
    );
  });

  it("updates and clears project overrides through orchestration commands", async () => {
    let projectOverrides: Record<string, unknown> = {};
    const dispatchedCommands: OrchestrationCommand[] = [];

    const dispatch = vi.fn((command: OrchestrationCommand) =>
      Effect.sync(() => {
        dispatchedCommands.push(command);
        if (command.type === "project.meta.update") {
          for (const [promptId, value] of Object.entries(
            command.promptOverrides?.orchestration ?? {},
          )) {
            if (value === null) {
              delete projectOverrides[promptId];
              continue;
            }
            projectOverrides[promptId] = value;
          }
        }

        return { sequence: dispatchedCommands.length };
      }),
    );

    const customDocument = {
      version: 1,
      blocks: [{ when: null, text: "Project override ${ticketId}" }],
    } as const;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const promptManagement = yield* PromptManagementService;
        const updated = yield* promptManagement.updatePromptDocument({
          scope: "project",
          projectId,
          promptId: "implement",
          document: customDocument,
        });
        const reset = yield* promptManagement.updatePromptDocument({
          scope: "project",
          projectId,
          promptId: "implement",
          document: null,
        });
        return { updated, reset };
      }).pipe(
        Effect.provide(
          makePromptManagementLayer({
            getSnapshot: () =>
              makeSnapshot({
                orchestration: projectOverrides,
              }),
            dispatch,
          }),
        ),
      ),
    );

    expect(result.updated.scopeState).toBe("overridden");
    expect(result.updated.projectOverrideDocument).toEqual(customDocument);
    expect(result.updated.effectiveSource).toBe("project_override");
    expect(result.reset.scopeState).toBe("inherited");
    expect(result.reset.projectOverrideDocument).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatchedCommands.every((command) => command.type === "project.meta.update")).toBe(
      true,
    );
  });

  it("rejects invalid updates before persisting them", async () => {
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const promptManagement = yield* PromptManagementService;
          return yield* promptManagement.updatePromptDocument({
            scope: "project",
            projectId,
            promptId: "implement",
            document: {
              version: 2,
              blocks: [],
            },
          });
        }).pipe(Effect.provide(makePromptManagementLayer({ dispatch }))),
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
