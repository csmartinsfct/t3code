import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });

      assert.deepEqual(decodePatch({ maxReviewIterations: 0 }), {
        maxReviewIterations: 0,
      });

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }),
        {
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        },
      );
    }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: {
            fastMode: false,
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        configDir: "",
        customModels: ["claude-custom"],
      });
      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: {
          reasoningEffort: "high",
          fastMode: false,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            effort: "high",
          },
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "high",
          },
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "high",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        configDir: "",
        customModels: [],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        maxReviewIterations: 5,
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        maxReviewIterations: 5,
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "resolves full effective orchestration prompts while keeping shipped defaults immutable",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;

        const next = yield* serverSettings.updateSettings({
          prompts: {
            orchestration: {
              implement: {
                version: 1,
                blocks: [
                  {
                    when: null,
                    text: "Custom implement ${ticketId}",
                  },
                ],
              },
            },
          },
        });

        assert.deepEqual(next.prompts.orchestration.implement, {
          version: 1,
          blocks: [
            {
              when: null,
              text: "Custom implement ${ticketId}",
            },
          ],
        });
        assert.deepEqual(
          next.prompts.orchestration.resume,
          DEFAULT_SERVER_SETTINGS.prompts.orchestration.resume,
        );
        assert.deepEqual(
          next.prompts.orchestration.resumeFreshAgent,
          DEFAULT_SERVER_SETTINGS.prompts.orchestration.resumeFreshAgent,
        );
        assert.deepEqual(
          next.promptDefaults.orchestration,
          DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration,
        );
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "resets orchestration prompts back to shipped defaults when a prompt id is set to null",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;

        yield* serverSettings.updateSettings({
          prompts: {
            orchestration: {
              reviewFeedback: {
                version: 1,
                blocks: [
                  {
                    when: null,
                    text: "Custom feedback ${ticketId}",
                  },
                ],
              },
            },
          },
        });

        const next = yield* serverSettings.updateSettings({
          prompts: {
            orchestration: {
              reviewFeedback: null,
            },
          },
        });

        assert.deepEqual(
          next.prompts.orchestration.reviewFeedback,
          DEFAULT_SERVER_SETTINGS.prompts.orchestration.reviewFeedback,
        );
        assert.deepEqual(
          next.prompts.orchestration.reReview,
          DEFAULT_SERVER_SETTINGS.prompts.orchestration.reReview,
        );
        assert.deepEqual(
          next.promptDefaults.orchestration.reviewFeedback,
          DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration.reviewFeedback,
        );
        assert.deepEqual(
          next.promptDefaults.orchestration.reReview,
          DEFAULT_SERVER_SETTINGS.promptDefaults.orchestration.reReview,
        );
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists prompt documents atomically instead of writing partial prompt objects", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      yield* serverSettings.updateSettings({
        prompts: {
          orchestration: {
            review: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Custom review ${ticketId}",
                },
              ],
            },
          },
        },
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        prompts: {
          orchestration: {
            review: {
              version: 1,
              blocks: [
                {
                  when: null,
                  text: "Custom review ${ticketId}",
                },
              ],
            },
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
