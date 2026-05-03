// Production CSS is part of the behavior under test because row height depends on it.
import "../index.css";

import {
  type ContextMenuItem,
  EventId,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type ManagedRunSummary,
  type ManagedRunStreamEvent,
  type NativeApi,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationStartupSnapshot,
  type OrchestrationThreadContent,
  type ProjectId,
  type ResolvedMcpServer,
  type ScheduledTaskId,
  type ServerConfig,
  type ServerProvider,
  type ServerLifecycleWelcomePayload,
  type SkillEntry,
  type TicketId,
  type ThreadId,
  type TurnId,
  WS_METHODS,
  OrchestrationSessionStatus,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { clearPromotedDraftThread } from "../composerDraftStore";
import { registerClipboardSnippet } from "../clipboardSnippetRegistry";
import { useMessageSelectionStore } from "../messageSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
  removeInlineTerminalContextPlaceholder,
} from "../lib/terminalContext";
import { isMacPlatform } from "../lib/utils";
import { __resetNativeApiForTests } from "../nativeApi";
import { getRouter } from "../router";
import { makeTabIdFromPath, useFileExplorerStore } from "../fileExplorerStore";
import { relativePathWithinWorkspace } from "../fileLinkRouting";
import { applyServerConfigEvent } from "../rpc/serverState";
import { useStore } from "../store";
import { dispatchTextPaste, waitForElement } from "../test-utils/browser";
import type { SidebarThreadSummary, Thread } from "../types";
import { BrowserWsRpcHarness, type NormalizedWsRpcRequestBody } from "../../test/wsRpcHarness";
import { createReadyServerProvider } from "../test/providerTestUtils";
import { estimateTimelineMessageHeight } from "./timelineHeight";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { createWsNativeApi } from "../wsNativeApi";
import ChatMarkdown from "./ChatMarkdown";

const THREAD_ID = "thread-browser-test" as ThreadId;
const UUID_ROUTE_RE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_ID = "project-1" as ProjectId;
const ORCHESTRATION_PARENT_THREAD_ID = "thread-orchestration-parent" as ThreadId;
const ORCHESTRATION_RUN_ID = "run-orchestration-browser-test";
const ORCHESTRATION_TICKET_ID = "ticket-orchestration-browser-test" as TicketId;
const ORCHESTRATION_REVIEW_THREAD_ID = "thread-orchestration-review" as ThreadId;
const NOW_ISO = "2026-03-04T12:00:00.000Z";
const BASE_TIME_MS = Date.parse(NOW_ISO);
const ATTACHMENT_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='300'></svg>";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: ServerLifecycleWelcomePayload;
}

let fixture: TestFixture;
const rpcHarness = new BrowserWsRpcHarness();
const wsRequests = rpcHarness.requests;
let customWsRpcResolver: ((body: NormalizedWsRpcRequestBody) => unknown | undefined) | null = null;
let managedRunLaunchSummaryResolver:
  | ((
      body: Parameters<NativeApi["managedRuns"]["launchProjectScript"]>[0],
    ) => Partial<ManagedRunSummary> | undefined)
  | null = null;
let resolvedMcpServerNames: readonly string[] = [];
const wsLink = ws.link(/ws(s)?:\/\/.*/);

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  textTolerancePx: number;
  attachmentTolerancePx: number;
}

const DEFAULT_VIEWPORT: ViewportSpec = {
  name: "desktop",
  width: 960,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
};
const WIDE_FOOTER_VIEWPORT: ViewportSpec = {
  name: "wide-footer",
  width: 1_400,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
};
const COMPACT_FOOTER_VIEWPORT: ViewportSpec = {
  name: "compact-footer",
  width: 430,
  height: 932,
  textTolerancePx: 56,
  attachmentTolerancePx: 56,
};
const TEXT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "tablet", width: 720, height: 1_024, textTolerancePx: 44, attachmentTolerancePx: 56 },
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];
const ATTACHMENT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];

interface UserRowMeasurement {
  measuredRowHeightPx: number;
  timelineWidthMeasuredPx: number;
  renderedInVirtualizedRegion: boolean;
}

interface MountedChatView {
  [Symbol.asyncDispose]: () => Promise<void>;
  cleanup: () => Promise<void>;
  measureUserRow: (targetMessageId: MessageId) => Promise<UserRowMeasurement>;
  setViewport: (viewport: ViewportSpec) => Promise<void>;
  setContainerSize: (viewport: Pick<ViewportSpec, "width" | "height">) => Promise<void>;
  router: ReturnType<typeof getRouter>;
}

function isoAt(offsetSeconds: number): string {
  return new Date(BASE_TIME_MS + offsetSeconds * 1_000).toISOString();
}

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: NOW_ISO,
        models: [],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  };
}

function createProvider(input: {
  provider: string;
  displayName?: string;
  models?: ServerProvider["models"];
}): ServerProvider {
  return createReadyServerProvider({
    ...input,
    checkedAt: NOW_ISO,
    defaultCodexModelSlug: "gpt-5",
    defaultCodexModelName: "GPT-5",
  });
}

function createUserMessage(options: {
  id: MessageId;
  text: string;
  offsetSeconds: number;
  attachments?: Array<{
    type: "image";
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}) {
  return {
    id: options.id,
    role: "user" as const,
    text: options.text,
    ...(options.attachments ? { attachments: options.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createAssistantMessage(options: { id: MessageId; text: string; offsetSeconds: number }) {
  return {
    id: options.id,
    role: "assistant" as const,
    text: options.text,
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createTerminalContext(input: {
  id: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: THREAD_ID,
    terminalId: `terminal-${input.id}`,
    terminalLabel: input.terminalLabel,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    text: input.text,
    createdAt: NOW_ISO,
  };
}

function createManagedRunSummary(overrides: Partial<ManagedRunSummary> = {}): ManagedRunSummary {
  return {
    runId: "run-browser-1" as ManagedRunSummary["runId"],
    projectId: PROJECT_ID,
    scriptId: "preview" as ManagedRunSummary["scriptId"],
    createdByThreadId: THREAD_ID,
    lastTouchedByThreadId: THREAD_ID,
    cwd: "/repo/project",
    launchMode: "attached",
    status: "running",
    detectedUrl: null,
    detectedPort: null,
    terminalThreadId: THREAD_ID,
    terminalId: "default",
    terminalPid: 123,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    startedAt: NOW_ISO,
    completedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    declaredServices: [],
    runtimeServices: [],
    inferenceStatus: "pending",
    inferenceUpdatedAt: null,
    inferenceError: null,
    ...overrides,
  };
}

function createSnapshotForTargetUser(options: {
  targetMessageId: MessageId;
  targetText: string;
  targetAttachmentCount?: number;
  sessionStatus?: OrchestrationSessionStatus;
  providerName?: "codex" | "claudeAgent" | "gemini" | "cursor";
}): OrchestrationReadModel {
  const providerName = options.providerName ?? "codex";
  const modelSelection =
    providerName === "claudeAgent"
      ? ({
          provider: "claudeAgent",
          model: "claude-opus-4-1",
        } as const)
      : providerName === "gemini"
        ? ({
            provider: "gemini",
            model: "gemini-2.5-pro",
          } as const)
        : providerName === "cursor"
          ? ({
              provider: "cursor",
              model: "composer-2",
            } as const)
          : ({
              provider: "codex",
              model: "gpt-5",
            } as const);
  const messages: Array<OrchestrationReadModel["threads"][number]["messages"][number]> = [];

  for (let index = 0; index < 22; index += 1) {
    const isTarget = index === 3;
    const userId = `msg-user-${index}` as MessageId;
    const assistantId = `msg-assistant-${index}` as MessageId;
    const attachments =
      isTarget && (options.targetAttachmentCount ?? 0) > 0
        ? Array.from({ length: options.targetAttachmentCount ?? 0 }, (_, attachmentIndex) => ({
            type: "image" as const,
            id: `attachment-${attachmentIndex + 1}`,
            name: `attachment-${attachmentIndex + 1}.png`,
            mimeType: "image/png",
            sizeBytes: 128,
          }))
        : undefined;

    messages.push(
      createUserMessage({
        id: isTarget ? options.targetMessageId : userId,
        text: isTarget ? options.targetText : `filler user message ${index}`,
        offsetSeconds: messages.length * 3,
        ...(attachments ? { attachments } : {}),
      }),
    );
    messages.push(
      createAssistantMessage({
        id: assistantId,
        text: `assistant filler ${index}`,
        offsetSeconds: messages.length * 3,
      }),
    );
  }

  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: modelSelection,
        scripts: [],
        systemPrompt: null,
        promptOverrides: { orchestration: {} },
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Browser test thread",
        modelSelection,
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        parentThreadId: null,
        isOrchestrationThread: false,
        ticketId: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages,
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: options.sessionStatus ?? "ready",
          providerName,
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function createStartupSnapshotFromReadModel(
  snapshot: OrchestrationReadModel,
): OrchestrationStartupSnapshot {
  return {
    snapshotSequence: snapshot.snapshotSequence,
    projects: snapshot.projects,
    updatedAt: snapshot.updatedAt,
    threads: snapshot.threads.map((thread) => {
      const latestUserMessage = thread.messages.findLast((message) => message.role === "user");
      return {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        parentThreadId: thread.parentThreadId,
        isOrchestrationThread: thread.isOrchestrationThread,
        ticketId: thread.ticketId,
        latestTurn: thread.latestTurn,
        latestTurnStatus: thread.latestTurn?.state ?? null,
        latestSessionStatus: thread.session?.status ?? null,
        session: thread.session,
        latestUserActivity: latestUserMessage
          ? {
              messageId: latestUserMessage.id,
              createdAt: latestUserMessage.createdAt,
            }
          : null,
        pendingApprovalCount: thread.activities.filter(
          (activity) => activity.kind === "approval.requested",
        ).length,
        pendingUserInputCount: thread.activities.filter(
          (activity) => activity.kind === "user-input.requested",
        ).length,
        actionablePlanState: null,
        lastActivitySummary: latestUserMessage?.text ?? null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        archivedAt: thread.archivedAt,
        deletedAt: thread.deletedAt,
        ...(thread.initialDraft ? { initialDraft: thread.initialDraft } : {}),
      };
    }),
  };
}

function createThreadContentFromReadModelThread(
  thread: OrchestrationReadModel["threads"][number],
): OrchestrationThreadContent {
  return {
    threadId: thread.id,
    sequence: 2,
    messages: thread.messages,
    proposedPlans: thread.proposedPlans,
    activities: thread.activities,
    checkpoints: thread.checkpoints,
  };
}

function buildFixture(snapshot: OrchestrationReadModel): TestFixture {
  return {
    snapshot,
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
    },
  };
}

function addThreadToSnapshot(
  snapshot: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationReadModel {
  return {
    ...snapshot,
    snapshotSequence: snapshot.snapshotSequence + 1,
    threads: [
      ...snapshot.threads,
      {
        id: threadId,
        projectId: PROJECT_ID,
        title: "New thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        parentThreadId: null,
        isOrchestrationThread: false,
        ticketId: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
  };
}

function createThreadCreatedEvent(threadId: ThreadId, sequence: number): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-thread-created-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: NOW_ISO,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.created",
    payload: {
      threadId,
      projectId: PROJECT_ID,
      title: "New thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
  };
}

function sendOrchestrationDomainEvent(event: OrchestrationEvent): void {
  rpcHarness.emitStreamValue(WS_METHODS.subscribeOrchestrationDomainEvents, event);
}

function buildMaterializedThread(thread: OrchestrationReadModel["threads"][number]): Thread {
  return {
    id: thread.id,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: thread.createdAt,
    archivedAt: null,
    updatedAt: thread.updatedAt,
    latestTurn: null,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    isOrchestrationThread: thread.isOrchestrationThread,
    parentThreadId: thread.parentThreadId,
    ticketId: thread.ticketId,
  };
}

function buildMaterializedSidebarThreadSummary(
  thread: OrchestrationReadModel["threads"][number],
): SidebarThreadSummary {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: null,
    createdAt: thread.createdAt,
    archivedAt: null,
    updatedAt: thread.updatedAt,
    latestTurn: null,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    isOrchestrationThread: thread.isOrchestrationThread,
    parentThreadId: thread.parentThreadId,
  };
}

function materializeThreadInStore(threadId: ThreadId): void {
  const thread = fixture.snapshot.threads.find((candidate) => candidate.id === threadId);
  if (!thread) {
    throw new Error(`Unable to materialize thread ${threadId} from the test snapshot.`);
  }
  const materializedThread = buildMaterializedThread(thread);
  const sidebarThreadSummary = buildMaterializedSidebarThreadSummary(thread);

  useStore.setState((state) => ({
    ...state,
    threads: state.threads.some((candidate) => candidate.id === threadId)
      ? state.threads
      : [...state.threads, materializedThread],
    threadsById: {
      ...state.threadsById,
      [threadId]: materializedThread,
    },
    sidebarThreadsById: {
      ...state.sidebarThreadsById,
      [threadId]: sidebarThreadSummary,
    },
    threadIdsByProjectId: {
      ...state.threadIdsByProjectId,
      [thread.projectId]: Array.from(
        new Set([...(state.threadIdsByProjectId[thread.projectId] ?? []), threadId]),
      ),
    },
  }));
}

function installTestNativeApi(input?: {
  resolveMcpServers?: NativeApi["server"]["resolveMcpServers"];
  manageMcpServer?: NativeApi["server"]["manageMcpServer"];
  resolveSkills?: () => Promise<{ skills: readonly SkillEntry[] }>;
  confirm?: (message: string) => boolean | Promise<boolean>;
  managedRunsOnEvent?: NativeApi["managedRuns"]["onEvent"];
  managedRunLaunchSummary?: (
    body: Parameters<NativeApi["managedRuns"]["launchProjectScript"]>[0],
  ) => Partial<ManagedRunSummary> | undefined;
  dispatchCommand?: (
    input: Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
  ) => { sequence: number } | Promise<{ sequence: number }>;
  showContextMenu?: (
    items: readonly ContextMenuItem<string>[],
    position?: { x: number; y: number },
  ) => string | null | Promise<string | null>;
}): NativeApi {
  managedRunLaunchSummaryResolver = input?.managedRunLaunchSummary ?? null;
  const base = createWsNativeApi();
  const api: NativeApi = {
    ...base,
    dialogs: {
      ...base.dialogs,
      confirm: input?.confirm ? async (message) => input.confirm!(message) : base.dialogs.confirm,
    },
    contextMenu: {
      ...base.contextMenu,
      show: (input?.showContextMenu
        ? async (items, position) =>
            (await input.showContextMenu!(items as readonly ContextMenuItem<string>[], position)) as
              | string
              | null
        : base.contextMenu.show) as NativeApi["contextMenu"]["show"],
    },
    managedRuns: {
      ...base.managedRuns,
      onEvent: input?.managedRunsOnEvent ?? base.managedRuns.onEvent,
    },
    orchestration: {
      ...base.orchestration,
      dispatchCommand: input?.dispatchCommand
        ? async (payload) => input.dispatchCommand!(payload)
        : base.orchestration.dispatchCommand,
    },
    server: {
      ...base.server,
      resolveMcpServers:
        input?.resolveMcpServers ??
        (async () => ({ status: "ready", serverNames: resolvedMcpServerNames })),
      manageMcpServer:
        input?.manageMcpServer ??
        (async (payload) => ({
          provider: payload.provider,
          serverName: payload.serverName,
          action: payload.action,
        })),
      resolveSkills: input?.resolveSkills ?? (async () => ({ skills: [] })),
    },
  };
  window.nativeApi = api;
  return api;
}

async function waitForWsClient(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        wsRequests.some(
          (request) => request._tag === WS_METHODS.subscribeOrchestrationDomainEvents,
        ),
      ).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function openManagedRunsMenu(): Promise<void> {
  const runsButton = await waitForElement(
    () =>
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Runs"),
      ) as HTMLButtonElement | null,
    'Unable to find "Runs" button.',
  );
  runsButton.click();
}

function queryToastTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="toast-title"]')).map(
    (element) => element.textContent ?? "",
  );
}

function expectNoRemovedConnectionSurfaceArtifacts(): void {
  const text = document.body.textContent ?? "";
  for (const removedCopy of [
    "Cannot reach the T3 server",
    "WebSocket connection unavailable",
    "Show connection details",
    "Some requests are slow",
    "Disconnected from T3 Server",
    "Reconnected to T3 Server",
  ]) {
    expect(text).not.toContain(removedCopy);
  }

  expect(queryToastTitles()).not.toEqual(
    expect.arrayContaining([
      "Some requests are slow",
      "Disconnected from T3 Server",
      "Reconnected to T3 Server",
      "Offline",
    ]),
  );
  expect(
    Array.from(document.querySelectorAll("button")).some((button) => {
      const label = button.textContent?.trim();
      return label === "Retry" || label === "Retry now";
    }),
  ).toBe(false);
}

function ChatShellRegressionFixture() {
  return <div data-testid="chat-shell-fixture">keep the chat shell visible</div>;
}

describe("ChatView shell regressions", () => {
  it("keeps the reverted chat shell visible without reconnect or slow-request toast storms", async () => {
    // Audit traceability: 69a1cec, b8a41f3.
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<ChatShellRegressionFixture />, { container: host });

    try {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));

      await expect.element(page.getByTestId("chat-shell-fixture")).toBeInTheDocument();
      expectNoRemovedConnectionSurfaceArtifacts();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});

async function promoteDraftThreadViaDomainEvent(threadId: ThreadId): Promise<void> {
  await waitForWsClient();
  fixture.snapshot = addThreadToSnapshot(fixture.snapshot, threadId);
  sendOrchestrationDomainEvent(
    createThreadCreatedEvent(threadId, fixture.snapshot.snapshotSequence),
  );
  materializeThreadInStore(threadId);
  await vi.waitFor(
    () => {
      expect(useStore.getState().threadsById[threadId]).toBeDefined();
    },
    { timeout: 8_000, interval: 16 },
  );
  clearPromotedDraftThread(threadId);
  await vi.waitFor(
    () => {
      expect(useComposerDraftStore.getState().draftThreadsByThreadId[threadId]).toBeUndefined();
      expect(useComposerDraftStore.getState().projectDraftThreadIdByProjectId[PROJECT_ID]).not.toBe(
        threadId,
      );
    },
    { timeout: 8_000, interval: 16 },
  );
}

function createDraftOnlySnapshot(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-draft-target" as MessageId,
    targetText: "draft thread",
  });
  return {
    ...snapshot,
    threads: [],
  };
}

function withProjectScripts(
  snapshot: OrchestrationReadModel,
  scripts: OrchestrationReadModel["projects"][number]["scripts"],
): OrchestrationReadModel {
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === PROJECT_ID ? { ...project, scripts: Array.from(scripts) } : project,
    ),
  };
}

