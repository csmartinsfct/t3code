import {
  type ScheduledTaskStreamEvent,
  type TicketingStreamEvent,
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type ManagedRunStreamEvent,
  type ListPromptDefinitionsInput,
  type ListPromptDefinitionsResult,
  type NativeApi,
  type OrchestrationEvent,
  type OrchestrationRunStreamEvent,
  ORCHESTRATION_WS_METHODS,
  type PreviewPromptDocumentInput,
  type PreviewPromptDocumentResult,
  type PromptDocumentQueryInput,
  type PromptDocumentState,
  type PromptDocumentValidationResult,
  type ProjectId,
  type ServerSettingsPatch,
  type UpdatePromptDocumentInput,
  type ValidatePromptDocumentInput,
  WS_METHODS,
} from "@t3tools/contracts";
import { summarizeTimelineText } from "@t3tools/shared/timeline";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./rpc/protocol";
import { logWebTimeline } from "./timelineLogger";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

interface OrchestrationDomainEventSubscriptionOptions {
  readonly getFromSequenceExclusive?: () => number | undefined;
}

function summarizeOrchestrationCommand(command: {
  readonly type: string;
  readonly commandId?: string;
  readonly threadId?: string;
  readonly projectId?: string;
  readonly createdAt?: string;
  readonly message?: {
    readonly messageId?: string;
    readonly role?: string;
    readonly text?: string;
    readonly attachments?: ReadonlyArray<unknown>;
  };
}): Record<string, unknown> {
  return {
    type: command.type,
    ...(command.commandId ? { commandId: command.commandId } : {}),
    ...(command.threadId ? { threadId: command.threadId } : {}),
    ...(command.projectId ? { projectId: command.projectId } : {}),
    ...(command.createdAt ? { createdAt: command.createdAt } : {}),
    ...(command.message
      ? {
          messageId: command.message.messageId ?? null,
          messageRole: command.message.role ?? null,
          ...summarizeTimelineText(command.message.text ?? ""),
          attachmentCount: command.message.attachments?.length ?? 0,
        }
      : {}),
  };
}

