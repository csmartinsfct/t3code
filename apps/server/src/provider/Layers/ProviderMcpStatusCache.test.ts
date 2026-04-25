import { ProjectId, type ProviderKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderMcpStatusCache } from "../Services/ProviderMcpStatusCache.ts";
import { ProviderMcpStatusCacheLive } from "./ProviderMcpStatusCache.ts";

vi.mock("../claudeProfileDiscovery.ts", async () => {
  const { Effect } = await import("effect");
  return {
    discoverClaudeProfiles: () => Effect.succeed([]),
  };
});

const PROJECT_ID = ProjectId.makeUnsafe("project-cache-test");
const CWD = "/tmp/project-cache-test";

function makeLayer(input?: {
  readonly probe?: (request: {
    readonly provider: ProviderKind;
    readonly reloadPlugins?: boolean;
  }) => Effect.Effect<readonly [{ readonly name: string }]>;
  readonly settings?: Record<string, unknown>;
}) {
  const probe = vi.fn(
    (request: { readonly provider: ProviderKind; readonly reloadPlugins?: boolean }) =>
      input?.probe
        ? input.probe(request)
        : Effect.succeed([{ name: `${request.provider}-mcp` }] as const),
  );
  const settings = input?.settings ?? {
    providers: {
      claudeAgent: {
        enabled: true,
      },
      claudeProfiles: [
        {
          profileId: "design",
          displayName: "Design",
          enabled: true,
          binaryPath: "",
          configDir: "",
          customModels: [],
        },
        {
          profileId: "disabled",
          displayName: "Disabled",
          enabled: false,
          binaryPath: "",
          configDir: "",
          customModels: [],
        },
      ],
    },
  };

  const layer = ProviderMcpStatusCacheLive.pipe(
    Layer.provideMerge(ServerSettingsService.layerTest(settings)),
    Layer.provideMerge(
      Layer.succeed(ProviderService, {
        startSession: () => Effect.die(new Error("not mocked")),
        sendTurn: () => Effect.die(new Error("not mocked")),
        interruptTurn: () => Effect.void,
        respondToRequest: () => Effect.die(new Error("not mocked")),
        respondToUserInput: () => Effect.die(new Error("not mocked")),
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([]),
        getCapabilities: () => Effect.die(new Error("not mocked")),
        rollbackConversation: () => Effect.die(new Error("not mocked")),
        streamEvents: Stream.empty,
        probeAllRateLimits: () => Effect.succeed([]),
        probeMcpServers: (request) => probe(request),
      }),
    ),
  );

  return { layer, probe };
}

function runWithCache<A>(
  layer: Layer.Layer<ProviderMcpStatusCache>,
  effect: Effect.Effect<A, never, ProviderMcpStatusCache>,
): Promise<A> {
  return Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))));
}

describe("ProviderMcpStatusCacheLive", () => {
  it("creates loading snapshots for enabled Claude profiles and excludes disabled profiles", async () => {
    const { layer } = makeLayer();

    const result = await runWithCache(
      layer,
      Effect.gen(function* () {
        const cache = yield* ProviderMcpStatusCache;
        return yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent",
        });
      }),
    );

    expect(result.snapshots.map((snapshot) => snapshot.provider)).toEqual([
      "claudeAgent",
      "claudeAgent:design",
    ]);
    expect(result.snapshots.every((snapshot) => snapshot.status === "loading")).toBe(true);
  });

  it("uses enabled profiles even when base Claude is disabled in settings", async () => {
    const { layer } = makeLayer({
      settings: {
        providers: {
          claudeAgent: {
            enabled: false,
          },
          claudeProfiles: [
            {
              profileId: "metric",
              displayName: "Metric",
              enabled: true,
              binaryPath: "",
              configDir: "/tmp/claude-metric",
              customModels: [],
            },
          ],
        },
      },
    });

    const result = await runWithCache(
      layer,
      Effect.gen(function* () {
        const cache = yield* ProviderMcpStatusCache;
        return yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent:metric",
        });
      }),
    );

    expect(result.selected.provider).toBe("claudeAgent:metric");
    expect(result.selected.status).toBe("loading");
    expect(result.snapshots.map((snapshot) => snapshot.provider)).toEqual(["claudeAgent:metric"]);
  });

  it("shares one in-flight refresh for concurrent project requests", async () => {
    const { layer, probe } = makeLayer();

    await runWithCache(
      layer,
      Effect.gen(function* () {
        const cache = yield* ProviderMcpStatusCache;
        yield* Effect.all(
          [
            cache.ensureClaudeProject({
              projectId: PROJECT_ID,
              cwd: CWD,
              selectedProvider: "claudeAgent",
            }),
            cache.ensureClaudeProject({
              projectId: PROJECT_ID,
              cwd: CWD,
              selectedProvider: "claudeAgent:design",
            }),
          ],
          { concurrency: "unbounded" },
        );
        yield* Effect.sleep(20);
      }),
    );

    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls.map(([request]) => request.provider).toSorted()).toEqual([
      "claudeAgent",
      "claudeAgent:design",
    ]);
  });

  it("forceRefresh bypasses the fresh snapshot TTL", async () => {
    const { layer, probe } = makeLayer();

    await runWithCache(
      layer,
      Effect.gen(function* () {
        const cache = yield* ProviderMcpStatusCache;
        yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent",
        });
        yield* Effect.sleep(20);
        yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent",
        });
        yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent",
          forceRefresh: true,
        });
        yield* Effect.sleep(20);
      }),
    );

    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("passes reloadPlugins to provider probes on forceRefresh", async () => {
    const { layer, probe } = makeLayer();

    await runWithCache(
      layer,
      Effect.gen(function* () {
        const cache = yield* ProviderMcpStatusCache;
        yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent",
        });
        yield* Effect.sleep(20);
        yield* cache.ensureClaudeProject({
          projectId: PROJECT_ID,
          cwd: CWD,
          selectedProvider: "claudeAgent",
          forceRefresh: true,
        });
        yield* Effect.sleep(20);
      }),
    );

    expect(probe.mock.calls.some(([request]) => request.reloadPlugins === true)).toBe(true);
  });
});