function setDraftThreadWithoutWorktree(): void {
  useComposerDraftStore.setState({
    draftThreadsByThreadId: {
      [THREAD_ID]: {
        projectId: PROJECT_ID,
        createdAt: NOW_ISO,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        envMode: "local",
      },
    },
    projectDraftThreadIdByProjectId: {
      [PROJECT_ID]: THREAD_ID,
    },
  });
}

function createSnapshotWithLongProposedPlan(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-plan-target" as MessageId,
    targetText: "plan thread",
  });
  const planMarkdown = [
    "# Ship plan mode follow-up",
    "",
    "- Step 1: capture the thread-open trace",
    "- Step 2: identify the main-thread bottleneck",
    "- Step 3: keep collapsed cards cheap",
    "- Step 4: render the full markdown only on demand",
    "- Step 5: preserve export and save actions",
    "- Step 6: add regression coverage",
    "- Step 7: verify route transitions stay responsive",
    "- Step 8: confirm no server-side work changed",
    "- Step 9: confirm short plans still render normally",
    "- Step 10: confirm long plans stay collapsed by default",
    "- Step 11: confirm preview text is still useful",
    "- Step 12: confirm plan follow-up flow still works",
    "- Step 13: confirm timeline virtualization still behaves",
    "- Step 14: confirm theme styling still looks correct",
    "- Step 15: confirm save dialog behavior is unchanged",
    "- Step 16: confirm download behavior is unchanged",
    "- Step 17: confirm code fences do not parse until expand",
    "- Step 18: confirm preview truncation ends cleanly",
    "- Step 19: confirm markdown links still open in editor after expand",
    "- Step 20: confirm deep hidden detail only appears after expand",
    "",
    "```ts",
    "export const hiddenPlanImplementationDetail = 'deep hidden detail only after expand';",
    "```",
  ].join("\n");

  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) =>
      thread.id === THREAD_ID
        ? Object.assign({}, thread, {
            proposedPlans: [
              {
                id: "plan-browser-test",
                turnId: null,
                planMarkdown,
                implementedAt: null,
                implementationThreadId: null,
                createdAt: isoAt(1_000),
                updatedAt: isoAt(1_001),
              },
            ],
            updatedAt: isoAt(1_001),
          })
        : thread,
    ),
  };
}

function createSnapshotWithPendingUserInput(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-pending-input-target" as MessageId,
    targetText: "question thread",
  });

  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) =>
      thread.id === THREAD_ID
        ? Object.assign({}, thread, {
            interactionMode: "plan",
            activities: [
              {
                id: EventId.makeUnsafe("activity-user-input-requested"),
                tone: "info",
                kind: "user-input.requested",
                summary: "User input requested",
                payload: {
                  requestId: "req-browser-user-input",
                  questions: [
                    {
                      id: "scope",
                      header: "Scope",
                      question: "What should this change cover?",
                      options: [
                        {
                          label: "Tight",
                          description: "Touch only the footer layout logic.",
                        },
                        {
                          label: "Broad",
                          description: "Also adjust the related composer controls.",
                        },
                      ],
                    },
                    {
                      id: "risk",
                      header: "Risk",
                      question: "How aggressive should the imaginary plan be?",
                      options: [
                        {
                          label: "Conservative",
                          description: "Favor reliability and low-risk changes.",
                        },
                        {
                          label: "Balanced",
                          description: "Mix quick wins with one structural improvement.",
                        },
                      ],
                    },
                  ],
                },
                turnId: null,
                sequence: 1,
                createdAt: isoAt(1_000),
              },
            ],
            updatedAt: isoAt(1_000),
          })
        : thread,
    ),
  };
}

function createSnapshotWithPlanFollowUpPrompt(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-plan-follow-up-target" as MessageId,
    targetText: "plan follow-up thread",
  });

  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) =>
      thread.id === THREAD_ID
        ? Object.assign({}, thread, {
            interactionMode: "plan",
            latestTurn: {
              turnId: "turn-plan-follow-up" as TurnId,
              state: "completed",
              requestedAt: isoAt(1_000),
              startedAt: isoAt(1_001),
              completedAt: isoAt(1_010),
              assistantMessageId: null,
            },
            proposedPlans: [
              {
                id: "plan-follow-up-browser-test",
                turnId: "turn-plan-follow-up" as TurnId,
                planMarkdown: "# Follow-up plan\n\n- Keep the composer footer stable on resize.",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: isoAt(1_002),
                updatedAt: isoAt(1_003),
              },
            ],
            session: {
              ...thread.session,
              status: "ready",
              updatedAt: isoAt(1_010),
            },
            updatedAt: isoAt(1_010),
          })
        : thread,
    ),
  };
}

function createOrchestrationRun(
  status: "pending" | "running",
  options?: {
    currentPhase?: "working" | "reviewing";
    reviewIteration?: number;
    includeReviewThread?: boolean;
  },
) {
  const currentPhase = options?.currentPhase ?? "working";
  const reviewIteration = options?.reviewIteration ?? (currentPhase === "reviewing" ? 1 : 0);
  const includeReviewThread = options?.includeReviewThread ?? currentPhase === "reviewing";

  return {
    id: ORCHESTRATION_RUN_ID,
    orchestrationThreadId: ORCHESTRATION_PARENT_THREAD_ID,
    projectId: PROJECT_ID,
    status,
    ticketOrder: [
      {
        ticketId: ORCHESTRATION_TICKET_ID,
        workingThreadId: THREAD_ID,
        ...(includeReviewThread ? { reviewThreadId: ORCHESTRATION_REVIEW_THREAD_ID } : {}),
      },
    ],
    currentTicketIndex: status === "pending" ? -1 : 0,
    currentPhase,
    reviewIteration,
    maxReviewIterations: 1,
    createdAt: isoAt(2_000),
    updatedAt: isoAt(status === "pending" ? 2_001 : 2_010),
  };
}

function createOrchestrationWaitingSnapshot(options?: {
  includeReviewThread?: boolean;
}): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-orchestration-wait-target" as MessageId,
    targetText: "orchestration wait target",
  });

  const activeThread = snapshot.threads[0];
  if (!activeThread) {
    throw new Error("Expected a base thread in the orchestration waiting snapshot.");
  }

  return {
    ...snapshot,
    threads: [
      {
        id: ORCHESTRATION_PARENT_THREAD_ID,
        projectId: PROJECT_ID,
        title: "Orchestration timeline",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        parentThreadId: null,
        isOrchestrationThread: true,
        ticketId: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: null,
      },
      {
        ...activeThread,
        title: "Waiting child thread",
        parentThreadId: ORCHESTRATION_PARENT_THREAD_ID,
        isOrchestrationThread: false,
        ticketId: ORCHESTRATION_TICKET_ID,
        messages: [],
        activities: [],
        latestTurn: null,
        session: null,
      },
      ...(options?.includeReviewThread
        ? [
            {
              ...activeThread,
              id: ORCHESTRATION_REVIEW_THREAD_ID,
              title: "Review child thread",
              parentThreadId: ORCHESTRATION_PARENT_THREAD_ID,
              isOrchestrationThread: false,
              ticketId: ORCHESTRATION_TICKET_ID,
              messages: [],
              activities: [],
              latestTurn: null,
              session: null,
            },
          ]
        : []),
    ],
  };
}

function resolveWsRpc(body: NormalizedWsRpcRequestBody): unknown {
  const customResult = customWsRpcResolver?.(body);
  if (customResult !== undefined) {
    return customResult;
  }
  const tag = body._tag;
  if (
    tag === ORCHESTRATION_WS_METHODS.getSnapshot ||
    tag === ORCHESTRATION_WS_METHODS.getStartupSnapshot
  ) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.serverResolveMcpServers) {
    return { status: "ready", serverNames: resolvedMcpServerNames };
  }
  if (tag === WS_METHODS.serverResolveSkills) {
    return { skills: [] };
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      nextCursor: null,
      totalCount: 1,
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
        },
      ],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      isDefaultBranch: true,
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: {
        files: [],
        insertions: 0,
        deletions: 0,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return {
      entries: [],
      truncated: false,
    };
  }
  if (tag === WS_METHODS.shellOpenInEditor) {
    return null;
  }
  if (tag === WS_METHODS.managedRunsLaunchProjectScript) {
    const launchBody = body as unknown as Parameters<
      NativeApi["managedRuns"]["launchProjectScript"]
    >[0];
    const runOverrides = managedRunLaunchSummaryResolver?.(launchBody) ?? {};
    return {
      run: createManagedRunSummary({
        runId: "run-project-script" as ManagedRunSummary["runId"],
        projectId: launchBody.projectId,
        scriptId: launchBody.scriptId,
        createdByThreadId: launchBody.threadId,
        lastTouchedByThreadId: launchBody.threadId,
        cwd: typeof launchBody.cwd === "string" ? launchBody.cwd : "/repo/project",
        terminalThreadId: launchBody.threadId,
        terminalId: "default",
        terminalPid: 123,
        ...runOverrides,
      }),
      terminal: {
        threadId: typeof launchBody.threadId === "string" ? launchBody.threadId : THREAD_ID,
        terminalId: "default",
        cwd: typeof launchBody.cwd === "string" ? launchBody.cwd : "/repo/project",
        status: "running",
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: NOW_ISO,
      },
    };
  }
  if (tag === WS_METHODS.terminalOpen) {
    return {
      threadId: typeof body.threadId === "string" ? body.threadId : THREAD_ID,
      terminalId: typeof body.terminalId === "string" ? body.terminalId : "default",
      cwd: typeof body.cwd === "string" ? body.cwd : "/repo/project",
      status: "running",
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      updatedAt: NOW_ISO,
    };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    void rpcHarness.connect(client);
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      void rpcHarness.onMessage(rawData);
    });
  }),
  http.get("*/attachments/:attachmentId", () =>
    HttpResponse.text(ATTACHMENT_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
      },
    }),
  ),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolveDeferred: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  if (!resolveDeferred) {
    throw new Error("Expected deferred promise resolver to be initialized.");
  }
  return { promise, resolve: resolveDeferred };
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function setViewport(viewport: ViewportSpec): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
  await waitForLayout();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );
}

async function waitForURL(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = "";
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname;
      expect(predicate(pathname), errorMessage).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  return pathname;
}

async function waitForComposerEditor(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
    "Unable to find composer editor.",
  );
}

async function waitForComposerMenuItem(itemId: string): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>(`[data-composer-item-id="${itemId}"]`),
    `Unable to find composer menu item "${itemId}".`,
  );
}

async function waitForSendButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]'),
    "Unable to find send button.",
  );
}

async function waitForWaitingSendButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Waiting for agent to start"]'),
    'Unable to find disabled "Waiting for agent to start" send button.',
  );
}

async function waitForMcpServersButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="MCP servers"]'),
    "Unable to find MCP servers button.",
  );
}

async function waitForSkillsButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Skills"]'),
    "Unable to find Skills button.",
  );
}

function findComposerProviderModelPicker(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-chat-provider-model-picker="true"]');
}

function findButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  ) ?? null) as HTMLButtonElement | null;
}

async function waitForButtonByText(text: string): Promise<HTMLButtonElement> {
  return waitForElement(() => findButtonByText(text), `Unable to find "${text}" button.`);
}

function findButtonContainingText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

async function waitForButtonContainingText(text: string): Promise<HTMLButtonElement> {
  return waitForElement(
    () => findButtonContainingText(text),
    `Unable to find button containing "${text}".`,
  );
}

function findMenuItemContainingText(text: string): HTMLElement | null {
  return (Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
    item.textContent?.includes(text),
  ) ?? null) as HTMLElement | null;
}

async function waitForMenuItemContainingText(text: string): Promise<HTMLElement> {
  return waitForElement(
    () => findMenuItemContainingText(text),
    `Unable to find menu item containing "${text}".`,
  );
}