function summarizeOrchestrationEvent(event: OrchestrationEvent): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;
  return {
    sequence: event.sequence,
    type: event.type,
    aggregateKind: event.aggregateKind,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt,
    ...(typeof payload.threadId === "string" ? { threadId: payload.threadId } : {}),
    ...(typeof payload.turnId === "string" ? { turnId: payload.turnId } : {}),
    ...(typeof payload.messageId === "string" ? { messageId: payload.messageId } : {}),
    ...(typeof payload.role === "string" ? { role: payload.role } : {}),
    ...(typeof payload.streaming === "boolean" ? { streaming: payload.streaming } : {}),
    ...(typeof payload.status === "string" ? { status: payload.status } : {}),
  };
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly enhanceSystemPrompt: RpcUnaryMethod<typeof WS_METHODS.projectsEnhanceSystemPrompt>;
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
    readonly listDirectory: RpcUnaryMethod<typeof WS_METHODS.projectsListDirectory>;
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>;
  };
  readonly prompts: {
    readonly listDefinitions: (
      input: ListPromptDefinitionsInput,
    ) => Promise<ListPromptDefinitionsResult>;
    readonly getDocument: (input: PromptDocumentQueryInput) => Promise<PromptDocumentState>;
    readonly validateDocument: (
      input: ValidatePromptDocumentInput,
    ) => Promise<PromptDocumentValidationResult>;
    readonly previewDocument: (
      input: PreviewPromptDocumentInput,
    ) => Promise<PreviewPromptDocumentResult>;
    readonly updateDocument: (input: UpdatePromptDocumentInput) => Promise<PromptDocumentState>;
  };
  readonly managedRuns: {
    readonly launchProjectScript: RpcUnaryMethod<typeof WS_METHODS.managedRunsLaunchProjectScript>;
    readonly list: RpcUnaryMethod<typeof WS_METHODS.managedRunsList>;
    readonly get: RpcUnaryMethod<typeof WS_METHODS.managedRunsGet>;
    readonly getLogs: RpcUnaryMethod<typeof WS_METHODS.managedRunsGetLogs>;
    readonly listInferenceRecords: RpcUnaryMethod<
      typeof WS_METHODS.managedRunsListInferenceRecords
    >;
    readonly getInferenceRecord: RpcUnaryMethod<typeof WS_METHODS.managedRunsGetInferenceRecord>;
    readonly stop: RpcUnaryMethod<typeof WS_METHODS.managedRunsStop>;
    readonly onEvent: (
      projectId: string,
      listener: (event: ManagedRunStreamEvent) => void,
    ) => () => void;
  };
  readonly scheduledTasks: {
    readonly list: RpcUnaryNoArgMethod<typeof WS_METHODS.scheduledTasksList>;
    readonly get: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksGet>;
    readonly create: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksCreate>;
    readonly update: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksUpdate>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksDelete>;
    readonly toggle: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksToggle>;
    readonly runNow: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksRunNow>;
    readonly listRuns: RpcUnaryMethod<typeof WS_METHODS.scheduledTasksListRuns>;
    readonly onEvent: (listener: (event: ScheduledTaskStreamEvent) => void) => () => void;
  };
  readonly ticketing: {
    readonly list: RpcUnaryMethod<typeof WS_METHODS.ticketingList>;
    readonly getById: RpcUnaryMethod<typeof WS_METHODS.ticketingGetById>;
    readonly getByIdentifier: RpcUnaryMethod<typeof WS_METHODS.ticketingGetByIdentifier>;
    readonly getThreadLinks: RpcUnaryMethod<typeof WS_METHODS.ticketingGetThreadLinks>;
    readonly create: RpcUnaryMethod<typeof WS_METHODS.ticketingCreate>;
    readonly update: RpcUnaryMethod<typeof WS_METHODS.ticketingUpdate>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.ticketingDelete>;
    readonly reorder: RpcUnaryMethod<typeof WS_METHODS.ticketingReorder>;
    readonly search: RpcUnaryMethod<typeof WS_METHODS.ticketingSearch>;
    readonly getTree: RpcUnaryMethod<typeof WS_METHODS.ticketingGetTree>;
    readonly setDependencies: RpcUnaryMethod<typeof WS_METHODS.ticketingSetDependencies>;
    readonly addDependency: RpcUnaryMethod<typeof WS_METHODS.ticketingAddDependency>;
    readonly removeDependency: RpcUnaryMethod<typeof WS_METHODS.ticketingRemoveDependency>;
    readonly updateCriterionStatus: RpcUnaryMethod<
      typeof WS_METHODS.ticketingUpdateCriterionStatus
    >;
    readonly getHistory: RpcUnaryMethod<typeof WS_METHODS.ticketingGetHistory>;
    readonly listLabels: RpcUnaryMethod<typeof WS_METHODS.ticketingListLabels>;
    readonly createLabel: RpcUnaryMethod<typeof WS_METHODS.ticketingCreateLabel>;
    readonly updateLabel: RpcUnaryMethod<typeof WS_METHODS.ticketingUpdateLabel>;
    readonly deleteLabel: RpcUnaryMethod<typeof WS_METHODS.ticketingDeleteLabel>;
    readonly addTicketLabel: RpcUnaryMethod<typeof WS_METHODS.ticketingAddTicketLabel>;
    readonly removeTicketLabel: RpcUnaryMethod<typeof WS_METHODS.ticketingRemoveTicketLabel>;
    readonly listComments: RpcUnaryMethod<typeof WS_METHODS.ticketingListComments>;
    readonly createComment: RpcUnaryMethod<typeof WS_METHODS.ticketingCreateComment>;
    readonly updateComment: RpcUnaryMethod<typeof WS_METHODS.ticketingUpdateComment>;
    readonly deleteComment: RpcUnaryMethod<typeof WS_METHODS.ticketingDeleteComment>;
    readonly listArtifacts: RpcUnaryMethod<typeof WS_METHODS.ticketingListArtifacts>;
    readonly createArtifact: RpcUnaryMethod<typeof WS_METHODS.ticketingCreateArtifact>;
    readonly deleteArtifact: RpcUnaryMethod<typeof WS_METHODS.ticketingDeleteArtifact>;
    readonly listTemplates: RpcUnaryMethod<typeof WS_METHODS.ticketingListTemplates>;
    readonly getTemplate: RpcUnaryMethod<typeof WS_METHODS.ticketingGetTemplate>;
    readonly createTemplate: RpcUnaryMethod<typeof WS_METHODS.ticketingCreateTemplate>;
    readonly updateTemplate: RpcUnaryMethod<typeof WS_METHODS.ticketingUpdateTemplate>;
    readonly deleteTemplate: RpcUnaryMethod<typeof WS_METHODS.ticketingDeleteTemplate>;
    readonly onEvent: (listener: (event: TicketingStreamEvent) => void) => () => void;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<NativeApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<NativeApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<NativeApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly status: RpcUnaryMethod<typeof WS_METHODS.gitStatus>;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
    readonly discoverRepos: RpcUnaryMethod<typeof WS_METHODS.gitDiscoverRepos>;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly resolveMcpServers: RpcUnaryMethod<typeof WS_METHODS.serverResolveMcpServers>;
    readonly resolveCodexProjectTrust: RpcUnaryMethod<
      typeof WS_METHODS.serverResolveCodexProjectTrust
    >;
    readonly trustCodexProject: RpcUnaryMethod<typeof WS_METHODS.serverTrustCodexProject>;
    readonly resolveSkills: RpcUnaryMethod<typeof WS_METHODS.serverResolveSkills>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly getStartupSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getStartupSnapshot
    >;
    readonly getThreadContent: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getThreadContent>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly createRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.createRun>;
    readonly getRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getRun>;
    readonly listRuns: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.listRuns>;
    readonly getChildThreads: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getChildThreads>;
    readonly pauseRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.pauseRun>;
    readonly resumeRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.resumeRun>;
    readonly cancelRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.cancelRun>;
    readonly startRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.startRun>;
    readonly onDomainEvent: (
      listener: (event: OrchestrationEvent) => void,
      options?: OrchestrationDomainEventSubscriptionOptions,
    ) => () => void;
    readonly onRunEvent: (
      projectId: ProjectId,
      listener: (event: OrchestrationRunStreamEvent) => void,
    ) => () => void;
  };
}

