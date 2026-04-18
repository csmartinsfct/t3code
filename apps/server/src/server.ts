import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config";
import { attachmentsRouteLayer, projectFaviconRouteLayer, staticAndDevRouteLayer } from "./http";
import { managedRunsRouteLayer } from "./managedRuns/http";
import { fixPath } from "./os-jank";
import { websocketRpcRouteLayer } from "./ws";
import { OpenLive } from "./open";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { makeEventNdjsonLogger } from "./provider/Layers/EventNdjsonLogger";
import { makeProviderLifecycleLogger } from "./provider/Layers/ProviderLifecycleLogger";
import {
  ProviderLifecycleLogger,
  noopProviderLifecycleLogger,
} from "./provider/Services/ProviderLifecycleLogger";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import { makeClaudeAdapterLive } from "./provider/Layers/ClaudeAdapter";
import { makeGeminiAdapterLive } from "./provider/Layers/GeminiAdapter";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitHubCliLive } from "./git/Layers/GitHubCli";
import { RoutingTextGenerationLive } from "./git/Layers/RoutingTextGeneration";
import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { GitManagerLive } from "./git/Layers/GitManager";
import { KeybindingsLive } from "./keybindings";
import { ServerRuntimeStartup, ServerRuntimeStartupLive } from "./serverRuntimeStartup";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry";
import { ProviderRateLimitsCacheLive } from "./provider/Layers/ProviderRateLimitsCache";
import { ServerSettingsLive } from "./serverSettings";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { RepoDiscoveryLive } from "./workspace/Layers/RepoDiscovery";
import { WorkspaceEntriesLive } from "./workspace/Layers/WorkspaceEntries";
import { WorkspaceFileSystemLive } from "./workspace/Layers/WorkspaceFileSystem";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths";
import { ObservabilityLive } from "./observability/Layers/Observability";
import { ManagedRunRepositoryLive } from "./persistence/Layers/ManagedRuns";
import { ManagedRunServiceLive } from "./managedRuns/Layers/ManagedRuns";
import { ManagedRunInferenceLive } from "./managedRuns/Layers/Inference";
import { ScheduledTaskRepositoryLive } from "./persistence/Layers/ScheduledTasks";
import { ScheduledTaskServiceLive } from "./scheduledTasks/Layers/ScheduledTasks";
import { scheduledTasksRouteLayer } from "./scheduledTasks/http";
import { TicketingRepositoryLive } from "./persistence/Layers/Ticketing";
import { TicketThreadLinkRepositoryLive } from "./persistence/Layers/TicketThreadLinks";
import { TicketingServiceLive } from "./ticketing/Layers/Ticketing";
import { ticketingRouteLayer } from "./ticketing/http";
import { PromptManagementLive } from "./prompts/Layers/PromptManagement";
import { promptsRouteLayer } from "./prompts/http";
import { SessionRestartServiceLive } from "./sessionRestart/Layers/SessionRestart";
import { sessionRestartRouteLayer } from "./sessionRestart/http";
import { OrchestrationRunRepositoryLive } from "./persistence/Layers/OrchestrationRuns";
import { ProjectionThreadRepositoryLive } from "./persistence/Layers/ProjectionThreads";

const PtyAdapterLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const BunPTY = yield* Effect.promise(() => import("./terminal/Layers/BunPTY"));
      return BunPTY.layer;
    } else {
      const NodePTY = yield* Effect.promise(() => import("./terminal/Layers/NodePTY"));
      return NodePTY.layer;
    }
  }),
);

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (typeof Bun !== "undefined") {
      const BunHttpServer = yield* Effect.promise(
        () => import("@effect/platform-bun/BunHttpServer"),
      );
      return BunHttpServer.layer({
        port: config.port,
        ...(config.host ? { hostname: config.host } : {}),
      });
    } else {
      const [NodeHttpServer, NodeHttp] = yield* Effect.all([
        Effect.promise(() => import("@effect/platform-node/NodeHttpServer")),
        Effect.promise(() => import("node:http")),
      ]);
      return NodeHttpServer.layer(NodeHttp.createServer, {
        host: config.host,
        port: config.port,
      });
    }
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-bun/BunServices"));
      return layer;
    } else {
      const { layer } = yield* Effect.promise(() => import("@effect/platform-node/NodeServices"));
      return layer;
    }
  }),
);

const PersistenceLayerLive = Layer.empty.pipe(Layer.provideMerge(SqlitePersistenceLayerLive));

const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
);

const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
);

const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
).pipe(Layer.provide(PersistenceLayerLive));

const OrchestrationEngineLayerLive = OrchestrationEngineLive.pipe(
  Layer.provide(OrchestrationInfrastructureLayerLive),
  Layer.provide(PersistenceLayerLive),
);

const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLayerLive,
);

const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQueryLive),
  Layer.provideMerge(CheckpointStoreLive),
);

const ProviderLayerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { providerEventLogPath, providerLogsDir } = yield* ServerConfig;
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const lifecycleLogger =
      (yield* makeProviderLifecycleLogger(providerLogsDir)) ?? noopProviderLifecycleLogger;
    const lifecycleLoggerLayer = Layer.succeed(ProviderLifecycleLogger, lifecycleLogger);
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const snapshotQueryDeps = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(PersistenceLayerLive),
    );
    const managedRunDeps = ManagedRunServiceLive.pipe(
      Layer.provide(ManagedRunInferenceLive),
      Layer.provide(ManagedRunRepositoryLive),
      Layer.provide(TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive))),
      Layer.provide(snapshotQueryDeps),
      Layer.provide(PersistenceLayerLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    ).pipe(Layer.provide(managedRunDeps), Layer.provide(snapshotQueryDeps));
    const claudeAdapterLayer = makeClaudeAdapterLive(
      nativeEventLogger ? { nativeEventLogger, lifecycleLogger } : { lifecycleLogger },
    ).pipe(Layer.provide(managedRunDeps), Layer.provide(snapshotQueryDeps));
    const geminiAdapterLayer = makeGeminiAdapterLive().pipe(
      Layer.provide(managedRunDeps),
      Layer.provide(snapshotQueryDeps),
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeAdapterLayer),
      Layer.provide(geminiAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger, lifecycleLogger } : { lifecycleLogger },
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
      Layer.provideMerge(lifecycleLoggerLayer),
    );
  }),
);

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(
    GitManagerLive.pipe(
      Layer.provideMerge(GitCoreLive),
      Layer.provideMerge(GitHubCliLive),
      Layer.provideMerge(RoutingTextGenerationLive),
    ),
  ),
  Layer.provideMerge(GitCoreLive),
);

const TerminalLayerLive = TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive));

const WorkspaceLayerLive = Layer.mergeAll(
  WorkspacePathsLive,
  WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
  WorkspaceFileSystemLive.pipe(
    Layer.provide(WorkspacePathsLive),
    Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  ),
  RepoDiscoveryLive,
);

const RuntimeCoreServicesLive = Layer.empty.pipe(
  Layer.provideMerge(ServerRuntimeStartupLive),
  Layer.provideMerge(ReactorLayerLive),

  // Core Services
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(
    ManagedRunServiceLive.pipe(
      Layer.provide(ManagedRunInferenceLive),
      Layer.provide(ManagedRunRepositoryLive),
      Layer.provide(TerminalManagerLive.pipe(Layer.provide(PtyAdapterLive))),
      Layer.provide(
        OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provide(PersistenceLayerLive)),
      ),
      Layer.provide(PersistenceLayerLive),
    ),
  ),
  Layer.provideMerge(
    ScheduledTaskServiceLive.pipe(
      Layer.provide(ScheduledTaskRepositoryLive),
      Layer.provide(
        OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provide(PersistenceLayerLive)),
      ),
      Layer.provide(
        OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)),
      ),
      Layer.provide(PersistenceLayerLive),
    ),
  ),
  Layer.provideMerge(
    TicketingServiceLive.pipe(
      Layer.provide(TicketThreadLinkRepositoryLive),
      Layer.provide(ProjectionThreadRepositoryLive),
      Layer.provide(TicketingRepositoryLive),
      Layer.provide(PersistenceLayerLive),
    ),
  ),
  Layer.provideMerge(OrchestrationRunRepositoryLive.pipe(Layer.provide(PersistenceLayerLive))),
  Layer.provideMerge(ProjectionThreadRepositoryLive.pipe(Layer.provide(PersistenceLayerLive))),
  Layer.provideMerge(
    Layer.empty.pipe(
      Layer.provideMerge(KeybindingsLive),
      Layer.provideMerge(ProviderRegistryLive),
      Layer.provideMerge(ProviderRateLimitsCacheLive),
      Layer.provideMerge(ServerSettingsLive),
      Layer.provideMerge(WorkspaceLayerLive),
      Layer.provideMerge(ProjectFaviconResolverLive),
      Layer.provideMerge(AnalyticsServiceLayerLive),
      Layer.provideMerge(OpenLive),
      Layer.provideMerge(ServerLifecycleEventsLive),
    ),
  ),
);

const RuntimeServicesLive = Layer.mergeAll(
  RuntimeCoreServicesLive,
  PromptManagementLive.pipe(Layer.provide(RuntimeCoreServicesLive)),
  SessionRestartServiceLive.pipe(Layer.provide(RuntimeCoreServicesLive)),
);

export const makeRoutesLayer = Layer.mergeAll(
  attachmentsRouteLayer,
  projectFaviconRouteLayer,
  managedRunsRouteLayer,
  scheduledTasksRouteLayer,
  ticketingRouteLayer,
  promptsRouteLayer,
  sessionRestartRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
);

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    fixPath();

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        const startup = yield* ServerRuntimeStartup;
        yield* startup.markHttpListening;
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer,
    );

    return serverApplicationLayer.pipe(
      Layer.provideMerge(RuntimeServicesLive),
      Layer.provideMerge(HttpServerLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
export const runServer = Layer.launch(makeServerLayer);