async function expectComposerActionsContained(): Promise<void> {
  const footer = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-composer-footer="true"]'),
    "Unable to find composer footer.",
  );
  const actions = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-composer-actions="right"]'),
    "Unable to find composer actions container.",
  );

  await vi.waitFor(
    () => {
      const footerRect = footer.getBoundingClientRect();
      const actionButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button"));
      expect(actionButtons.length).toBeGreaterThanOrEqual(1);

      const buttonRects = actionButtons.map((button) => button.getBoundingClientRect());
      const firstTop = buttonRects[0]?.top ?? 0;

      for (const rect of buttonRects) {
        expect(rect.right).toBeLessThanOrEqual(footerRect.right + 0.5);
        expect(rect.bottom).toBeLessThanOrEqual(footerRect.bottom + 0.5);
        expect(Math.abs(rect.top - firstTop)).toBeLessThanOrEqual(1.5);
      }
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function waitForInteractionModeButton(
  expectedLabel: "Chat" | "Plan" | "Plan + Accept",
): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-chat-composer-footer="true"] button'),
      ).find((button) => button.textContent?.trim() === expectedLabel) as HTMLButtonElement | null,
    `Unable to find ${expectedLabel} interaction mode button.`,
  );
}

async function waitForServerConfigToApply(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.some((request) => request._tag === WS_METHODS.subscribeServerConfig)).toBe(
        true,
      );
    },
    { timeout: 8_000, interval: 16 },
  );
  await waitForLayout();
}

function dispatchChatNewShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "o",
      shiftKey: true,
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function triggerChatNewShortcutUntilPath(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = router.state.location.pathname;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    dispatchChatNewShortcut();
    await waitForLayout();
    pathname = router.state.location.pathname;
    if (predicate(pathname)) {
      return pathname;
    }
  }
  throw new Error(`${errorMessage} Last path: ${pathname}`);
}

async function waitForNewThreadShortcutLabel(): Promise<void> {
  const newThreadButton = page.getByTestId("new-thread-button");
  await expect.element(newThreadButton).toBeInTheDocument();
  await newThreadButton.hover();
  const shortcutLabel = isMacPlatform(navigator.platform)
    ? "New thread (⇧⌘O)"
    : "New thread (Ctrl+Shift+O)";
  await expect.element(page.getByText(shortcutLabel)).toBeInTheDocument();
}

async function waitForImagesToLoad(scope: ParentNode): Promise<void> {
  const images = Array.from(scope.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await waitForLayout();
}

async function measureUserRow(options: {
  host: HTMLElement;
  targetMessageId: MessageId;
}): Promise<UserRowMeasurement> {
  const { host, targetMessageId } = options;
  const rowSelector = `[data-message-id="${targetMessageId}"][data-message-role="user"]`;

  const scrollContainer = await waitForElement(
    () => host.querySelector<HTMLDivElement>("div.overflow-y-auto.overscroll-y-contain"),
    "Unable to find ChatView message scroll container.",
  );

  let row: HTMLElement | null = null;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();
      row = host.querySelector<HTMLElement>(rowSelector);
      expect(row, "Unable to locate targeted user message row.").toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );

  await waitForImagesToLoad(row!);
  scrollContainer.scrollTop = 0;
  scrollContainer.dispatchEvent(new Event("scroll"));
  await nextFrame();

  const timelineRoot =
    row!.closest<HTMLElement>('[data-timeline-root="true"]') ??
    host.querySelector<HTMLElement>('[data-timeline-root="true"]');
  if (!(timelineRoot instanceof HTMLElement)) {
    throw new Error("Unable to locate timeline root container.");
  }

  let timelineWidthMeasuredPx = 0;
  let measuredRowHeightPx = 0;
  let renderedInVirtualizedRegion = false;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await nextFrame();
      const measuredRow = host.querySelector<HTMLElement>(rowSelector);
      expect(measuredRow, "Unable to measure targeted user row height.").toBeTruthy();
      timelineWidthMeasuredPx = timelineRoot.getBoundingClientRect().width;
      measuredRowHeightPx = measuredRow!.getBoundingClientRect().height;
      renderedInVirtualizedRegion = measuredRow!.closest("[data-index]") instanceof HTMLElement;
      expect(timelineWidthMeasuredPx, "Unable to measure timeline width.").toBeGreaterThan(0);
      expect(measuredRowHeightPx, "Unable to measure targeted user row height.").toBeGreaterThan(0);
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );

  return { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion };
}

async function mountChatView(options: {
  viewport: ViewportSpec;
  snapshot: OrchestrationReadModel;
  configureFixture?: (fixture: TestFixture) => void;
  resolveRpc?: (body: NormalizedWsRpcRequestBody) => unknown | undefined;
}): Promise<MountedChatView> {
  fixture = buildFixture(options.snapshot);
  options.configureFixture?.(fixture);
  customWsRpcResolver = options.resolveRpc ?? null;
  await setViewport(options.viewport);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: [`/${THREAD_ID}`],
    }),
  );

  const screen = await render(<RouterProvider router={router} />, {
    container: host,
  });

  await waitForLayout();

  const cleanup = async () => {
    customWsRpcResolver = null;
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    measureUserRow: async (targetMessageId: MessageId) => measureUserRow({ host, targetMessageId }),
    setViewport: async (viewport: ViewportSpec) => {
      await setViewport(viewport);
      await waitForProductionStyles();
    },
    setContainerSize: async (viewport) => {
      host.style.width = `${viewport.width}px`;
      host.style.height = `${viewport.height}px`;
      await waitForLayout();
    },
    router,
  };
}

async function measureUserRowAtViewport(options: {
  snapshot: OrchestrationReadModel;
  targetMessageId: MessageId;
  viewport: ViewportSpec;
}): Promise<UserRowMeasurement> {
  const mounted = await mountChatView({
    viewport: options.viewport,
    snapshot: options.snapshot,
  });

  try {
    return await mounted.measureUserRow(options.targetMessageId);
  } finally {
    await mounted.cleanup();
  }
}