let sharedWsRpcClient: WsRpcClient | null = null;

export function getWsRpcClient(): WsRpcClient {
  if (sharedWsRpcClient) {
    return sharedWsRpcClient;
  }
  sharedWsRpcClient = createWsRpcClient();
  return sharedWsRpcClient;
}

export async function __resetWsRpcClientForTests() {
  await sharedWsRpcClient?.dispose();
  sharedWsRpcClient = null;
}

export function createWsRpcClient(transport = new WsTransport()): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeTerminalEvents]({}), listener),
    },
    projects: {
      enhanceSystemPrompt: (input) =>
        transport.request((client) => client[WS_METHODS.projectsEnhanceSystemPrompt](input)),
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
      listDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.projectsListDirectory](input)),
      readFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsReadFile](input)),
    },
    prompts: {
      listDefinitions: (input) =>
        transport.request((client) => client[WS_METHODS.promptsListDefinitions](input)),
      getDocument: (input) =>
        transport.request((client) => client[WS_METHODS.promptsGetDocument](input)),
      validateDocument: (input) =>
        transport.request((client) => client[WS_METHODS.promptsValidateDocument](input)),
      previewDocument: (input) =>
        transport.request((client) => client[WS_METHODS.promptsPreviewDocument](input)),
      updateDocument: (input) =>
        transport.request((client) => client[WS_METHODS.promptsUpdateDocument](input)),
    },
    managedRuns: {
      launchProjectScript: (input) =>
        transport.request((client) => client[WS_METHODS.managedRunsLaunchProjectScript](input)),
      list: (input) => transport.request((client) => client[WS_METHODS.managedRunsList](input)),
      get: (input) => transport.request((client) => client[WS_METHODS.managedRunsGet](input)),
      getLogs: (input) =>
        transport.request((client) => client[WS_METHODS.managedRunsGetLogs](input)),
      listInferenceRecords: (input) =>
        transport.request((client) => client[WS_METHODS.managedRunsListInferenceRecords](input)),
      getInferenceRecord: (input) =>
        transport.request((client) => client[WS_METHODS.managedRunsGetInferenceRecord](input)),
      stop: (input) => transport.request((client) => client[WS_METHODS.managedRunsStop](input)),
      onEvent: (projectId, listener) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeManagedRunEvents]({ projectId } as never),
          listener,
        ),
    },
    scheduledTasks: {
      list: () => transport.request((client) => client[WS_METHODS.scheduledTasksList]({})),
      get: (input) => transport.request((client) => client[WS_METHODS.scheduledTasksGet](input)),
      create: (input) =>
        transport.request((client) => client[WS_METHODS.scheduledTasksCreate](input)),
      update: (input) =>
        transport.request((client) => client[WS_METHODS.scheduledTasksUpdate](input)),
      delete: (input) =>
        transport.request((client) => client[WS_METHODS.scheduledTasksDelete](input)),
      toggle: (input) =>
        transport.request((client) => client[WS_METHODS.scheduledTasksToggle](input)),
      runNow: (input) =>
        transport.request((client) => client[WS_METHODS.scheduledTasksRunNow](input)),
      listRuns: (input) =>
        transport.request((client) => client[WS_METHODS.scheduledTasksListRuns](input)),
      onEvent: (listener) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeScheduledTaskEvents]({}),
          listener,
        ),
    },
    ticketing: {
      list: (input) => transport.request((client) => client[WS_METHODS.ticketingList](input)),
      getById: (input) => transport.request((client) => client[WS_METHODS.ticketingGetById](input)),
      getByIdentifier: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingGetByIdentifier](input)),
      getThreadLinks: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingGetThreadLinks](input)),
      create: (input) => transport.request((client) => client[WS_METHODS.ticketingCreate](input)),
      update: (input) => transport.request((client) => client[WS_METHODS.ticketingUpdate](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.ticketingDelete](input)),
      reorder: (input) => transport.request((client) => client[WS_METHODS.ticketingReorder](input)),
      search: (input) => transport.request((client) => client[WS_METHODS.ticketingSearch](input)),
      getTree: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingGetTree](input)) as never,
      setDependencies: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingSetDependencies](input)),
      addDependency: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingAddDependency](input)),
      removeDependency: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingRemoveDependency](input)),
      updateCriterionStatus: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingUpdateCriterionStatus](input)),
      getHistory: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingGetHistory](input)),
      listLabels: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingListLabels](input)),
      createLabel: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingCreateLabel](input)),
      updateLabel: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingUpdateLabel](input)),
      deleteLabel: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingDeleteLabel](input)),
      addTicketLabel: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingAddTicketLabel](input)),
      removeTicketLabel: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingRemoveTicketLabel](input)),
      listComments: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingListComments](input)),
      createComment: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingCreateComment](input)),
      updateComment: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingUpdateComment](input)),
      deleteComment: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingDeleteComment](input)),
      listArtifacts: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingListArtifacts](input)),
      createArtifact: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingCreateArtifact](input)),
      deleteArtifact: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingDeleteArtifact](input)),
      listTemplates: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingListTemplates](input)),
      getTemplate: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingGetTemplate](input)),
      createTemplate: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingCreateTemplate](input)),
      updateTemplate: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingUpdateTemplate](input)),
      deleteTemplate: (input) =>
        transport.request((client) => client[WS_METHODS.ticketingDeleteTemplate](input)),
      onEvent: (listener) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeTicketingEvents]({}), listener),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      status: (input) => transport.request((client) => client[WS_METHODS.gitStatus](input)),
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
      discoverRepos: (input) =>
        transport.request((client) => client[WS_METHODS.gitDiscoverRepos](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      resolveMcpServers: (input) =>
        transport.request((client) => client[WS_METHODS.serverResolveMcpServers](input)),
      resolveCodexProjectTrust: (input) =>
        transport.request((client) => client[WS_METHODS.serverResolveCodexProjectTrust](input)),
      trustCodexProject: (input) =>
        transport.request((client) => client[WS_METHODS.serverTrustCodexProject](input)),
      resolveSkills: (input) =>
        transport.request((client) => client[WS_METHODS.serverResolveSkills](input)),
      subscribeConfig: (listener) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerConfig]({}), listener),
      subscribeLifecycle: (listener) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerLifecycle]({}), listener),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      getStartupSnapshot: async () => {
        logWebTimeline("orchestration.startup-snapshot.start", {});
        try {
          const result = await transport.request((client) =>
            client[ORCHESTRATION_WS_METHODS.getStartupSnapshot]({}),
          );
          logWebTimeline("orchestration.startup-snapshot.success", {
            sequence: result.snapshotSequence,
            projectCount: result.projects.length,
            threadCount: result.threads.length,
          });
          return result;
        } catch (error) {
          logWebTimeline("orchestration.startup-snapshot.error", { error });
          throw error;
        }
      },
      getThreadContent: async (input) => {
        logWebTimeline("orchestration.thread-content.start", { threadId: input.threadId });
        try {
          const result = await transport.request((client) =>
            client[ORCHESTRATION_WS_METHODS.getThreadContent](input),
          );
          logWebTimeline("orchestration.thread-content.success", {
            threadId: input.threadId,
            sequence: result.sequence,
            messageCount: result.messages.length,
            activityCount: result.activities.length,
            checkpointCount: result.checkpoints.length,
            proposedPlanCount: result.proposedPlans.length,
          });
          return result;
        } catch (error) {
          logWebTimeline("orchestration.thread-content.error", {
            threadId: input.threadId,
            error,
          });
          throw error;
        }
      },
      dispatchCommand: async (input) => {
        logWebTimeline("orchestration.dispatch.start", summarizeOrchestrationCommand(input));
        try {
          const result = await transport.request((client) =>
            client[ORCHESTRATION_WS_METHODS.dispatchCommand](input),
          );
          logWebTimeline("orchestration.dispatch.success", {
            ...summarizeOrchestrationCommand(input),
            sequence: result.sequence,
          });
          return result;
        } catch (error) {
          logWebTimeline("orchestration.dispatch.error", {
            ...summarizeOrchestrationCommand(input),
            error,
          });
          throw error;
        }
      },
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      createRun: async (input) => {
        logWebTimeline("orchestration.run.create.start", { projectId: input.projectId });
        const result = await transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.createRun](input),
        );
        logWebTimeline("orchestration.run.create.success", {
          runId: result.runId,
          orchestrationThreadId: result.orchestrationThreadId,
          workingThreadCount: result.workingThreadIds.length,
        });
        return result;
      },
      getRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getRun](input)),
      listRuns: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.listRuns](input))
          .then((runs) => [...runs]),
      getChildThreads: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.getChildThreads](input))
          .then((threads) => [...threads]),
      pauseRun: async (input) => {
        logWebTimeline("orchestration.run.pause.start", { runId: input.runId });
        const result = await transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.pauseRun](input),
        );
        logWebTimeline("orchestration.run.pause.success", {
          runId: input.runId,
          status: result.status,
        });
        return result;
      },
      resumeRun: async (input) => {
        logWebTimeline("orchestration.run.resume.start", {
          runId: input.runId,
          resumeMode: input.mode ?? "default",
        });
        const result = await transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.resumeRun](input),
        );
        logWebTimeline("orchestration.run.resume.success", {
          runId: input.runId,
          status: result.status,
          currentTicketIndex: result.currentTicketIndex,
          resumeMode: input.mode ?? "default",
        });
        return result;
      },
      cancelRun: async (input) => {
        logWebTimeline("orchestration.run.cancel.start", { runId: input.runId });
        const result = await transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.cancelRun](input),
        );
        logWebTimeline("orchestration.run.cancel.success", {
          runId: input.runId,
          status: result.status,
        });
        return result;
      },
      startRun: async (input) => {
        logWebTimeline("orchestration.run.start.start", { runId: input.runId });
        const result = await transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.startRun](input),
        );
        logWebTimeline("orchestration.run.start.success", {
          runId: input.runId,
          status: result.status,
          currentTicketIndex: result.currentTicketIndex,
        });
        return result;
      },
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => {
            const fromSequenceExclusive = options?.getFromSequenceExclusive?.();
            logWebTimeline(
              "orchestration.domain-event.subscribe",
              fromSequenceExclusive !== undefined ? { fromSequenceExclusive } : undefined,
            );
            return client[WS_METHODS.subscribeOrchestrationDomainEvents](
              fromSequenceExclusive !== undefined ? { fromSequenceExclusive } : {},
            );
          },
          (event) => {
            logWebTimeline(
              "orchestration.domain-event.received",
              summarizeOrchestrationEvent(event),
            );
            listener(event);
          },
        ),
      onRunEvent: (projectId, listener) =>
        transport.subscribe(
          (client) => {
            logWebTimeline("orchestration.run-event.subscribe", { projectId });
            return client[WS_METHODS.subscribeOrchestrationRunEvents]({ projectId });
          },
          (event) => {
            if (event.type === "run.created" || event.type === "run.updated") {
              logWebTimeline("orchestration.run-event.received", {
                type: event.type,
                runId: event.run.id,
                status: event.run.status,
                currentTicketIndex: event.run.currentTicketIndex,
              });
            } else {
              logWebTimeline("orchestration.run-event.received", { type: event.type });
            }
            listener(event);
          },
        ),
    },
  };
}