describe("ChatView timeline estimator parity (full app)", () => {
  beforeAll(async () => {
    fixture = buildFixture(
      createSnapshotForTargetUser({
        targetMessageId: "msg-user-bootstrap" as MessageId,
        targetText: "bootstrap",
      }),
    );
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });

  afterAll(async () => {
    await rpcHarness.disconnect();
    await worker.stop();
  });

  beforeEach(async () => {
    await rpcHarness.reset({
      resolveUnary: resolveWsRpc,
      getInitialStreamValues: (request) => {
        if (request._tag === WS_METHODS.subscribeServerLifecycle) {
          return [
            {
              version: 1,
              sequence: 1,
              type: "welcome",
              payload: fixture.welcome,
            },
          ];
        }
        if (request._tag === WS_METHODS.subscribeServerConfig) {
          return [
            {
              version: 1,
              type: "snapshot",
              config: fixture.serverConfig,
            },
          ];
        }
        return [];
      },
    });
    __resetNativeApiForTests();
    delete window.nativeApi;
    await setViewport(DEFAULT_VIEWPORT);
    localStorage.clear();
    document.body.innerHTML = "";
    wsRequests.length = 0;
    customWsRpcResolver = null;
    managedRunLaunchSummaryResolver = null;
    resolvedMcpServerNames = [];
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
    useStore.setState({
      projects: [],
      threads: [],
      bootstrapComplete: false,
    });
    useFileExplorerStore.setState({
      workspaceStatesByCwd: {},
      runtimeTabStateByTabId: {},
      pendingScrollTargetByTabId: {},
      pendingRevealPathByCwd: {},
    });
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
      startupRecoveryStateByThreadId: {},
      managementBoardContext: null,
      viewMode: "chat",
    });
  });

  afterEach(() => {
    customWsRpcResolver = null;
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("keeps direct navigation to a metadata-only thread stable while hydrating content", async () => {
    const snapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-lazy-hydration" as MessageId,
      targetText: "hydrate me without flashing empty state",
    });
    const startupSnapshot = createStartupSnapshotFromReadModel(snapshot);
    const hydratedContent = createThreadContentFromReadModelThread(snapshot.threads[0]!);
    let resolveThreadContent: ((content: OrchestrationThreadContent) => void) | undefined;
    const threadContentPromise = new Promise<OrchestrationThreadContent>((resolve) => {
      resolveThreadContent = resolve;
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
      resolveRpc: (body) => {
        if (body._tag === ORCHESTRATION_WS_METHODS.getStartupSnapshot) {
          return startupSnapshot;
        }
        if (body._tag === ORCHESTRATION_WS_METHODS.getThreadContent) {
          return threadContentPromise;
        }
        return undefined;
      },
    });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Browser test thread");
        expect(document.body.textContent ?? "").toContain("Loading thread content");
        expect(document.body.textContent ?? "").toContain("filler user message 21");
        expect(document.body.textContent ?? "").not.toContain(
          "Send a message to start the conversation.",
        );
      });
      expect(document.querySelector('[contenteditable="true"]')).toBeNull();

      resolveThreadContent?.(hydratedContent);

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").not.toContain("Loading thread content");
        expect(document.body.textContent ?? "").toContain("assistant filler 3");
      });
      expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("accepts a propose-scheduled-task card and dispatches the confirmation turn", async () => {
    // Audit traceability: 2b596d9, eb1fe8e.
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-scheduled-task-proposal" as MessageId,
      targetText: "Please help me automate this.",
    });
    const snapshot: OrchestrationReadModel = {
      ...baseSnapshot,
      threads: baseSnapshot.threads.map((thread) =>
        thread.id === THREAD_ID
          ? {
              ...thread,
              messages: [
                createUserMessage({
                  id: "msg-user-scheduled-task-proposal" as MessageId,
                  text: "Please help me automate this.",
                  offsetSeconds: 0,
                }),
                createAssistantMessage({
                  id: "msg-assistant-scheduled-task-proposal" as MessageId,
                  offsetSeconds: 1,
                  text: [
                    "```t3:propose-scheduled-task",
                    JSON.stringify(
                      {
                        name: "Morning sync",
                        description: "Check the backlog each morning.",
                        cronExpression: "0 9 * * 1-5",
                        projectId: PROJECT_ID,
                        skillIds: ["skill-backlog", "skill-summary"],
                        prompt: "Summarize open work.",
                        autoSend: true,
                      },
                      null,
                      2,
                    ),
                    "```",
                  ].join("\n"),
                }),
              ],
            }
          : thread,
      ),
    };

    const createSpy = vi.fn(async () => ({
      jobId: "job-proposed" as ScheduledTaskId,
      name: "Morning sync",
      description: "Check the backlog each morning.",
      cronExpression: "0 9 * * 1-5",
      enabled: true,
      jobType: "new_thread" as const,
      newThreadConfig: {
        projectId: PROJECT_ID,
        prompt: "Summarize open work.",
        autoSend: true,
      },
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      lastRunAt: null,
      nextRunAt: null,
    }));
    const dispatchSpy = vi.fn(async () => ({ sequence: 1 }));

    const api = installTestNativeApi({
      dispatchCommand: dispatchSpy,
    });
    api.scheduledTasks = {
      ...api.scheduledTasks,
      create: createSpy,
    };
    window.nativeApi = api;

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
    });

    try {
      await expect.element(page.getByText("Proposed Scheduled Task")).toBeInTheDocument();
      await expect
        .element(page.getByText("Skills: skill-backlog, skill-summary"))
        .toBeInTheDocument();
      await page.getByRole("button", { name: "Accept" }).click();

      await vi.waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith({
          name: "Morning sync",
          description: "Check the backlog each morning.",
          cronExpression: "0 9 * * 1-5",
          enabled: true,
          jobType: "new_thread",
          newThreadConfig: {
            projectId: PROJECT_ID,
            skillIds: ["skill-backlog", "skill-summary"],
            prompt: "Summarize open work.",
            autoSend: true,
          },
        });
      });

      await vi.waitFor(() => {
        expect(dispatchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "thread.turn.start",
            threadId: THREAD_ID,
            message: expect.objectContaining({
              role: "user",
              text: "Scheduled task added: Morning sync (schedule: 0 9 * * 1-5)",
            }),
          }),
        );
      });

      await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="badge"]')).find(
            (badge) => badge.textContent?.trim() === "Added",
          ) as HTMLElement | null,
        'Unable to find the scheduled-task "Added" badge.',
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("rejects a propose-scheduled-task card without creating a scheduled task", async () => {
    // Audit traceability: 2b596d9, eb1fe8e.
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-scheduled-task-reject" as MessageId,
      targetText: "No thanks.",
    });
    const snapshot: OrchestrationReadModel = {
      ...baseSnapshot,
      threads: baseSnapshot.threads.map((thread) =>
        thread.id === THREAD_ID
          ? {
              ...thread,
              messages: [
                createUserMessage({
                  id: "msg-user-scheduled-task-reject" as MessageId,
                  text: "No thanks.",
                  offsetSeconds: 0,
                }),
                createAssistantMessage({
                  id: "msg-assistant-scheduled-task-reject" as MessageId,
                  offsetSeconds: 1,
                  text: [
                    "```t3:propose-scheduled-task",
                    JSON.stringify(
                      {
                        name: "Lunch reminder",
                        description: null,
                        cronExpression: "0 12 * * *",
                        projectId: PROJECT_ID,
                        autoSend: false,
                      },
                      null,
                      2,
                    ),
                    "```",
                  ].join("\n"),
                }),
              ],
            }
          : thread,
      ),
    };

    const createSpy = vi.fn();
    const dispatchSpy = vi.fn(async () => ({ sequence: 1 }));

    const api = installTestNativeApi({
      dispatchCommand: dispatchSpy,
    });
    api.scheduledTasks = {
      ...api.scheduledTasks,
      create: createSpy,
    };
    window.nativeApi = api;

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
    });

    try {
      await expect.element(page.getByText("Proposed Scheduled Task")).toBeInTheDocument();
      await page.getByRole("button", { name: "Reject" }).click();

      await vi.waitFor(() => {
        expect(createSpy).not.toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "thread.turn.start",
            threadId: THREAD_ID,
            message: expect.objectContaining({
              role: "user",
              text: "User rejected the proposed scheduled task.",
            }),
          }),
        );
      });

      await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="badge"]')).find(
            (badge) => badge.textContent?.trim() === "Rejected",
          ) as HTMLElement | null,
        'Unable to find the scheduled-task "Rejected" badge.',
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it.each(TEXT_VIEWPORT_MATRIX)(
    "keeps long user message estimate close at the $name viewport",
    async (viewport) => {
      const userText = "x".repeat(3_200);
      const targetMessageId = `msg-user-target-long-${viewport.name}` as MessageId;
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.textTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("tracks wrapping parity while resizing an existing ChatView across the viewport matrix", async () => {
    const userText = "x".repeat(3_200);
    const targetMessageId = "msg-user-target-resize" as MessageId;
    const mounted = await mountChatView({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: userText,
      }),
    });

    try {
      const measurements: Array<
        UserRowMeasurement & { viewport: ViewportSpec; estimatedHeightPx: number }
      > = [];

      for (const viewport of TEXT_VIEWPORT_MATRIX) {
        await mounted.setViewport(viewport);
        const measurement = await mounted.measureUserRow(targetMessageId);
        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: measurement.timelineWidthMeasuredPx },
        );

        expect(measurement.renderedInVirtualizedRegion).toBe(true);
        expect(Math.abs(measurement.measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.textTolerancePx,
        );
        measurements.push({ ...measurement, viewport, estimatedHeightPx });
      }

      expect(
        new Set(measurements.map((measurement) => Math.round(measurement.timelineWidthMeasuredPx)))
          .size,
      ).toBeGreaterThanOrEqual(3);

      const byMeasuredWidth = measurements.toSorted(
        (left, right) => left.timelineWidthMeasuredPx - right.timelineWidthMeasuredPx,
      );
      const narrowest = byMeasuredWidth[0]!;
      const widest = byMeasuredWidth.at(-1)!;
      expect(narrowest.timelineWidthMeasuredPx).toBeLessThan(widest.timelineWidthMeasuredPx);
      expect(narrowest.measuredRowHeightPx).toBeGreaterThan(widest.measuredRowHeightPx);
      expect(narrowest.estimatedHeightPx).toBeGreaterThan(widest.estimatedHeightPx);
    } finally {
      await mounted.cleanup();
    }
  });

  it("tracks additional rendered wrapping when ChatView width narrows between desktop and mobile viewports", async () => {
    const userText = "x".repeat(2_400);
    const targetMessageId = "msg-user-target-wrap" as MessageId;
    const snapshot = createSnapshotForTargetUser({
      targetMessageId,
      targetText: userText,
    });
    const desktopMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot,
      targetMessageId,
    });
    const mobileMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[2],
      snapshot,
      targetMessageId,
    });

    const estimatedDesktopPx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: desktopMeasurement.timelineWidthMeasuredPx },
    );
    const estimatedMobilePx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: mobileMeasurement.timelineWidthMeasuredPx },
    );

    const measuredDeltaPx =
      mobileMeasurement.measuredRowHeightPx - desktopMeasurement.measuredRowHeightPx;
    const estimatedDeltaPx = estimatedMobilePx - estimatedDesktopPx;
    expect(measuredDeltaPx).toBeGreaterThan(0);
    expect(estimatedDeltaPx).toBeGreaterThan(0);
    const ratio = estimatedDeltaPx / measuredDeltaPx;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.35);
  });

  it.each(ATTACHMENT_VIEWPORT_MATRIX)(
    "keeps user attachment estimate close at the $name viewport",
    async (viewport) => {
      const targetMessageId = `msg-user-target-attachments-${viewport.name}` as MessageId;
      const userText = "message with image attachments";
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
          targetAttachmentCount: 3,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          {
            role: "user",
            text: userText,
            attachments: [{ id: "attachment-1" }, { id: "attachment-2" }, { id: "attachment-3" }],
          },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.attachmentTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("shows an explicit empty state for projects without threads in the sidebar", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
    });

    try {
      await expect.element(page.getByText("No threads yet")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd for draft threads without a worktree path", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      await vi.waitFor(() => {
        expect(openButton.disabled).toBe(false);
      });
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with VS Code Insiders when it is the only available editor", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      await vi.waitFor(() => {
        expect(openButton.disabled).toBe(false);
      });
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode-insiders",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with Trae when it is the only available editor", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["trae"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      await vi.waitFor(() => {
        expect(openButton.disabled).toBe(false);
      });
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "trae",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters the open picker menu and opens VSCodium from the menu", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders", "vscodium"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const menuButton = await waitForElement(
        () => document.querySelector('button[aria-label="Copy options"]'),
        "Unable to find Open picker button.",
      );
      (menuButton as HTMLButtonElement).click();

      await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find((item) =>
            item.textContent?.includes("VS Code Insiders"),
          ) ?? null,
        "Unable to find VS Code Insiders menu item.",
      );

      expect(
        Array.from(document.querySelectorAll('[data-slot="menu-item"]')).some((item) =>
          item.textContent?.includes("Zed"),
        ),
      ).toBe(false);

      const vscodiumItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find((item) =>
            item.textContent?.includes("VSCodium"),
          ) ?? null,
        "Unable to find VSCodium menu item.",
      );
      (vscodiumItem as HTMLElement).click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscodium",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the first installed editor when the stored favorite is unavailable", async () => {
    localStorage.setItem("t3code:last-editor", JSON.stringify("vscodium"));
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders"],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      await vi.waitFor(() => {
        expect(openButton.disabled).toBe(false);
      });
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode-insiders",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from local draft threads at the project cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Lint",
          ) as HTMLButtonElement | null,
        "Unable to find Run Lint button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.managedRunsLaunchProjectScript,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.managedRunsLaunchProjectScript,
            projectId: PROJECT_ID,
            scriptId: "lint",
            threadId: THREAD_ID,
            cwd: "/repo/project",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from worktree draft threads at the worktree cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature/draft",
          worktreePath: "/repo/worktrees/feature-draft",
          envMode: "worktree",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "test",
          name: "Test",
          command: "bun run test",
          icon: "test",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Test",
          ) as HTMLButtonElement | null,
        "Unable to find Run Test button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.managedRunsLaunchProjectScript,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.managedRunsLaunchProjectScript,
            projectId: PROJECT_ID,
            scriptId: "test",
            threadId: THREAD_ID,
            cwd: "/repo/worktrees/feature-draft",
            worktreePath: "/repo/worktrees/feature-draft",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs setup scripts after preparing a pull request worktree thread", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "setup",
          name: "Setup",
          command: "bun install",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
      ]),
      resolveRpc: (body) => {
        if (body._tag === WS_METHODS.gitResolvePullRequest) {
          return {
            pullRequest: {
              number: 1359,
              title: "Add thread archiving and settings navigation",
              url: "https://github.com/pingdotgg/t3code/pull/1359",
              baseBranch: "main",
              headBranch: "archive-settings-overhaul",
              state: "open",
            },
          };
        }
        if (body._tag === WS_METHODS.gitPreparePullRequestThread) {
          return {
            pullRequest: {
              number: 1359,
              title: "Add thread archiving and settings navigation",
              url: "https://github.com/pingdotgg/t3code/pull/1359",
              baseBranch: "main",
              headBranch: "archive-settings-overhaul",
              state: "open",
            },
            branch: "archive-settings-overhaul",
            worktreePath: "/repo/worktrees/pr-1359",
          };
        }
        return undefined;
      },
    });

    try {
      const branchButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "main",
          ) as HTMLButtonElement | null,
        "Unable to find branch selector button.",
      );
      branchButton.click();

      const branchInput = await waitForElement(
        () => document.querySelector<HTMLInputElement>('input[placeholder="Search branches..."]'),
        "Unable to find branch search input.",
      );
      branchInput.focus();
      await page.getByPlaceholder("Search branches...").fill("1359");

      const checkoutItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "Checkout Pull Request",
          ) as HTMLSpanElement | null,
        "Unable to find checkout pull request option.",
      );
      checkoutItem.click();

      const worktreeButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Worktree",
          ) as HTMLButtonElement | null,
        "Unable to find Worktree button.",
      );
      worktreeButton.click();

      await vi.waitFor(
        () => {
          const prepareRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.gitPreparePullRequestThread,
          );
          expect(prepareRequest).toMatchObject({
            _tag: WS_METHODS.gitPreparePullRequestThread,
            cwd: "/repo/project",
            reference: "1359",
            mode: "worktree",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) =>
              request._tag === WS_METHODS.managedRunsLaunchProjectScript &&
              request.cwd === "/repo/worktrees/pr-1359",
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.managedRunsLaunchProjectScript,
            projectId: PROJECT_ID,
            scriptId: "setup",
            threadId: expect.any(String),
            cwd: "/repo/worktrees/pr-1359",
            worktreePath: "/repo/worktrees/pr-1359",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders managed-run snapshots in the header menu with service details", async () => {
    // Audit traceability: ea4d857, 0ae911d.
    const managedRunListeners: Array<(event: ManagedRunStreamEvent) => void> = [];
    installTestNativeApi({
      managedRunsOnEvent: (_projectId, listener) => {
        managedRunListeners.push(listener);
        return () => {
          const index = managedRunListeners.indexOf(listener);
          if (index >= 0) managedRunListeners.splice(index, 1);
        };
      },
    });
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(
        createSnapshotForTargetUser({
          targetMessageId: "msg-managed-runs-menu" as MessageId,
          targetText: "managed runs menu",
        }),
        [
          {
            id: "preview",
            name: "Preview",
            command: "bun run dev",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
      ),
    });

    try {
      const emitManagedRunEvent = (event: ManagedRunStreamEvent) => {
        for (const listener of managedRunListeners) listener(event);
      };
      await vi.waitFor(() => {
        expect(managedRunListeners.length).toBeGreaterThan(0);
      });

      emitManagedRunEvent({
        type: "snapshot",
        projectId: PROJECT_ID,
        runs: [
          createManagedRunSummary({
            runId: "run-snapshot-menu" as ManagedRunSummary["runId"],
            runtimeServices: [
              {
                serviceId: "preview",
                declaredServiceName: "preview",
                resolvedName: "Frontend",
                role: "frontend",
                canonicalHealthCheck: {
                  type: "url",
                  url: "http://localhost:3773",
                },
                validationStatus: "healthy",
                inferenceConfidence: "high",
                inferenceSource: "llm",
                groundedBy: [],
                evidenceLines: [],
                lastCheckedAt: NOW_ISO,
              },
              {
                serviceId: "api",
                declaredServiceName: "api",
                resolvedName: "Backend",
                role: "backend",
                canonicalHealthCheck: {
                  type: "port",
                  port: 4000,
                  host: "127.0.0.1",
                },
                validationStatus: "unhealthy",
                inferenceConfidence: "medium",
                inferenceSource: "llm",
                groundedBy: [],
                evidenceLines: [],
                lastCheckedAt: NOW_ISO,
              },
            ],
          }),
        ],
      });

      await openManagedRunsMenu();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("Preview");
          expect(document.body.textContent).toContain("1/2");
          expect(document.body.textContent).toContain("Frontend");
          expect(document.body.textContent).toContain("Backend");
        },
        { timeout: 8_000, interval: 16 },
      );

      await page.getByText("Frontend").hover();
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("http://localhost:3773");
          expect(document.body.textContent).toContain("healthy");
        },
        { timeout: 8_000, interval: 16 },
      );

      await page.getByText("Backend").hover();
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("http://127.0.0.1:4000");
          expect(document.body.textContent).toContain("unhealthy");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("updates live managed runs and surfaces failure toasts through ChatView", async () => {
    const managedRunListeners: Array<(event: ManagedRunStreamEvent) => void> = [];
    installTestNativeApi({
      managedRunsOnEvent: (_projectId, listener) => {
        managedRunListeners.push(listener);
        return () => {
          const index = managedRunListeners.indexOf(listener);
          if (index >= 0) managedRunListeners.splice(index, 1);
        };
      },
    });
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(
        createSnapshotForTargetUser({
          targetMessageId: "msg-managed-runs-live" as MessageId,
          targetText: "managed runs live",
        }),
        [
          {
            id: "preview",
            name: "Preview",
            command: "bun run dev",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
      ),
    });

    try {
      const emitManagedRunEvent = (event: ManagedRunStreamEvent) => {
        for (const listener of managedRunListeners) listener(event);
      };
      await vi.waitFor(() => {
        expect(managedRunListeners.length).toBeGreaterThan(0);
      });

      emitManagedRunEvent({
        type: "upserted",
        projectId: PROJECT_ID,
        run: createManagedRunSummary({
          runId: "run-live-preview" as ManagedRunSummary["runId"],
          status: "running",
          runtimeServices: [
            {
              serviceId: "preview",
              declaredServiceName: "preview",
              resolvedName: "Frontend",
              role: "frontend",
              canonicalHealthCheck: {
                type: "url",
                url: "http://localhost:3773",
              },
              validationStatus: "healthy",
              inferenceConfidence: "high",
              inferenceSource: "llm",
              groundedBy: [],
              evidenceLines: [],
              lastCheckedAt: NOW_ISO,
            },
          ],
        }),
      });

      await openManagedRunsMenu();
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("Preview");
          expect(document.body.textContent).toContain("Frontend");
        },
        { timeout: 8_000, interval: 16 },
      );

      emitManagedRunEvent({
        type: "upserted",
        projectId: PROJECT_ID,
        run: createManagedRunSummary({
          runId: "run-live-preview" as ManagedRunSummary["runId"],
          status: "failed",
          lastExitCode: 1,
          completedAt: NOW_ISO,
        }),
      });

      await vi.waitFor(
        () => {
          expect(queryToastTitles()).toContain('"Preview" failed (exit code 1)');
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles plan mode with Shift+Tab only while the composer is focused", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-hotkey" as MessageId,
        targetText: "hotkey target",
      }),
    });

    try {
      const initialModeButton = await waitForInteractionModeButton("Chat");
      expect(initialModeButton.title).toContain("enter plan mode");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();

      expect((await waitForInteractionModeButton("Chat")).title).toContain("enter plan mode");

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Plan")).title).toContain(
            "enter plan + accept mode",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Plan + Accept")).title).toContain(
            "return to normal chat mode",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Chat")).title).toContain("enter plan mode");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps orchestration child threads locked until the agent starts", async () => {
    // Audit traceability: 623a434, 3dd6391, 03999e7.
    installTestNativeApi();
    useComposerDraftStore.setState({
      draftsByThreadId: {
        [THREAD_ID]: {
          prompt: "Send this once the worker starts",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          codeSnippets: [],
          ticketAttachments: [],
          skills: [],
          modelSelectionByProvider: {
            codex: {
              provider: "codex",
              model: "gpt-5",
            },
          },
          activeProvider: "codex",
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });

    let run = createOrchestrationRun("pending");
    const orchestrationTicket = {
      id: ORCHESTRATION_TICKET_ID,
      projectId: PROJECT_ID,
      parentId: null,
      ticketNumber: 168,
      identifier: "T3CO-168",
      title: "Composer wait coverage",
      status: "in_progress" as const,
      priority: "high" as const,
      sortOrder: 0,
      isArchived: false,
      worktree: null,
      labels: [],
      subTicketCount: 0,
      dependencyCount: 0,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createOrchestrationWaitingSnapshot(),
      resolveRpc: (body) => {
        const tag = String(body._tag);
        if (tag === ORCHESTRATION_WS_METHODS.listRuns || tag.endsWith("listRuns")) {
          return [
            {
              id: run.id,
              orchestrationThreadId: run.orchestrationThreadId,
              projectId: run.projectId,
              status: run.status,
              currentTicketIndex: run.currentTicketIndex,
              ticketCount: run.ticketOrder.length,
              currentPhase: run.currentPhase,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
            },
          ];
        }
        if (tag === ORCHESTRATION_WS_METHODS.getRun || tag.endsWith("getRun")) {
          return run;
        }
        if (tag === ORCHESTRATION_WS_METHODS.getChildThreads || tag.endsWith("getChildThreads")) {
          return fixture.snapshot.threads.filter(
            (thread) => thread.parentThreadId === ORCHESTRATION_PARENT_THREAD_ID,
          );
        }
        if (tag === WS_METHODS.ticketingList || tag.endsWith("ticketing.list")) {
          return [orchestrationTicket];
        }
        return undefined;
      },
    });

    try {
      const waitingLabel = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "Waiting for agent to start",
          ) as HTMLSpanElement | null,
        'Unable to find "Waiting for agent to start" status copy.',
      );
      const waitingGroup = waitingLabel.parentElement;
      const centeredWrapper = waitingGroup?.parentElement;
      const messagesPane = centeredWrapper?.parentElement;

      if (
        !(waitingGroup instanceof HTMLDivElement) ||
        !(centeredWrapper instanceof HTMLDivElement) ||
        !(messagesPane instanceof HTMLDivElement)
      ) {
        throw new Error("Expected the orchestration waiting state container to be rendered.");
      }

      await vi.waitFor(() => {
        const wrapperRect = centeredWrapper.getBoundingClientRect();
        const paneRect = messagesPane.getBoundingClientRect();
        const wrapperCenterX = wrapperRect.left + wrapperRect.width / 2;
        const paneCenterX = paneRect.left + paneRect.width / 2;
        const wrapperCenterY = wrapperRect.top + wrapperRect.height / 2;
        const paneCenterY = paneRect.top + paneRect.height / 2;

        expect(waitingGroup.querySelector("svg")).toBeTruthy();
        // Allow a few pixels for sub-pixel layout rounding and container chrome.
        expect(Math.abs(wrapperCenterX - paneCenterX)).toBeLessThanOrEqual(8);
        expect(Math.abs(wrapperCenterY - paneCenterY)).toBeLessThanOrEqual(8);
      });

      expect(findComposerProviderModelPicker()).toBeTruthy();
      expect(findComposerProviderModelPicker()?.disabled).toBe(true);

      const waitingSendButton = await waitForWaitingSendButton();
      expect(waitingSendButton.disabled).toBe(true);

      waitingSendButton.click();
      await waitForLayout();

      expect(
        wsRequests.some(
          (candidate) =>
            candidate._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
            candidate.type === "thread.turn.start",
        ),
      ).toBe(false);

      useStore.setState((state) => {
        const activeThread = state.threadsById[THREAD_ID];
        const sidebarThread = state.sidebarThreadsById[THREAD_ID];
        if (!activeThread || !sidebarThread) {
          return state;
        }

        const session = {
          provider: "codex" as const,
          status: "ready" as const,
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          orchestrationStatus: "ready" as const,
        };

        return {
          ...state,
          threadsById: {
            ...state.threadsById,
            [THREAD_ID]: {
              ...activeThread,
              session,
            },
          },
          sidebarThreadsById: {
            ...state.sidebarThreadsById,
            [THREAD_ID]: {
              ...sidebarThread,
              session,
            },
          },
        };
      });

      const sendButton = await waitForSendButton();
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").not.toContain("Waiting for agent to start");
        expect(findComposerProviderModelPicker()?.disabled).toBe(false);
        expect(sendButton.disabled).toBe(false);
      });

      sendButton.click();

      await vi.waitFor(
        () => {
          expect(
            wsRequests.some(
              (candidate) =>
                candidate._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
                candidate.type === "thread.turn.start",
            ),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders orchestration parent threads as timeline-only shells and switches between parent and child threads", async () => {
    // Audit traceability: 3b13b26, 5b6a8b2.
    installTestNativeApi();
    const run = createOrchestrationRun("running");
    const orchestrationTicket = {
      id: ORCHESTRATION_TICKET_ID,
      projectId: PROJECT_ID,
      parentId: null,
      ticketNumber: 168,
      identifier: "T3CO-168",
      title: "Composer wait coverage",
      status: "in_progress" as const,
      priority: "high" as const,
      sortOrder: 0,
      isArchived: false,
      worktree: null,
      labels: [],
      subTicketCount: 0,
      dependencyCount: 0,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createOrchestrationWaitingSnapshot(),
      resolveRpc: (body) => {
        const tag = String(body._tag);
        if (tag === ORCHESTRATION_WS_METHODS.listRuns || tag.endsWith("listRuns")) {
          return [
            {
              id: run.id,
              orchestrationThreadId: run.orchestrationThreadId,
              projectId: run.projectId,
              status: run.status,
              currentTicketIndex: run.currentTicketIndex,
              ticketCount: run.ticketOrder.length,
              currentPhase: run.currentPhase,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
            },
          ];
        }
        if (tag === ORCHESTRATION_WS_METHODS.getRun || tag.endsWith("getRun")) {
          return run;
        }
        if (tag === ORCHESTRATION_WS_METHODS.getChildThreads || tag.endsWith("getChildThreads")) {
          return fixture.snapshot.threads.filter(
            (thread) => thread.parentThreadId === ORCHESTRATION_PARENT_THREAD_ID,
          );
        }
        if (tag === WS_METHODS.ticketingList || tag.endsWith("ticketing.list")) {
          return [orchestrationTicket];
        }
        return undefined;
      },
    });

    try {
      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: ORCHESTRATION_PARENT_THREAD_ID },
      });
      await waitForURL(
        mounted.router,
        (path) => path === `/${ORCHESTRATION_PARENT_THREAD_ID}`,
        "Route should navigate to the orchestration parent thread.",
      );

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Running");
        expect(document.body.textContent ?? "").toContain("Waiting child thread");
        expect(document.body.textContent ?? "").toContain("Orchestration");
      });

      expect(document.querySelector('[data-chat-composer-form="true"]')).toBeNull();
      expect(document.querySelector('[contenteditable="true"]')).toBeNull();
      expect(document.body.textContent ?? "").not.toContain("Waiting for agent to start");

      const switcherButton = await waitForButtonContainingText("Orchestration timeline");
      switcherButton.click();

      const timelineItem = await waitForMenuItemContainingText("Timeline");
      const childItem = await waitForMenuItemContainingText("T3CO-168");
      expect(childItem.textContent ?? "").toContain("Waiting child thread");

      childItem.click();

      await waitForURL(
        mounted.router,
        (path) => path === `/${THREAD_ID}`,
        "Route should navigate to the orchestration child thread.",
      );
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Timeline");
        expect(document.querySelector('[data-chat-composer-form="true"]')).toBeTruthy();
      });

      expect(findButtonContainingText("T3CO-168")).toBeTruthy();
      expect(findComposerProviderModelPicker()).toBeTruthy();

      const childSwitcherButton = await waitForButtonContainingText("T3CO-168");
      childSwitcherButton.click();
      (await waitForMenuItemContainingText("Timeline")).click();

      await waitForURL(
        mounted.router,
        (path) => path === `/${ORCHESTRATION_PARENT_THREAD_ID}`,
        "Route should navigate back to the orchestration parent thread.",
      );
      await vi.waitFor(() => {
        expect(document.querySelector('[data-chat-composer-form="true"]')).toBeNull();
        expect(document.body.textContent ?? "").toContain("Waiting child thread");
      });

      expect(timelineItem.textContent ?? "").toContain("Timeline");
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps metadata-only orchestration parent navigation loading until parent and child content hydrate", async () => {
    installTestNativeApi();
    const run = createOrchestrationRun("running");
    const snapshot = createOrchestrationWaitingSnapshot();
    const startupSnapshot = createStartupSnapshotFromReadModel(snapshot);
    const parentThread = snapshot.threads.find(
      (thread) => thread.id === ORCHESTRATION_PARENT_THREAD_ID,
    );
    const childThreads = snapshot.threads.filter(
      (thread) => thread.parentThreadId === ORCHESTRATION_PARENT_THREAD_ID,
    );
    if (!parentThread || childThreads.length === 0) {
      throw new Error("Expected orchestration parent and child threads in test fixture.");
    }

    const parentContent = createThreadContentFromReadModelThread(parentThread);
    const parentContentDeferred = createDeferred<OrchestrationThreadContent>();
    const childContentDeferred =
      createDeferred<ReadonlyArray<OrchestrationReadModel["threads"][number]>>();
    const parentThreadContentRequests: ThreadId[] = [];
    const childThreadFetchRequests: ThreadId[] = [];
    const orchestrationTicket = {
      id: ORCHESTRATION_TICKET_ID,
      projectId: PROJECT_ID,
      parentId: null,
      ticketNumber: 266,
      identifier: "T3CO-266",
      title: "Lazy orchestration hydration",
      status: "in_progress" as const,
      priority: "high" as const,
      sortOrder: 0,
      isArchived: false,
      worktree: null,
      labels: [],
      subTicketCount: 0,
      dependencyCount: 0,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
      resolveRpc: (body) => {
        const tag = String(body._tag);
        if (tag === ORCHESTRATION_WS_METHODS.getStartupSnapshot) {
          return startupSnapshot;
        }
        if (tag === ORCHESTRATION_WS_METHODS.getThreadContent) {
          const request = body as { threadId?: ThreadId };
          if (request.threadId === ORCHESTRATION_PARENT_THREAD_ID) {
            parentThreadContentRequests.push(request.threadId);
            return parentContentDeferred.promise;
          }
          return new Promise<OrchestrationThreadContent>(() => {});
        }
        if (tag === ORCHESTRATION_WS_METHODS.listRuns || tag.endsWith("listRuns")) {
          return [
            {
              id: run.id,
              orchestrationThreadId: run.orchestrationThreadId,
              projectId: run.projectId,
              status: run.status,
              currentTicketIndex: run.currentTicketIndex,
              ticketCount: run.ticketOrder.length,
              currentPhase: run.currentPhase,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
            },
          ];
        }
        if (tag === ORCHESTRATION_WS_METHODS.getRun || tag.endsWith("getRun")) {
          return run;
        }
        if (tag === ORCHESTRATION_WS_METHODS.getChildThreads || tag.endsWith("getChildThreads")) {
          const request = body as { parentThreadId?: ThreadId };
          if (request.parentThreadId) {
            childThreadFetchRequests.push(request.parentThreadId);
          }
          return childContentDeferred.promise;
        }
        if (tag === WS_METHODS.ticketingList || tag.endsWith("ticketing.list")) {
          return [orchestrationTicket];
        }
        return undefined;
      },
    });

    try {
      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: ORCHESTRATION_PARENT_THREAD_ID },
      });
      await waitForURL(
        mounted.router,
        (path) => path === `/${ORCHESTRATION_PARENT_THREAD_ID}`,
        "Route should navigate to the metadata-only orchestration parent thread.",
      );

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Orchestration timeline");
        expect(text).not.toContain("No orchestration activity yet");
        expect(text).not.toContain("Waiting child thread");
        expect(parentThreadContentRequests).toContain(ORCHESTRATION_PARENT_THREAD_ID);
        expect(childThreadFetchRequests).toContain(ORCHESTRATION_PARENT_THREAD_ID);
      });
      expect(document.querySelector('[data-chat-composer-form="true"]')).toBeNull();
      expect(document.querySelector('[contenteditable="true"]')).toBeNull();

      parentContentDeferred.resolve(parentContent);
      await waitForLayout();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Orchestration timeline");
        expect(text).not.toContain("No orchestration activity yet");
        expect(text).not.toContain("Waiting child thread");
      });

      childContentDeferred.resolve(childThreads);

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Running");
        expect(text).toContain("Waiting child thread");
        expect(text).not.toContain("No orchestration activity yet");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("surfaces review child threads in the switcher while keeping the parent header focused on the current ticket", async () => {
    // Audit traceability: 08f8969, 22cd7dd.
    installTestNativeApi();
    const run = createOrchestrationRun("running", {
      currentPhase: "reviewing",
      reviewIteration: 1,
      includeReviewThread: true,
    });
    const orchestrationTicket = {
      id: ORCHESTRATION_TICKET_ID,
      projectId: PROJECT_ID,
      parentId: null,
      ticketNumber: 189,
      identifier: "T3CO-189",
      title: "Review switcher coverage",
      status: "in_review" as const,
      priority: "high" as const,
      sortOrder: 0,
      isArchived: false,
      worktree: null,
      labels: [],
      subTicketCount: 0,
      dependencyCount: 0,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createOrchestrationWaitingSnapshot({ includeReviewThread: true }),
      resolveRpc: (body) => {
        const tag = String(body._tag);
        if (tag === ORCHESTRATION_WS_METHODS.listRuns || tag.endsWith("listRuns")) {
          return [
            {
              id: run.id,
              orchestrationThreadId: run.orchestrationThreadId,
              projectId: run.projectId,
              status: run.status,
              currentTicketIndex: run.currentTicketIndex,
              ticketCount: run.ticketOrder.length,
              currentPhase: run.currentPhase,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
            },
          ];
        }
        if (tag === ORCHESTRATION_WS_METHODS.getRun || tag.endsWith("getRun")) {
          return run;
        }
        if (tag === ORCHESTRATION_WS_METHODS.getChildThreads || tag.endsWith("getChildThreads")) {
          return fixture.snapshot.threads.filter(
            (thread) => thread.parentThreadId === ORCHESTRATION_PARENT_THREAD_ID,
          );
        }
        if (tag === WS_METHODS.ticketingList || tag.endsWith("ticketing.list")) {
          return [orchestrationTicket];
        }
        return undefined;
      },
    });

    try {
      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: ORCHESTRATION_PARENT_THREAD_ID },
      });
      await waitForURL(
        mounted.router,
        (path) => path === `/${ORCHESTRATION_PARENT_THREAD_ID}`,
        "Route should navigate to the orchestration parent thread.",
      );

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Running");
        expect(text).toContain("Waiting child thread");
        expect(text).not.toContain("Current ticket");
      });

      const switcherButton = await waitForButtonContainingText("Orchestration timeline");
      switcherButton.click();

      const workingItem = await waitForMenuItemContainingText("T3CO-189");
      const reviewItem = await waitForMenuItemContainingText("T3CO-189 Review");
      expect(workingItem.textContent ?? "").toContain("Waiting child thread");
      expect(reviewItem.textContent ?? "").toContain("Review");
      expect(reviewItem.textContent ?? "").toContain("Review child thread");

      reviewItem.click();

      await waitForURL(
        mounted.router,
        (path) => path === `/${ORCHESTRATION_REVIEW_THREAD_ID}`,
        "Route should navigate to the orchestration review child thread.",
      );
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Timeline");
        expect(text).toContain("Send a message to start the conversation.");
        expect(text).not.toContain("Current ticket");
      });

      const reviewSwitcherButton = await waitForButtonContainingText("T3CO-189 Review");
      reviewSwitcherButton.click();
      (await waitForMenuItemContainingText("Timeline")).click();

      await waitForURL(
        mounted.router,
        (path) => path === `/${ORCHESTRATION_PARENT_THREAD_ID}`,
        "Route should navigate back to the orchestration parent thread.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders resolved MCP server names and refreshes them after config changes", async () => {
    // Audit traceability: 623a434, 3dd6391, 03999e7.
    resolvedMcpServerNames = ["Filesystem", "Project Tickets"];
    const resolveMcpServers = vi.fn(async (_input: unknown) => ({
      status: "ready" as const,
      serverNames: resolvedMcpServerNames,
    }));
    installTestNativeApi({
      resolveMcpServers,
    });
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-mcp-disclosure-target" as MessageId,
        targetText: "mcp disclosure target",
      }),
    });

    try {
      await waitForServerConfigToApply();
      const mcpButton = await waitForMcpServersButton();
      await vi.waitFor(
        () => {
          expect(resolveMcpServers).toHaveBeenCalledTimes(1);
          expect(resolveMcpServers).toHaveBeenCalledWith(
            expect.objectContaining({
              provider: "codex",
              projectId: PROJECT_ID,
              cwd: "/repo/project",
            }),
          );
          expect(resolveMcpServers.mock.calls[0]?.[0]).not.toHaveProperty("threadId");
        },
        { timeout: 8_000, interval: 16 },
      );

      mcpButton.click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("MCP Servers");
        expect(text).toContain("Filesystem");
        expect(text).toContain("Project Tickets");
        expect(text).not.toContain("Runtime access");
        expect(text).not.toContain("Full access");
      });

      const resolveRequestCount = resolveMcpServers.mock.calls.length;

      mcpButton.click();

      resolvedMcpServerNames = ["Prompt Registry"];
      applyServerConfigEvent({
        version: 1,
        type: "mcpConfigChanged",
      });

      await vi.waitFor(() => {
        expect(resolveMcpServers.mock.calls.length).toBeGreaterThan(resolveRequestCount);
      });

      mcpButton.click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Prompt Registry");
        expect(text).not.toContain("Project Tickets");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders live MCP server status grouped by scope when available", async () => {
    const liveServers: readonly ResolvedMcpServer[] = [
      {
        name: "github-personal",
        status: "connected",
        scope: "user",
        toolCount: 41,
      },
      {
        name: "monday",
        status: "needs-auth",
        scope: "claudeai",
      },
    ];
    const resolveMcpServers = vi.fn(async (_input: unknown) => ({
      status: "ready" as const,
      serverNames: liveServers.map((server) => server.name),
      servers: liveServers,
    }));
    installTestNativeApi({
      resolveMcpServers,
    });
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-mcp-live-status-target" as MessageId,
        targetText: "mcp live status target",
      }),
    });

    try {
      await waitForServerConfigToApply();
      const mcpButton = await waitForMcpServersButton();

      await vi.waitFor(
        () => {
          expect(resolveMcpServers).toHaveBeenCalledTimes(1);
        },
        { timeout: 8_000, interval: 16 },
      );

      mcpButton.click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("MCP Servers");
        expect(text).toContain("github-personal");
        expect(text).toContain("monday");
        expect(text).toContain("needs-auth");
        expect(text).toContain("user");
        expect(text).toContain("claudeai");
      });
      expect(document.querySelector('[title*="41 tools"]')).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("forces a Claude MCP refresh when retry is clicked from the MCP menu", async () => {
    const liveServers: readonly ResolvedMcpServer[] = [
      {
        name: "github-personal",
        status: "connected",
        scope: "user",
      },
    ];
    const resolveMcpServers = vi.fn(async (_input: unknown) => ({
      status: "ready" as const,
      serverNames: liveServers.map((server) => server.name),
      servers: liveServers,
    }));
    installTestNativeApi({
      resolveMcpServers,
    });
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-mcp-claude-retry-target" as MessageId,
        targetText: "mcp claude retry target",
        providerName: "claudeAgent",
      }),
    });

    try {
      await waitForServerConfigToApply();
      const mcpButton = await waitForMcpServersButton();

      await vi.waitFor(
        () => {
          expect(resolveMcpServers).toHaveBeenCalledTimes(1);
          expect(resolveMcpServers.mock.calls[0]?.[0]).toMatchObject({
            provider: "claudeAgent",
            projectId: PROJECT_ID,
            cwd: "/repo/project",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      mcpButton.click();

      const retryButton = await vi.waitFor(() => {
        const button = document.querySelector(
          'button[aria-label="Retry MCP status"]',
        ) as HTMLButtonElement | null;
        expect(button).not.toBeNull();
        return button!;
      });
      retryButton.click();

      await vi.waitFor(() => {
        expect(resolveMcpServers.mock.calls.length).toBeGreaterThan(1);
        expect(resolveMcpServers.mock.calls.at(-1)?.[0]).toMatchObject({
          provider: "claudeAgent",
          projectId: PROJECT_ID,
          cwd: "/repo/project",
          forceRefresh: true,
        });
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("discovers skills and keeps attach, dedupe, and chip removal in sync with draft state", async () => {
    // Audit traceability: a5e40ae.
    const resolveSkills = vi.fn(async () => ({
      skills: [
        {
          id: "skill-build",
          name: "Build",
          source: "project",
          absolutePath: "/repo/project/.claude/skills/build/SKILL.md",
          relativePath: ".claude/skills/build/SKILL.md",
          content: "# Build instructions",
          group: null,
        },
      ] satisfies readonly SkillEntry[],
    }));
    installTestNativeApi({ resolveSkills });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-skill-picker-target" as MessageId,
        targetText: "skill picker target",
      }),
    });

    try {
      await vi.waitFor(() => {
        expect(resolveSkills).toHaveBeenCalled();
      });

      const skillsButton = await waitForSkillsButton();
      skillsButton.click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Build");
      });

      await page.getByRole("menuitem", { name: "Build" }).click();

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.skills).toEqual([
            {
              id: "skill-build",
              name: "Build",
              source: "project",
              absolutePath: "/repo/project/.claude/skills/build/SKILL.md",
              relativePath: ".claude/skills/build/SKILL.md",
              content: "# Build instructions",
              group: null,
            },
          ]);
          expect(document.body.textContent ?? "").toContain("Build");
        },
        { timeout: 8_000, interval: 16 },
      );

      skillsButton.click();

      await vi.waitFor(() => {
        const attachedItem = Array.from(
          document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ).find((element) => element.textContent?.includes("Build"));
        expect(attachedItem?.getAttribute("data-disabled")).toBe("");
      });

      skillsButton.click();
      await page.getByRole("button", { name: "Remove Build skill" }).click();

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toBeUndefined();
          expect(document.body.textContent ?? "").not.toContain("Remove Build skill");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("rehydrates persisted skills with null content and prefixes sends with the resolved skill block", async () => {
    // Audit traceability: a5e40ae.
    useComposerDraftStore.setState({
      draftsByThreadId: {
        [THREAD_ID]: {
          prompt: "Use the attached skill.",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          codeSnippets: [],
          ticketAttachments: [],
          skills: [
            {
              id: "skill-rehydrated",
              name: "Deploy",
              source: "project",
              absolutePath: "/repo/project/.claude/skills/deploy/SKILL.md",
              relativePath: ".claude/skills/deploy/SKILL.md",
              content: null,
              group: null,
            },
          ],
          modelSelectionByProvider: {
            codex: {
              provider: "codex",
              model: "gpt-5",
            },
          },
          activeProvider: "codex",
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      },
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });

    const resolveSkills = vi.fn(async () => ({
      skills: [
        {
          id: "skill-rehydrated",
          name: "Deploy",
          source: "project",
          absolutePath: "/repo/project/.claude/skills/deploy/SKILL.md",
          relativePath: ".claude/skills/deploy/SKILL.md",
          content: "Run `bun lint` before every deploy.",
          group: null,
        },
      ] satisfies readonly SkillEntry[],
    }));
    installTestNativeApi({ resolveSkills });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-skill-rehydration-target" as MessageId,
        targetText: "skill rehydration target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(resolveSkills).toHaveBeenCalled();
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.skills).toEqual([
            {
              id: "skill-rehydrated",
              name: "Deploy",
              source: "project",
              absolutePath: "/repo/project/.claude/skills/deploy/SKILL.md",
              relativePath: ".claude/skills/deploy/SKILL.md",
              content: "Run `bun lint` before every deploy.",
              group: null,
            },
          ]);
          expect(document.body.textContent ?? "").not.toContain("loading…");
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          const request = wsRequests.find(
            (candidate) =>
              candidate._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              candidate.type === "thread.turn.start",
          );
          expect(request).toBeTruthy();

          const turnStartRequest = request as unknown as { message: { text: string } };
          expect(turnStartRequest.message.text).toContain('<skill name="Deploy"');
          expect(turnStartRequest.message.text).toContain("Run `bun lint` before every deploy.");
          expect(turnStartRequest.message.text).toContain("Use the attached skill.");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates initial drafts with prompt text and multiple resolved skills", async () => {
    // Audit traceability: eb1fe8e.
    const resolveSkills = vi.fn(async () => ({
      skills: [
        {
          id: "skill-plan",
          name: "Plan",
          source: "project",
          absolutePath: "/repo/project/.claude/skills/plan/SKILL.md",
          relativePath: ".claude/skills/plan/SKILL.md",
          content: "# Plan skill",
          group: null,
        },
        {
          id: "skill-ship",
          name: "Ship",
          source: "project",
          absolutePath: "/repo/project/.claude/skills/ship/SKILL.md",
          relativePath: ".claude/skills/ship/SKILL.md",
          content: "# Ship skill",
          group: null,
        },
      ] satisfies readonly SkillEntry[],
    }));
    installTestNativeApi({ resolveSkills });

    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-initial-draft-multi-skill" as MessageId,
      targetText: "hydrate my draft",
    });
    const snapshot: OrchestrationReadModel = {
      ...baseSnapshot,
      threads: baseSnapshot.threads.map((thread) =>
        thread.id === THREAD_ID
          ? {
              ...thread,
              initialDraft: {
                prompt: "Start with a release checklist.",
                skillIds: ["skill-plan", "skill-ship"],
              },
            }
          : thread,
      ),
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
    });

    try {
      await vi.waitFor(
        () => {
          expect(resolveSkills).toHaveBeenCalled();
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toMatchObject({
            prompt: "Start with a release checklist.",
            skills: [
              {
                id: "skill-plan",
                name: "Plan",
                content: "# Plan skill",
              },
              {
                id: "skill-ship",
                name: "Ship",
                content: "# Ship skill",
              },
            ],
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps removed terminal context pills removed when a new one is added", async () => {
    const removedLabel = "Terminal 1 lines 1-2";
    const addedLabel = "Terminal 2 lines 9-10";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-removed",
        terminalLabel: "Terminal 1",
        lineStart: 1,
        lineEnd: 2,
        text: "bun i\nno changes",
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-terminal-pill-backspace" as MessageId,
        targetText: "terminal pill backspace target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const store = useComposerDraftStore.getState();
      const currentPrompt = store.draftsByThreadId[THREAD_ID]?.prompt ?? "";
      const nextPrompt = removeInlineTerminalContextPlaceholder(currentPrompt, 0);
      store.setPrompt(THREAD_ID, nextPrompt.prompt);
      store.removeTerminalContext(THREAD_ID, "ctx-removed");

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toBeUndefined();
          expect(document.body.textContent).not.toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().addTerminalContext(
        THREAD_ID,
        createTerminalContext({
          id: "ctx-added",
          terminalLabel: "Terminal 2",
          lineStart: 9,
          lineEnd: 10,
          text: "git status\nOn branch main",
        }),
      );

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-added"]);
          expect(document.body.textContent).toContain(addedLabel);
          expect(document.body.textContent).not.toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables send when the composer only contains an expired terminal pill", async () => {
    const expiredLabel = "Terminal 1 line 4";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-expired-only",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "",
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-expired-pill-disabled" as MessageId,
        targetText: "expired pill disabled target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(expiredLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("warns when sending text while omitting expired terminal pills", async () => {
    const expiredLabel = "Terminal 1 line 4";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-expired-send-warning",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "",
      }),
    );
    useComposerDraftStore
      .getState()
      .setPrompt(THREAD_ID, `yoo${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}waddup`);

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-expired-pill-warning" as MessageId,
        targetText: "expired pill warning target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(expiredLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(
            "Expired terminal context omitted from message",
          );
          expect(document.body.textContent).not.toContain(expiredLabel);
          expect(document.body.textContent).toContain("yoowaddup");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps removable ticket chips in sync with draft state and prefixes sends with Ticket ids", async () => {
    // Audit traceability: aa1e7da.
    useComposerDraftStore.getState().setPrompt(THREAD_ID, "Please pick this up next.");
    useComposerDraftStore.getState().addTicketAttachment(THREAD_ID, {
      id: "ticket-123",
      identifier: "T3CO-123",
      title: "Board drag regression",
    });
    useComposerDraftStore.getState().addTicketAttachment(THREAD_ID, {
      id: "ticket-456",
      identifier: "T3CO-456",
      title: "Composer continuity regression",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-ticket-attachments-send" as MessageId,
        targetText: "ticket attachment send target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          const text = document.body.textContent ?? "";
          expect(text).toContain("T3CO-123");
          expect(text).toContain("Board drag regression");
          expect(text).toContain("T3CO-456");
          expect(text).toContain("Composer continuity regression");
        },
        { timeout: 8_000, interval: 16 },
      );

      await page.getByRole("button", { name: "Remove T3CO-456" }).click();

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.ticketAttachments).toEqual([
            {
              id: "ticket-123",
              identifier: "T3CO-123",
              title: "Board drag regression",
            },
          ]);
          expect(document.body.textContent ?? "").not.toContain("Composer continuity regression");
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          const request = wsRequests.find(
            (candidate) =>
              candidate._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              candidate.type === "thread.turn.start",
          );
          expect(request).toBeTruthy();
          const turnStartRequest = request as unknown as { message: { text: string } };
          expect(turnStartRequest.message.text).toContain("Ticket ids: T3CO-123");
          expect(turnStartRequest.message.text).toContain("Please pick this up next.");
          expect(turnStartRequest.message.text).not.toContain("T3CO-456");
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toMatchObject({
            prompt: "Please pick this up next.",
            ticketAttachments: [],
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps snippet chips in sync with draft state and prefixes sends with snippet preambles", async () => {
    // Audit traceability: 216652d, aba3612.
    useComposerDraftStore.getState().setPrompt(THREAD_ID, "Please use this snippet.");
    useComposerDraftStore.getState().addCodeSnippet(THREAD_ID, {
      id: "snippet-1",
      cwd: "/repo/project",
      relativePath: "src/app.ts",
      startLine: 3,
      endLine: 5,
      code: "const value = 42;\nconsole.log(value);",
    });
    useComposerDraftStore.getState().addCodeSnippet(THREAD_ID, {
      id: "snippet-2",
      cwd: "/repo/project",
      relativePath: "README.md",
      startLine: 1,
      endLine: 1,
      code: "# README",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-snippet-send" as MessageId,
        targetText: "snippet send target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          const text = document.body.textContent ?? "";
          expect(text).toContain("app.ts:3–5");
          expect(text).toContain("README.md:1");
        },
        { timeout: 8_000, interval: 16 },
      );

      await page.getByRole("button", { name: "Remove README.md snippet" }).click();

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.codeSnippets).toEqual([
            {
              id: "snippet-1",
              cwd: "/repo/project",
              relativePath: "src/app.ts",
              startLine: 3,
              endLine: 5,
              code: "const value = 42;\nconsole.log(value);",
            },
          ]);
          expect(document.body.textContent ?? "").not.toContain("README.md:1");
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          const request = wsRequests.find(
            (candidate) =>
              candidate._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              candidate.type === "thread.turn.start",
          );
          expect(request).toBeTruthy();
          const turnStartRequest = request as unknown as { message: { text: string } };
          expect(turnStartRequest.message.text).toContain("`src/app.ts` (lines 3–5):");
          expect(turnStartRequest.message.text).toContain("const value = 42;");
          expect(turnStartRequest.message.text).toContain("Please use this snippet.");
          expect(turnStartRequest.message.text).not.toContain("`README.md`");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("converts pasted registered editor copies into composer snippet chips", async () => {
    // Audit traceability: e2bee71, 877d7ca.
    const copiedSnippet = "const answer = 42;\nconsole.log(answer);\n";
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-editor-snippet-paste" as MessageId,
        targetText: "editor snippet paste target",
      }),
    });

    try {
      registerClipboardSnippet({
        text: copiedSnippet,
        cwd: "/repo/project",
        relativePath: "src/app.ts",
        startLine: 1,
        endLine: 2,
      });

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      dispatchTextPaste(composerEditor, copiedSnippet);

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.prompt ?? "").toBe("");
          expect(draft?.codeSnippets).toEqual([
            {
              id: expect.any(String),
              cwd: "/repo/project",
              relativePath: "src/app.ts",
              startLine: 1,
              endLine: 2,
              code: copiedSnippet,
            },
          ]);
          expect(document.body.textContent ?? "").toContain("app.ts:1–2");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps diff-text paste as plain composer text without creating a snippet chip", async () => {
    // Audit traceability: e2bee71, 877d7ca.
    const pastedDiffText = [
      "diff --git a/src/app.ts b/src/app.ts",
      "@@ -1,1 +1,1 @@",
      "-const before = 1;",
      "+const after = 2;",
    ].join("\n");
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-diff-plain-paste" as MessageId,
        targetText: "diff plain paste target",
      }),
    });

    try {
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      dispatchTextPaste(composerEditor, pastedDiffText);

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.prompt ?? "").toContain("const after = 2;");
          expect(draft?.codeSnippets ?? []).toEqual([]);
          expect(document.body.textContent ?? "").not.toContain("app.ts:1–2");
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          const request = wsRequests.find(
            (candidate) =>
              candidate._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              candidate.type === "thread.turn.start",
          );
          expect(request).toBeTruthy();
          const turnStartRequest = request as unknown as { message: { text: string } };
          expect(turnStartRequest.message.text).toContain(pastedDiffText);
          expect(turnStartRequest.message.text).not.toContain("`src/app.ts` (lines 1–2):");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens markdown file links into the explorer, reuses existing tabs, and records line-column jumps", async () => {
    useFileExplorerStore.getState().openFile("/repo/project", "src/app.ts", "primary");
    const existingTabId = makeTabIdFromPath("/repo/project", "src/app.ts");
    useFileExplorerStore.getState().createSplit("right", existingTabId, "/repo/project");

    function FileLinkHarness() {
      const [fileExplorerOpen, setFileExplorerOpen] = useState(false);
      const openFileAtLine = useFileExplorerStore((state) => state.openFileAtLine);

      return (
        <div>
          <div data-testid="file-explorer-state">{fileExplorerOpen ? "open" : "closed"}</div>
          <ChatMarkdown
            text="Open [app](src/app.ts#L7C3)."
            cwd="/repo/project"
            onOpenFileLink={(absolutePath, line, column) => {
              const relativePath =
                relativePathWithinWorkspace(absolutePath, "/repo/project") ?? absolutePath;
              openFileAtLine("/repo/project", relativePath, line, column, "primary");
              setFileExplorerOpen(true);
            }}
          />
        </div>
      );
    }

    const screen = await render(<FileLinkHarness />);

    try {
      const fileLink = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).find(
            (element) => element.textContent?.trim() === "app",
          ) ?? null,
        "Unable to find markdown file link.",
      );
      fileLink.click();

      await vi.waitFor(
        () => {
          expect(document.querySelector('[data-testid="file-explorer-state"]')?.textContent).toBe(
            "open",
          );
          const state = useFileExplorerStore.getState();
          const workspace = state.workspaceStatesByCwd["/repo/project"];
          expect(workspace).toBeDefined();
          expect(workspace?.activePaneId).toBe("secondary");
          expect(workspace?.panes.secondary.activeTabId).toBe(existingTabId);
          expect(workspace?.panes.secondary.tabIds).toEqual([existingTabId]);
          expect(state.pendingRevealPathByCwd["/repo/project"]).toBe("src/app.ts");
          expect(state.pendingScrollTargetByTabId[existingTabId]).toEqual({ line: 7, column: 3 });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await screen.unmount();
    }
  });

  it("shows a pointer cursor for the running stop button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-stop-button-cursor" as MessageId,
        targetText: "stop button cursor target",
        sessionStatus: "running",
      }),
    });

    try {
      const stopButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Stop generation"]'),
        "Unable to find stop generation button.",
      );

      expect(getComputedStyle(stopButton).cursor).toBe("pointer");
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides the archive action when the pointer leaves a thread row", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-archive-hover-test" as MessageId,
        targetText: "archive hover target",
      }),
    });

    try {
      const threadRow = page.getByTestId(`thread-row-${THREAD_ID}`);

      await expect.element(threadRow).toBeInTheDocument();
      const archiveButton = await waitForElement(
        () =>
          document.querySelector<HTMLButtonElement>(`[data-testid="thread-archive-${THREAD_ID}"]`),
        "Unable to find archive button.",
      );
      const archiveAction = archiveButton.parentElement;
      expect(
        archiveAction,
        "Archive button should render inside a visibility wrapper.",
      ).not.toBeNull();
      expect(getComputedStyle(archiveAction!).opacity).toBe("0");

      await threadRow.hover();
      await vi.waitFor(
        () => {
          expect(getComputedStyle(archiveAction!).opacity).toBe("1");
        },
        { timeout: 4_000, interval: 16 },
      );

      await page.getByTestId("composer-editor").hover();
      await vi.waitFor(
        () => {
          expect(getComputedStyle(archiveAction!).opacity).toBe("0");
        },
        { timeout: 4_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows the confirm archive action after clicking the archive button", async () => {
    localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        confirmThreadArchive: true,
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-archive-confirm-test" as MessageId,
        targetText: "archive confirm target",
      }),
    });

    try {
      const threadRow = page.getByTestId(`thread-row-${THREAD_ID}`);

      await expect.element(threadRow).toBeInTheDocument();
      await threadRow.hover();

      const archiveButton = page.getByTestId(`thread-archive-${THREAD_ID}`);
      await expect.element(archiveButton).toBeInTheDocument();
      await archiveButton.click();

      const confirmButton = page.getByTestId(`thread-archive-confirm-${THREAD_ID}`);
      await expect.element(confirmButton).toBeInTheDocument();
      await expect.element(confirmButton).toBeVisible();
    } finally {
      localStorage.removeItem("t3code:client-settings:v1");
      await mounted.cleanup();
    }
  });

  it("shows the profiled provider rate-limit meter without hiding the plan toggle", async () => {
    // Audit traceability: d725479, 2178f31.
    installTestNativeApi();
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-rate-limit-profiled" as MessageId,
      targetText: "profiled rate limit target",
    });
    const snapshot = {
      ...baseSnapshot,
      threads: baseSnapshot.threads.map((thread) =>
        thread.id === THREAD_ID
          ? {
              ...thread,
              modelSelection: {
                provider: "claudeAgent" as const,
                profileId: "metric",
                model: "claude-opus-4-6",
              },
            }
          : thread,
      ),
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          providers: [
            createProvider({ provider: "codex" }),
            createProvider({
              provider: "claudeAgent",
              displayName: "Claude",
              models: [
                {
                  slug: "claude-opus-4-6",
                  name: "Claude Opus 4.6",
                  isCustom: false,
                  capabilities: {
                    reasoningEffortLevels: [],
                    supportsFastMode: false,
                    supportsThinkingToggle: false,
                    supportsPlan: true,
                    contextWindowOptions: [],
                    promptInjectedEffortLevels: [],
                  },
                },
              ],
            }),
            createProvider({
              provider: "claudeAgent:metric",
              displayName: "Claude (metric)",
              models: [
                {
                  slug: "claude-opus-4-6",
                  name: "Claude Opus 4.6",
                  isCustom: false,
                  capabilities: {
                    reasoningEffortLevels: [],
                    supportsFastMode: false,
                    supportsThinkingToggle: false,
                    supportsPlan: true,
                    contextWindowOptions: [],
                    promptInjectedEffortLevels: [],
                  },
                },
              ],
            }),
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      applyServerConfigEvent({
        version: 1,
        type: "rateLimitsUpdated",
        payload: {
          rateLimits: [
            {
              provider: "claudeAgent:metric" as never,
              rateLimitInfo: {
                status: "allowed",
                utilization: 0.82,
                rateLimitType: "five_hour",
                resetsAt: 1_800_000_000,
              },
              updatedAt: NOW_ISO,
              oauthUsageTiers: [
                {
                  tier: "five_hour",
                  utilization: 0.82,
                  resetsAt: "2026-04-11T12:30:00.000Z",
                },
              ],
              fetchWarning: "Usage data is temporarily unavailable while the provider backs off.",
            },
          ],
        },
      });

      await expect
        .element(page.getByRole("button", { name: "Rate limit 82% used" }))
        .toBeInTheDocument();
      expect(await waitForInteractionModeButton("Chat")).toBeTruthy();

      await page.getByRole("button", { name: "Rate limit 82% used" }).click();
      await expect
        .element(
          page.getByText("Usage data is temporarily unavailable while the provider backs off."),
        )
        .toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("supports message-selection range picks and exits selection mode on Escape", async () => {
    installTestNativeApi({
      showContextMenu: async () => "select",
    });
    const targetMessageId = "msg-user-selection-target" as MessageId;
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: "message selection target",
      }),
    });

    try {
      const targetMessage = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-message-role="user"]')).at(-1) ??
          null,
        "Unable to find the target message row.",
      );
      const selectedTargetMessageId = targetMessage.dataset.messageId as MessageId;
      targetMessage.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 24,
          clientY: 24,
        }),
      );

      await vi.waitFor(() => {
        const state = useMessageSelectionStore.getState();
        expect(state.selectionMode).toBe(true);
        expect(state.selectedMessageIds.has(selectedTargetMessageId)).toBe(true);
      });

      const uncheckedCheckbox = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]')).find(
            (element) => element.getAttribute("aria-checked") === "false",
          ) ?? null,
        "Unable to find an unchecked selection checkbox.",
      );
      uncheckedCheckbox.click();

      await vi.waitFor(() => {
        const state = useMessageSelectionStore.getState();
        expect(state.selectedMessageIds.has(selectedTargetMessageId)).toBe(true);
        expect(state.selectedMessageIds.size).toBeGreaterThan(1);
        expect(document.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(1);
      });

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(() => {
        const state = useMessageSelectionStore.getState();
        expect(state.selectionMode).toBe(false);
        expect(state.selectedMessageIds.size).toBe(0);
        expect(document.querySelector('[role="checkbox"]')).toBeNull();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("deletes the selected messages from the multi-select context menu", async () => {
    const confirmCalls: string[] = [];
    const dispatchedCommands: Array<Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0]> =
      [];
    installTestNativeApi({
      showContextMenu: async (items) => {
        if (items.some((item) => item.id === "select")) {
          return "select";
        }
        if (items.some((item) => item.id === "delete")) {
          return "delete";
        }
        throw new Error(
          `Unexpected context menu items: ${items.map((item) => item.id).join(", ")}`,
        );
      },
      confirm: async (message) => {
        confirmCalls.push(message);
        return true;
      },
      dispatchCommand: async (payload) => {
        dispatchedCommands.push(payload);
        return { sequence: 1 };
      },
    });
    const targetMessageId = "msg-user-delete-target" as MessageId;
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: "message delete target",
      }),
    });

    try {
      const targetMessage = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-message-role="user"]')).at(-1) ??
          null,
        "Unable to find the target message row.",
      );
      targetMessage.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 18,
          clientY: 18,
        }),
      );

      await vi.waitFor(() => {
        expect(useMessageSelectionStore.getState().selectionMode).toBe(true);
      });

      const uncheckedCheckbox = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]')).find(
            (element) => element.getAttribute("aria-checked") === "false",
          ) ?? null,
        "Unable to find an unchecked selection checkbox.",
      );
      uncheckedCheckbox.click();

      targetMessage.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 18,
          clientY: 18,
        }),
      );

      await vi.waitFor(() => {
        const request = dispatchedCommands.find(
          (candidate) => candidate.type === "thread.messages.delete",
        ) as
          | {
              messageIds: MessageId[];
            }
          | undefined;
        expect(request).toBeTruthy();
        expect(request?.messageIds.length ?? 0).toBeGreaterThan(1);
      });

      expect(confirmCalls[0] ?? "").toMatch(/^Delete \d+ messages\?/);
      expect(useMessageSelectionStore.getState().selectionMode).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("confirms, dispatches, and reports sidebar Move to actions", async () => {
    // Audit traceability: d725479.
    const contextMenus: ReadonlyArray<ContextMenuItem<string>>[] = [];
    const confirmCalls: string[] = [];
    const dispatchedCommands: Array<Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0]> =
      [];
    installTestNativeApi({
      showContextMenu: async (items) => {
        contextMenus.push(items);
        return "move::project-2";
      },
      confirm: async (message) => {
        confirmCalls.push(message);
        return true;
      },
      dispatchCommand: async (payload) => {
        dispatchedCommands.push(payload);
        return { sequence: 1 };
      },
    });
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-move-target" as MessageId,
      targetText: "sidebar move target",
    });
    const snapshot = {
      ...baseSnapshot,
      projects: [
        ...baseSnapshot.projects,
        {
          id: "project-2" as ProjectId,
          title: "Project Two",
          workspaceRoot: "/repo/project-two",
          defaultModelSelection: {
            provider: "codex" as const,
            model: "gpt-5",
          },
          scripts: [],
          systemPrompt: null,
          promptOverrides: { orchestration: {} },
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          deletedAt: null,
        },
      ],
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot,
    });

    try {
      const threadRow = page.getByTestId(`thread-row-${THREAD_ID}`);
      await expect.element(threadRow).toBeInTheDocument();
      threadRow.element().dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 16,
          clientY: 16,
        }),
      );

      await vi.waitFor(() => {
        const moveItem = contextMenus[0]?.find((item) => item.id === "move");
        expect(moveItem?.disabled).toBe(false);
        expect(moveItem?.children).toEqual([{ id: "move::project-2", label: "Project Two" }]);
      });

      await vi.waitFor(() => {
        expect(confirmCalls[0]).toContain(
          'Move thread "Browser test thread" to project "Project Two"?',
        );
        expect(confirmCalls[0]).toContain(
          "The thread's worktree and branch association will be cleared.",
        );
      });

      await vi.waitFor(() => {
        expect(
          dispatchedCommands.some(
            (candidate) =>
              candidate.type === "thread.move" && candidate.targetProjectId === "project-2",
          ),
        ).toBe(true);
      });

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Thread moved");
        expect(text).toContain('Moved to "Project Two".');
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("navigates Fork with model into the created thread path without changing global board context", async () => {
    // Audit traceability: fbe355c.
    const contextMenus: ReadonlyArray<ContextMenuItem<string>>[] = [];
    const dispatchedCommands: Array<Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0]> =
      [];
    let forkThreadId: ThreadId | null = null;
    installTestNativeApi({
      showContextMenu: async (items) => {
        contextMenus.push(items);
        return "fork::claudeAgent:metric::claude-opus-4-6";
      },
      dispatchCommand: async (payload) => {
        dispatchedCommands.push(payload);
        if (payload.type === "thread.fork") {
          forkThreadId = payload.threadId;
          fixture.snapshot = addThreadToSnapshot(fixture.snapshot, forkThreadId);
          materializeThreadInStore(forkThreadId);
        }
        return { sequence: 1 };
      },
    });
    useUiStateStore.setState((state) => ({
      ...state,
      managementBoardContext: {
        projectId: PROJECT_ID,
        ticketStack: [ORCHESTRATION_TICKET_ID],
        boardScrollLeft: 24,
        updatedAt: NOW_ISO,
      },
    }));

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-fork-target" as MessageId,
        targetText: "sidebar fork target",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          providers: [
            createProvider({ provider: "codex" }),
            createProvider({
              provider: "claudeAgent:metric",
              displayName: "Claude (metric)",
              models: [
                {
                  slug: "claude-opus-4-6",
                  name: "Claude Opus 4.6",
                  isCustom: false,
                  capabilities: {
                    reasoningEffortLevels: [],
                    supportsFastMode: false,
                    supportsThinkingToggle: false,
                    supportsPlan: true,
                    contextWindowOptions: [],
                    promptInjectedEffortLevels: [],
                  },
                },
              ],
            }),
          ],
        };
      },
    });

    try {
      const threadRow = page.getByTestId(`thread-row-${THREAD_ID}`);
      await expect.element(threadRow).toBeInTheDocument();
      threadRow.element().dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );

      await vi.waitFor(() => {
        const forkItem = contextMenus[0]?.find((item) => item.id === "fork");
        expect(
          forkItem?.children?.some(
            (child) =>
              child.id === "fork::claudeAgent:metric::claude-opus-4-6" &&
              child.label === "Claude (metric) — Claude Opus 4.6",
          ),
        ).toBe(true);
      });

      await vi.waitFor(() => {
        expect(forkThreadId).toBeTruthy();
        expect(
          dispatchedCommands.some(
            (candidate) =>
              candidate.type === "thread.fork" &&
              candidate.sourceThreadId === THREAD_ID &&
              candidate.modelSelection?.provider === "claudeAgent" &&
              candidate.modelSelection?.profileId === "metric",
          ),
        ).toBe(true);
      });

      const expectedForkPath = `/${forkThreadId}`;
      await waitForURL(
        mounted.router,
        (path) => path === expectedForkPath,
        "Route should navigate to the forked thread path.",
      );
      expect(useUiStateStore.getState().managementBoardContext).toMatchObject({
        projectId: PROJECT_ID,
        ticketStack: [ORCHESTRATION_TICKET_ID],
        boardScrollLeft: 24,
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the new thread selected after clicking the new-thread button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-new-thread-test" as MessageId,
        targetText: "new thread selection test",
      }),
    });

    try {
      // Wait for the sidebar to render with the project.
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      // The route should change to a new draft thread ID.
      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      // The composer editor should be present for the new draft thread.
      await waitForComposerEditor();

      // Simulate the steady-state promotion path: the server emits
      // `thread.created`, the client materializes the thread incrementally,
      // and the draft is cleared by live batch effects.
      await promoteDraftThreadViaDomainEvent(newThreadId);

      // The route should still be on the new thread — not redirected away.
      await waitForURL(
        mounted.router,
        (path) => path === newThreadPath,
        "New thread should remain selected after server thread promotion clears the draft.",
      );

      // The empty thread view and composer should still be visible.
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeInTheDocument();
      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the global board context unchanged when creating a same-project draft thread", async () => {
    const ticketId = "ticket-current-context" as TicketId;
    useUiStateStore.setState({
      managementBoardContext: {
        projectId: PROJECT_ID,
        ticketStack: [ticketId],
        boardScrollLeft: 144,
        updatedAt: NOW_ISO,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-board-context-inherit-test" as MessageId,
        targetText: "board context inherit test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useUiStateStore.getState().managementBoardContext).toMatchObject({
        projectId: PROJECT_ID,
        ticketStack: [ticketId],
        boardScrollLeft: 144,
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("preserves the existing global board context when reusing a draft thread", async () => {
    const existingDraftThreadId = "11111111-1111-4111-8111-111111111111" as ThreadId;
    const draftTicketId = "ticket-existing-draft-context" as TicketId;

    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [existingDraftThreadId]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: existingDraftThreadId,
      },
    });
    useUiStateStore.setState({
      managementBoardContext: {
        projectId: PROJECT_ID,
        ticketStack: [draftTicketId],
        boardScrollLeft: 220,
        updatedAt: NOW_ISO,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-draft-board-context-preserve-test" as MessageId,
        targetText: "draft board context preserve test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      await waitForURL(
        mounted.router,
        (path) => path === `/${existingDraftThreadId}`,
        "New-thread should reuse the existing project draft thread.",
      );

      expect(useUiStateStore.getState().managementBoardContext).toMatchObject({
        projectId: PROJECT_ID,
        ticketStack: [draftTicketId],
        boardScrollLeft: 220,
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("snapshots sticky codex settings into a new draft thread", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        codex: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "codex",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-codex-traits-test" as MessageId,
        targetText: "sticky codex traits test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates the provider alongside a sticky claude model", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        claudeAgent: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "claudeAgent",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-claude-model-test" as MessageId,
        targetText: "sticky claude model test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new sticky claude draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          claudeAgent: {
            provider: "claudeAgent",
            model: "claude-opus-4-6",
            options: {
              effort: "max",
              fastMode: true,
            },
          },
        },
        activeProvider: "claudeAgent",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates new drafts from sticky profiled Claude selections and keeps the trigger label", async () => {
    // Audit traceability: e1077b5, 7d6be28.
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        "claudeAgent:metric": {
          provider: "claudeAgent",
          profileId: "metric",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
          },
        },
      },
      stickyActiveProvider: "claudeAgent:metric",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-profiled-claude-test" as MessageId,
        targetText: "sticky profiled claude test",
      }),
      configureFixture: (fixture) => {
        fixture.serverConfig = {
          ...fixture.serverConfig,
          providers: [
            createProvider({ provider: "codex" }),
            createProvider({ provider: "claudeAgent", displayName: "Claude" }),
            createProvider({
              provider: "claudeAgent:metric",
              displayName: "Claude (metric)",
            }),
          ],
        };
      },
    });

    try {
      await page.getByTestId("new-thread-button").click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new profiled claude draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          "claudeAgent:metric": {
            provider: "claudeAgent",
            profileId: "metric",
            model: "claude-opus-4-6",
            options: {
              effort: "max",
            },
          },
        },
        activeProvider: "claudeAgent:metric",
      });

      await vi.waitFor(() => {
        expect(findComposerProviderModelPicker()?.textContent).toContain("metric");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates new drafts from sticky profiled Codex selections and keeps the trigger label", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        "codex:metric": {
          provider: "codex",
          profileId: "metric",
          model: "gpt-5",
          options: {
            reasoningEffort: "high",
          },
        },
      },
      stickyActiveProvider: "codex:metric",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-profiled-codex-test" as MessageId,
        targetText: "sticky profiled codex test",
      }),
      configureFixture: (fixture) => {
        fixture.serverConfig = {
          ...fixture.serverConfig,
          providers: [
            createProvider({ provider: "codex" }),
            createProvider({
              provider: "codex:metric",
              displayName: "Codex (metric)",
            }),
            createProvider({ provider: "claudeAgent", displayName: "Claude" }),
          ],
        };
      },
    });

    try {
      await page.getByTestId("new-thread-button").click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new profiled codex draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          "codex:metric": {
            provider: "codex",
            profileId: "metric",
            model: "gpt-5",
            options: {
              reasoningEffort: "high",
            },
          },
        },
        activeProvider: "codex:metric",
      });

      await vi.waitFor(() => {
        expect(findComposerProviderModelPicker()?.textContent).toContain("metric");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("rehydrates an existing profiled Claude draft selection into the picker label", async () => {
    const profiledDraftThreadId = "2ac8e396-e55f-4f16-9a4a-9deae2dc8b3a" as ThreadId;
    useComposerDraftStore.setState({
      draftsByThreadId: {
        [profiledDraftThreadId]: {
          prompt: "",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          codeSnippets: [],
          skills: [],
          modelSelectionByProvider: {
            "claudeAgent:metric": {
              provider: "claudeAgent",
              profileId: "metric",
              model: "claude-opus-4-6",
            },
          },
          activeProvider: "claudeAgent:metric",
          runtimeMode: "full-access",
          interactionMode: "default",
          ticketAttachments: [],
        },
      },
      draftThreadsByThreadId: {
        [profiledDraftThreadId]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: profiledDraftThreadId,
      },
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-profiled-draft-rehydration-test" as MessageId,
        targetText: "profiled draft rehydration test",
      }),
      configureFixture: (fixture) => {
        fixture.serverConfig = {
          ...fixture.serverConfig,
          providers: [
            createProvider({ provider: "codex" }),
            createProvider({ provider: "claudeAgent", displayName: "Claude" }),
            createProvider({
              provider: "claudeAgent:metric",
              displayName: "Claude (metric)",
            }),
          ],
        };
      },
    });

    try {
      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: profiledDraftThreadId },
      });
      await waitForURL(
        mounted.router,
        (path) => path === `/${profiledDraftThreadId}`,
        "Route should bootstrap into the profiled claude draft thread.",
      );
      await vi.waitFor(() => {
        expect(findComposerProviderModelPicker()?.textContent).toContain("metric");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("rehydrates an existing profiled Codex draft selection into the picker label", async () => {
    const profiledDraftThreadId = "5ac8e396-e55f-4f16-9a4a-9deae2dc8b3a" as ThreadId;
    useComposerDraftStore.setState({
      draftsByThreadId: {
        [profiledDraftThreadId]: {
          prompt: "",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          codeSnippets: [],
          skills: [],
          modelSelectionByProvider: {
            "codex:metric": {
              provider: "codex",
              profileId: "metric",
              model: "gpt-5",
            },
          },
          activeProvider: "codex:metric",
          runtimeMode: "full-access",
          interactionMode: "default",
          ticketAttachments: [],
        },
      },
      draftThreadsByThreadId: {
        [profiledDraftThreadId]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: profiledDraftThreadId,
      },
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-profiled-codex-draft-rehydration-test" as MessageId,
        targetText: "profiled codex draft rehydration test",
      }),
      configureFixture: (fixture) => {
        fixture.serverConfig = {
          ...fixture.serverConfig,
          providers: [
            createProvider({ provider: "codex" }),
            createProvider({
              provider: "codex:metric",
              displayName: "Codex (metric)",
            }),
            createProvider({ provider: "claudeAgent", displayName: "Claude" }),
          ],
        };
      },
    });

    try {
      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: profiledDraftThreadId },
      });
      await waitForURL(
        mounted.router,
        (path) => path === `/${profiledDraftThreadId}`,
        "Route should bootstrap into the profiled codex draft thread.",
      );
      await vi.waitFor(() => {
        expect(findComposerProviderModelPicker()?.textContent).toContain("metric");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to defaults when no sticky composer settings exist", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-default-codex-traits-test" as MessageId,
        targetText: "default codex traits test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toBeUndefined();
    } finally {
      await mounted.cleanup();
    }
  });

  it("prefers draft state over sticky composer settings and defaults", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        codex: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "codex",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-draft-codex-traits-precedence-test" as MessageId,
        targetText: "draft codex traits precedence test",
      }),
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();

      await newThreadButton.click();

      const threadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a sticky draft thread UUID.",
      );
      const threadId = threadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });

      useComposerDraftStore.getState().setModelSelection(threadId, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "low",
          fastMode: true,
        },
      });

      await newThreadButton.click();

      await waitForURL(
        mounted.router,
        (path) => path === threadPath,
        "New-thread should reuse the existing project draft thread.",
      );
      expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.4",
            options: {
              reasoningEffort: "low",
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a new thread from the global chat.new shortcut", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-chat-shortcut-test" as MessageId,
        targetText: "chat shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForNewThreadShortcutLabel();
      await waitForServerConfigToApply();
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      await waitForLayout();
      await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID from the shortcut.",
      );
    } finally {
      await mounted.cleanup();
    }
  });
  it("creates a fresh draft after the previous draft thread is promoted", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-promoted-draft-shortcut-test" as MessageId,
        targetText: "promoted draft shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      const newThreadButton = page.getByTestId("new-thread-button");
      await expect.element(newThreadButton).toBeInTheDocument();
      await waitForNewThreadShortcutLabel();
      await waitForServerConfigToApply();
      await newThreadButton.click();

      const promotedThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a promoted draft thread UUID.",
      );
      const promotedThreadId = promotedThreadPath.slice(1) as ThreadId;

      await promoteDraftThreadViaDomainEvent(promotedThreadId);

      const freshThreadPath = await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path) && path !== promotedThreadPath,
        "Shortcut should create a fresh draft instead of reusing the promoted thread.",
      );
      expect(freshThreadPath).not.toBe(promotedThreadPath);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps long proposed plans lightweight until the user expands them", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithLongProposedPlan(),
    });

    try {
      await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Expand plan",
          ) as HTMLButtonElement | null,
        "Unable to find Expand plan button.",
      );

      expect(document.body.textContent).not.toContain("deep hidden detail only after expand");

      const expandButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Expand plan",
          ) as HTMLButtonElement | null,
        "Unable to find Expand plan button.",
      );
      expandButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("deep hidden detail only after expand");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps pending-question footer actions inside the composer after a real resize", async () => {
    const mounted = await mountChatView({
      viewport: WIDE_FOOTER_VIEWPORT,
      snapshot: createSnapshotWithPendingUserInput(),
    });

    try {
      const firstOption = await waitForButtonContainingText("Tight");
      firstOption.click();

      await waitForButtonByText("Previous");
      await waitForButtonByText("Submit answers");

      await mounted.setContainerSize(COMPACT_FOOTER_VIEWPORT);
      await expectComposerActionsContained();
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps plan follow-up footer actions fused and aligned after a real resize", async () => {
    const mounted = await mountChatView({
      viewport: WIDE_FOOTER_VIEWPORT,
      snapshot: createSnapshotWithPlanFollowUpPrompt(),
    });

    try {
      const footer = await waitForElement(
        () => document.querySelector<HTMLElement>('[data-chat-composer-footer="true"]'),
        "Unable to find composer footer.",
      );
      const initialModelPicker = await waitForElement(
        findComposerProviderModelPicker,
        "Unable to find provider model picker.",
      );
      const initialModelPickerOffset =
        initialModelPicker.getBoundingClientRect().left - footer.getBoundingClientRect().left;

      await waitForButtonByText("Implement");
      await waitForElement(
        () =>
          document.querySelector<HTMLButtonElement>('button[aria-label="Implementation actions"]'),
        "Unable to find implementation actions trigger.",
      );

      await mounted.setContainerSize({
        width: 440,
        height: WIDE_FOOTER_VIEWPORT.height,
      });
      await expectComposerActionsContained();

      const implementButton = await waitForButtonByText("Implement");
      const implementActionsButton = await waitForElement(
        () =>
          document.querySelector<HTMLButtonElement>('button[aria-label="Implementation actions"]'),
        "Unable to find implementation actions trigger.",
      );

      await vi.waitFor(
        () => {
          const implementRect = implementButton.getBoundingClientRect();
          const implementActionsRect = implementActionsButton.getBoundingClientRect();
          const compactModelPicker = findComposerProviderModelPicker();
          expect(compactModelPicker).toBeTruthy();

          const compactModelPickerOffset =
            compactModelPicker!.getBoundingClientRect().left - footer.getBoundingClientRect().left;

          expect(Math.abs(implementRect.right - implementActionsRect.left)).toBeLessThanOrEqual(1);
          expect(Math.abs(implementRect.top - implementActionsRect.top)).toBeLessThanOrEqual(1);
          expect(Math.abs(compactModelPickerOffset - initialModelPickerOffset)).toBeLessThanOrEqual(
            1,
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the slash-command menu visible above the composer", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-menu-target" as MessageId,
        targetText: "command menu thread",
      }),
    });

    try {
      await waitForComposerEditor();
      await page.getByTestId("composer-editor").fill("/");

      const menuItem = await waitForComposerMenuItem("slash:model");
      const composerForm = await waitForElement(
        () => document.querySelector<HTMLElement>('[data-chat-composer-form="true"]'),
        "Unable to find composer form.",
      );

      await vi.waitFor(
        () => {
          const menuRect = menuItem.getBoundingClientRect();
          const composerRect = composerForm.getBoundingClientRect();
          const hitTarget = document.elementFromPoint(
            menuRect.left + menuRect.width / 2,
            menuRect.top + menuRect.height / 2,
          );

          expect(menuRect.width).toBeGreaterThan(0);
          expect(menuRect.height).toBeGreaterThan(0);
          expect(menuRect.bottom).toBeLessThanOrEqual(composerRect.bottom);
          expect(hitTarget instanceof Element && menuItem.contains(hitTarget)).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
