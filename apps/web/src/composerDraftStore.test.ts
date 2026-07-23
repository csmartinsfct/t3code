import * as Schema from "effect/Schema";
import {
  ProjectId,
  ThreadId,
  type ModelSelection,
  type ProviderModelOptions,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  clearPromotedDraftThread,
  clearPromotedDraftThreads,
  type ComposerImageAttachment,
  deriveEffectiveComposerModelState,
  useComposerDraftStore,
} from "./composerDraftStore";
import { removeLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
  type TerminalContextDraft,
} from "./lib/terminalContext";
import { createDebouncedStorage } from "./lib/storage";

function makeImage(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
}): ComposerImageAttachment {
  const name = input.name ?? "image.png";
  const mimeType = input.mimeType ?? "image/png";
  const sizeBytes = input.sizeBytes ?? 4;
  const lastModified = input.lastModified ?? 1_700_000_000_000;
  const file = new File([new Uint8Array(sizeBytes).fill(1)], name, {
    type: mimeType,
    lastModified,
  });
  return {
    type: "image",
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    previewUrl: input.previewUrl,
    file,
  };
}

function makeTerminalContext(input: {
  id: string;
  text?: string;
  terminalId?: string;
  terminalLabel?: string;
  lineStart?: number;
  lineEnd?: number;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: ThreadId.makeUnsafe("thread-dedupe"),
    terminalId: input.terminalId ?? "default",
    terminalLabel: input.terminalLabel ?? "Terminal 1",
    lineStart: input.lineStart ?? 4,
    lineEnd: input.lineEnd ?? 5,
    text: input.text ?? "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
  };
}

function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

function modelSelection(
  provider: "codex" | "claudeAgent" | "gemini" | "cursor",
  model: string,
  profileIdOrOptions?: string | ModelSelection["options"],
  options?: ModelSelection["options"],
): ModelSelection {
  const profileId =
    (provider === "codex" ||
      provider === "claudeAgent" ||
      provider === "gemini" ||
      provider === "cursor") &&
    typeof profileIdOrOptions === "string"
      ? profileIdOrOptions
      : undefined;
  const resolvedOptions = typeof profileIdOrOptions === "string" ? options : profileIdOrOptions;
  return {
    provider,
    model,
    ...(profileId ? { profileId } : {}),
    ...(resolvedOptions ? { options: resolvedOptions } : {}),
  } as ModelSelection;
}

function providerModelOptions(options: ProviderModelOptions): ProviderModelOptions {
  return options;
}

describe("composerDraftStore addImages", () => {
  const threadId = ThreadId.makeUnsafe("thread-dedupe");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("deduplicates identical images in one batch by file signature", () => {
    const first = makeImage({
      id: "img-1",
      previewUrl: "blob:first",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
      lastModified: 12345,
    });
    const duplicate = makeImage({
      id: "img-2",
      previewUrl: "blob:duplicate",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
      lastModified: 12345,
    });

    useComposerDraftStore.getState().addImages(threadId, [first, duplicate]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-1"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:duplicate");
  });

  it("deduplicates against existing images across calls by file signature", () => {
    const first = makeImage({
      id: "img-a",
      previewUrl: "blob:a",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
      lastModified: 777,
    });
    const duplicateLater = makeImage({
      id: "img-b",
      previewUrl: "blob:b",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
      lastModified: 999,
    });

    useComposerDraftStore.getState().addImage(threadId, first);
    useComposerDraftStore.getState().addImage(threadId, duplicateLater);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-a"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:b");
  });

  it("does not revoke blob URLs that are still used by an accepted duplicate image", () => {
    const first = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });
    const duplicateSameUrl = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });

    useComposerDraftStore.getState().addImages(threadId, [first, duplicateSameUrl]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-shared"]);
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:shared");
  });
});

describe("composerDraftStore clearComposerContent", () => {
  const threadId = ThreadId.makeUnsafe("thread-clear");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("does not revoke blob preview URLs when clearing composer content", () => {
    const first = makeImage({
      id: "img-optimistic",
      previewUrl: "blob:optimistic",
    });
    useComposerDraftStore.getState().addImage(threadId, first);

    useComposerDraftStore.getState().clearComposerContent(threadId);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft).toBeUndefined();
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:optimistic");
  });

  it("is idempotent when the draft retains a model selection (guards against render loops)", () => {
    // Regression: React error #185 crash when clicking an auto-send thread.
    // A draft that keeps a per-thread model selection is NOT removed by
    // clearComposerContent (shouldRemoveDraft stays false), so a naive
    // implementation rebuilds the draft object on every call. That churns the
    // reference behind the `composerDraft.skills` selector, which ChatView's
    // initial-draft effect depends on, re-triggering the effect forever.
    const store = useComposerDraftStore.getState();
    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.6-sol"));
    store.setPrompt(threadId, "auto-sent prompt");

    // First clear empties content but retains the model selection → draft persists.
    useComposerDraftStore.getState().clearComposerContent(threadId);
    const afterFirst = useComposerDraftStore.getState();
    expect(afterFirst.draftsByThreadId[threadId]).toBeDefined();

    // A redundant clear must be a true no-op: same reference, so dependent
    // selectors stay stable and the effect does not re-run.
    useComposerDraftStore.getState().clearComposerContent(threadId);
    const afterSecond = useComposerDraftStore.getState();
    expect(afterSecond.draftsByThreadId).toBe(afterFirst.draftsByThreadId);
    expect(afterSecond.draftsByThreadId[threadId]).toBe(afterFirst.draftsByThreadId[threadId]);
  });
});

describe("composerDraftStore ticket attachments", () => {
  const threadId = ThreadId.makeUnsafe("thread-ticket-attachments");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("deduplicates ticket attachments by ticket id and removes the draft when the last chip is removed", () => {
    // Audit traceability: aa1e7da, 1f727cb.
    const store = useComposerDraftStore.getState();

    store.addTicketAttachment(threadId, {
      id: "ticket-1",
      identifier: "T3CO-1",
      title: "Board drag regression",
    });
    store.addTicketAttachment(threadId, {
      id: "ticket-1",
      identifier: "T3CO-1",
      title: "Board drag regression",
    });

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.ticketAttachments).toEqual([
      {
        id: "ticket-1",
        identifier: "T3CO-1",
        title: "Board drag regression",
      },
    ]);

    store.removeTicketAttachment(threadId, "ticket-1");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.ticketAttachments).toEqual(
      [],
    );
  });

  it("keeps multi-ticket drag attachments unique and in insertion order", () => {
    const store = useComposerDraftStore.getState();

    store.addTicketAttachment(threadId, {
      id: "ticket-1",
      identifier: "T3CO-1",
      title: "Board drag regression",
    });
    store.addTicketAttachment(threadId, {
      id: "ticket-2",
      identifier: "T3CO-2",
      title: "Stacked drag overlay",
    });
    store.addTicketAttachment(threadId, {
      id: "ticket-1",
      identifier: "T3CO-1",
      title: "Board drag regression",
    });

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.ticketAttachments).toEqual([
      {
        id: "ticket-1",
        identifier: "T3CO-1",
        title: "Board drag regression",
      },
      {
        id: "ticket-2",
        identifier: "T3CO-2",
        title: "Stacked drag overlay",
      },
    ]);
  });

  it("clears ticket attachments alongside the rest of the composer draft content", () => {
    const store = useComposerDraftStore.getState();

    store.setPrompt(threadId, "follow up");
    store.addTicketAttachment(threadId, {
      id: "ticket-2",
      identifier: "T3CO-2",
      title: "Composer continuity regression",
    });

    store.clearComposerContent(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears only ticket attachments when requested and preserves the rest of the draft", () => {
    const store = useComposerDraftStore.getState();

    store.setPrompt(threadId, "follow up");
    store.addTicketAttachment(threadId, {
      id: "ticket-2",
      identifier: "T3CO-2",
      title: "Composer continuity regression",
    });
    store.addTicketAttachment(threadId, {
      id: "ticket-3",
      identifier: "T3CO-3",
      title: "Range selection regression",
    });

    store.clearTicketAttachments(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      prompt: "follow up",
      ticketAttachments: [],
    });
  });
});

describe("composerDraftStore provider capabilities", () => {
  const threadId = ThreadId.makeUnsafe("thread-provider-capabilities");
  const capability = {
    provider: "codex" as const,
    kind: "plugin" as const,
    id: "superpowers@openai-curated-remote",
    displayName: "Superpowers",
  };

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("adds and removes a selected provider capability", () => {
    const store = useComposerDraftStore.getState();

    store.addProviderCapability(threadId, capability);

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.providerCapabilities,
    ).toEqual([capability]);

    store.removeProviderCapability(threadId, capability.id);

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.providerCapabilities,
    ).toHaveLength(0);
  });

  it("ignores ambiguous raw-id provider capability removal", () => {
    const store = useComposerDraftStore.getState();
    const profiledCapability = {
      ...capability,
      provider: "codex:zbd" as const,
    };

    store.addProviderCapability(threadId, capability);
    store.addProviderCapability(threadId, profiledCapability);

    store.removeProviderCapability(threadId, capability.id);

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.providerCapabilities,
    ).toEqual([capability, profiledCapability]);
  });

  it("removes provider capabilities by provider-scoped selection key", () => {
    const store = useComposerDraftStore.getState();
    const profiledCapability = {
      ...capability,
      provider: "codex:zbd" as const,
    };

    store.addProviderCapability(threadId, capability);
    store.addProviderCapability(threadId, profiledCapability);

    store.removeProviderCapability(
      threadId,
      "codex:zbd\u0000plugin\u0000superpowers@openai-curated-remote",
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.providerCapabilities,
    ).toEqual([capability]);
  });

  it("deduplicates capabilities by provider, kind, and id", () => {
    const store = useComposerDraftStore.getState();

    store.addProviderCapability(threadId, capability);
    store.addProviderCapability(threadId, capability);
    store.addProviderCapability(threadId, {
      ...capability,
      provider: "claudeAgent",
    });

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.providerCapabilities,
    ).toEqual([capability, { ...capability, provider: "claudeAgent" }]);
  });

  it("clears selected provider capabilities with composer content", () => {
    const store = useComposerDraftStore.getState();

    store.setPrompt(threadId, "sent draft");
    store.addProviderCapability(threadId, capability);

    store.clearComposerContent(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore syncPersistedAttachments", () => {
  const threadId = ThreadId.makeUnsafe("thread-sync-persisted");

  beforeEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  afterEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
  });

  it("treats malformed persisted draft storage as empty", async () => {
    const image = makeImage({
      id: "img-persisted",
      previewUrl: "blob:persisted",
    });
    useComposerDraftStore.getState().addImage(threadId, image);
    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      {
        version: 2,
        state: {
          draftsByThreadId: {
            [threadId]: {
              attachments: "not-an-array",
            },
          },
        },
      },
      Schema.Unknown,
    );

    useComposerDraftStore.getState().syncPersistedAttachments(threadId, [
      {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: image.previewUrl,
      },
    ]);
    await Promise.resolve();

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments,
    ).toEqual([]);
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.nonPersistedImageIds,
    ).toEqual([image.id]);
  });
});

describe("composerDraftStore terminal contexts", () => {
  const threadId = ThreadId.makeUnsafe("thread-dedupe");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  it("deduplicates identical terminal contexts by selection signature", () => {
    const first = makeTerminalContext({ id: "ctx-1" });
    const duplicate = makeTerminalContext({ id: "ctx-2" });

    useComposerDraftStore.getState().addTerminalContexts(threadId, [first, duplicate]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-1"]);
  });

  it("clears terminal contexts when clearing composer content", () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadId, makeTerminalContext({ id: "ctx-1" }));

    useComposerDraftStore.getState().clearComposerContent(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("inserts terminal contexts at the requested inline prompt position", () => {
    const firstInsertion = insertInlineTerminalContextPlaceholder("alpha beta", 6);
    const secondInsertion = insertInlineTerminalContextPlaceholder(firstInsertion.prompt, 0);

    expect(
      useComposerDraftStore
        .getState()
        .insertTerminalContext(
          threadId,
          firstInsertion.prompt,
          makeTerminalContext({ id: "ctx-1" }),
          firstInsertion.contextIndex,
        ),
    ).toBe(true);
    expect(
      useComposerDraftStore.getState().insertTerminalContext(
        threadId,
        secondInsertion.prompt,
        makeTerminalContext({
          id: "ctx-2",
          terminalLabel: "Terminal 2",
          lineStart: 9,
          lineEnd: 10,
        }),
        secondInsertion.contextIndex,
      ),
    ).toBe(true);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe(
      `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} alpha ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} beta`,
    );
    expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-2", "ctx-1"]);
  });

  it("omits terminal context text from persisted drafts", () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadId, makeTerminalContext({ id: "ctx-persist" }));

    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        partialize: (state: ReturnType<typeof useComposerDraftStore.getState>) => unknown;
      };
    };
    const persistedState = persistApi.getOptions().partialize(useComposerDraftStore.getState()) as {
      draftsByThreadId?: Record<string, { terminalContexts?: Array<Record<string, unknown>> }>;
    };

    expect(
      persistedState.draftsByThreadId?.[threadId]?.terminalContexts?.[0],
      "Expected terminal context metadata to be persisted.",
    ).toMatchObject({
      id: "ctx-persist",
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 4,
      lineEnd: 5,
    });
    expect(
      persistedState.draftsByThreadId?.[threadId]?.terminalContexts?.[0]?.text,
    ).toBeUndefined();
  });

  it("hydrates persisted terminal contexts without in-memory snapshot text", () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
            attachments: [],
            terminalContexts: [
              {
                id: "ctx-rehydrated",
                threadId,
                createdAt: "2026-03-13T12:00:00.000Z",
                terminalId: "default",
                terminalLabel: "Terminal 1",
                lineStart: 4,
                lineEnd: 5,
              },
            ],
          },
        },
        draftThreadsByThreadId: {},
        projectDraftThreadIdByProjectId: {},
      },
      useComposerDraftStore.getInitialState(),
    );

    expect(mergedState.draftsByThreadId[threadId]?.terminalContexts).toMatchObject([
      {
        id: "ctx-rehydrated",
        terminalId: "default",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 5,
        text: "",
      },
    ]);
  });

  it("sanitizes malformed persisted drafts during merge", () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: "",
            attachments: "not-an-array",
            terminalContexts: "not-an-array",
            provider: "bogus-provider",
            modelOptions: "not-an-object",
          },
        },
        draftThreadsByThreadId: "not-an-object",
        projectDraftThreadIdByProjectId: "not-an-object",
      },
      useComposerDraftStore.getInitialState(),
    );

    expect(mergedState.draftsByThreadId[threadId]).toBeUndefined();
    expect(mergedState.draftThreadsByThreadId).toEqual({});
    expect(mergedState.projectDraftThreadIdByProjectId).toEqual({});
  });

  it("rehydrates profiled provider drafts and sticky state from persisted storage", () => {
    // Audit traceability: e1077b5, 7d6be28.
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const profiledThreadId = ThreadId.makeUnsafe("thread-profiled-rehydrated");

    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [profiledThreadId]: {
            prompt: "",
            attachments: [],
            modelSelectionByProvider: {
              "codex:metric": {
                provider: "codex",
                profileId: "metric",
                model: "gpt-5.4",
                options: {
                  reasoningEffort: "high",
                },
              },
              "claudeAgent:metric": {
                provider: "claudeAgent",
                profileId: "metric",
                model: "claude-opus-4-8",
                options: {
                  effort: "max",
                },
              },
            },
            activeProvider: "claudeAgent:metric",
          },
        },
        draftThreadsByThreadId: {},
        projectDraftThreadIdByProjectId: {},
        stickyModelSelectionByProvider: {
          "codex:metric": {
            provider: "codex",
            profileId: "metric",
            model: "gpt-5.4",
          },
          "claudeAgent:metric": {
            provider: "claudeAgent",
            profileId: "metric",
            model: "claude-opus-4-8",
          },
        },
        stickyActiveProvider: "claudeAgent:metric",
      },
      useComposerDraftStore.getInitialState(),
    );

    expect(mergedState.draftsByThreadId[profiledThreadId]).toMatchObject({
      modelSelectionByProvider: {
        "codex:metric": modelSelection("codex", "gpt-5.4", "metric", {
          reasoningEffort: "high",
        }),
        "claudeAgent:metric": modelSelection("claudeAgent", "claude-opus-4-8", "metric", {
          effort: "max",
        }),
      },
      activeProvider: "claudeAgent:metric",
    });
    expect(mergedState.stickyModelSelectionByProvider).toMatchObject({
      "codex:metric": modelSelection("codex", "gpt-5.4", "metric"),
      "claudeAgent:metric": modelSelection("claudeAgent", "claude-opus-4-8", "metric"),
    });
    expect(mergedState.stickyActiveProvider).toBe("claudeAgent:metric");
  });
});

describe("composerDraftStore project draft thread mapping", () => {
  const projectId = ProjectId.makeUnsafe("project-a");
  const otherProjectId = ProjectId.makeUnsafe("project-b");
  const threadId = ThreadId.makeUnsafe("thread-a");
  const otherThreadId = ThreadId.makeUnsafe("thread-b");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores and reads project draft thread ids via actions", () => {
    const store = useComposerDraftStore.getState();
    expect(store.getDraftThreadByProjectId(projectId)).toBeNull();
    expect(store.getDraftThread(threadId)).toBeNull();

    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toEqual({
      threadId,
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toEqual({
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("clears only matching project draft mapping entries", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "hello");

    store.clearProjectDraftThreadById(projectId, otherThreadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );

    store.clearProjectDraftThreadById(projectId, threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears project draft mapping by project id", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "hello");
    store.clearProjectDraftThreadId(projectId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears orphaned composer drafts when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "orphan me");

    store.setProjectDraftThreadId(projectId, otherThreadId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      otherThreadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("keeps composer drafts when the thread is still mapped by another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setProjectDraftThreadId(otherProjectId, threadId);
    store.setPrompt(threadId, "keep me");

    store.clearProjectDraftThreadId(projectId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId)?.threadId,
    ).toBe(threadId);
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe("keep me");
  });

  it("clears draft registration independently", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "remove me");
    store.clearDraftThread(threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears a promoted draft by thread id", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "promote me");

    clearPromotedDraftThread(threadId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("does not clear composer drafts for existing server threads during promotion cleanup", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadId, "keep me");

    clearPromotedDraftThread(threadId);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe("keep me");
  });

  it("clears promoted drafts from an iterable of server thread ids", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "promote me");
    store.setProjectDraftThreadId(otherProjectId, otherThreadId);
    store.setPrompt(otherThreadId, "keep me");

    clearPromotedDraftThreads([threadId]);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId)?.threadId,
    ).toBe(otherThreadId);
    expect(useComposerDraftStore.getState().draftsByThreadId[otherThreadId]?.prompt).toBe(
      "keep me",
    );
  });

  it("keeps existing server-thread composer drafts during iterable promotion cleanup", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadId, "keep me");

    clearPromotedDraftThreads([threadId]);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe("keep me");
  });

  it("updates branch context on an existing draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: null,
    });
    store.setDraftThreadContext(threadId, {
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
      envMode: "worktree",
    });
  });

  it("preserves existing branch and worktree when setProjectDraftThreadId receives undefined", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: "/tmp/main-worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
    };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "main",
      worktreePath: "/tmp/main-worktree",
      envMode: "worktree",
    });
  });

  it("preserves worktree env mode without a worktree path", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
      envMode: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: "local" | "worktree";
    };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
  });
});

describe("composerDraftStore modelSelection", () => {
  const threadId = ThreadId.makeUnsafe("thread-model-options");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores a model selection in the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadId,
      modelSelection("codex", "gpt-5.3-codex", {
        reasoningEffort: "xhigh",
        fastMode: true,
      }),
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(
      modelSelection("codex", "gpt-5.3-codex", {
        reasoningEffort: "xhigh",
        fastMode: true,
      }),
    );
  });

  it("stores Claude xhigh model selections in the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadId,
      modelSelection("claudeAgent", "claude-opus-4-8", {
        effort: "xhigh",
      }),
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        effort: "xhigh",
      }),
    );
  });

  it("stores older Gemini fork selections under Gemini when provider was stale", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadId,
      modelSelection("claudeAgent", "gemini-2.5-pro", "metric", { effort: "max" }),
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider,
    ).toEqual({
      gemini: modelSelection("gemini", "gemini-2.5-pro"),
    });
  });

  it("keeps default-only model selections on the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.4"));

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(modelSelection("codex", "gpt-5.4"));
  });

  it("replaces only the targeted provider options on the current model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(
      threadId,
      modelSelection("claudeAgent", "claude-opus-4-8", {
        effort: "max",
        fastMode: true,
      }),
    );
    store.setStickyModelSelection(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        effort: "max",
        fastMode: true,
      }),
    );

    store.setProviderModelOptions(
      threadId,
      "claudeAgent",
      {
        thinking: false,
      },
      { persistSticky: true },
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        thinking: false,
      }),
    );
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        thinking: false,
      }),
    );
  });

  it("keeps explicit default-state overrides on the selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(
      threadId,
      modelSelection("claudeAgent", "claude-opus-4-8", {
        effort: "max",
      }),
    );

    store.setProviderModelOptions(threadId, "claudeAgent", {
      thinking: true,
    });

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        thinking: true,
      }),
    );
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider).toEqual({});
  });

  it("keeps explicit off/default codex overrides on the selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.4", { fastMode: true }));

    store.setProviderModelOptions(threadId, "codex", {
      reasoningEffort: "high",
      fastMode: false,
    });

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(
      modelSelection("codex", "gpt-5.4", {
        reasoningEffort: "high",
        fastMode: false,
      }),
    );
  });

  it("keeps Codex profile options scoped to the profiled provider", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.4", "metric"));

    store.setProviderModelOptions(
      threadId,
      "codex:metric",
      {
        reasoningEffort: "high",
        fastMode: true,
      },
      { persistSticky: true },
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider[
        "codex:metric"
      ],
    ).toEqual(
      modelSelection("codex", "gpt-5.4", "metric", {
        reasoningEffort: "high",
        fastMode: true,
      }),
    );
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider).toMatchObject({
      "codex:metric": modelSelection("codex", "gpt-5.4", "metric", {
        reasoningEffort: "high",
        fastMode: true,
      }),
    });
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("codex:metric");
  });

  it("updates only the draft when sticky persistence is omitted", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );
    store.setModelSelection(
      threadId,
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );

    store.setProviderModelOptions(threadId, "claudeAgent", {
      thinking: false,
    });

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        thinking: false,
      }),
    );
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );
  });

  it("does not clear other provider options when setting options for a single provider", () => {
    const store = useComposerDraftStore.getState();

    // Set options for both providers
    store.setModelOptions(
      threadId,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    // Now set options for only codex — claudeAgent should be untouched
    store.setModelOptions(threadId, providerModelOptions({ codex: { reasoningEffort: "xhigh" } }));

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.codex?.options).toEqual({ reasoningEffort: "xhigh" });
    expect(draft?.modelSelectionByProvider.claudeAgent?.options).toEqual({ effort: "max" });
  });

  it("preserves GPT-5.6 Codex reasoning efforts", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(
      threadId,
      modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra" }),
    );
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "ultra" }));

    store.setModelOptions(threadId, providerModelOptions({ codex: { reasoningEffort: "none" } }));
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex
        ?.options,
    ).toEqual({ reasoningEffort: "none" });
  });

  it("preserves other provider options when switching the active model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelOptions(
      threadId,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    store.setModelSelection(threadId, modelSelection("claudeAgent", "claude-opus-4-8"));

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.claudeAgent).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );
    expect(draft?.modelSelectionByProvider.codex?.options).toEqual({ fastMode: true });
    expect(draft?.activeProvider).toBe("claudeAgent");
  });

  it("creates the first sticky snapshot from provider option changes", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.4"));

    store.setProviderModelOptions(
      threadId,
      "codex",
      {
        fastMode: true,
      },
      { persistSticky: true },
    );

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toEqual(
      modelSelection("codex", "gpt-5.4", {
        fastMode: true,
      }),
    );
  });

  it("updates only the draft when sticky persistence is disabled", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );
    store.setModelSelection(
      threadId,
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );

    store.setProviderModelOptions(
      threadId,
      "claudeAgent",
      {
        thinking: false,
      },
      { persistSticky: false },
    );

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", {
        thinking: false,
      }),
    );
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection("claudeAgent", "claude-opus-4-8", { effort: "max" }),
    );
  });
});

describe("composerDraftStore setModelSelection", () => {
  const threadId = ThreadId.makeUnsafe("thread-model");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("keeps explicit model overrides instead of coercing to null", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("codex", "gpt-5.3-codex"));

    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex,
    ).toEqual(modelSelection("codex", "gpt-5.3-codex"));
  });

  it("keeps Cursor selected when choosing model slugs shared with other providers", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("cursor", "auto"));

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        cursor: modelSelection("cursor", "auto"),
      },
      activeProvider: "cursor",
    });

    store.setModelSelection(threadId, modelSelection("cursor", "claude-opus-4-8"));

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        cursor: modelSelection("cursor", "claude-opus-4-8"),
      },
      activeProvider: "cursor",
    });
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.gemini,
    ).toBeUndefined();
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent,
    ).toBeUndefined();
  });

  it("keeps profiled Cursor selected when choosing model slugs shared with other providers", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadId, modelSelection("cursor", "claude-opus-4-8", "metric"));

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        "cursor:metric": modelSelection("cursor", "claude-opus-4-8", "metric"),
      },
      activeProvider: "cursor:metric",
    });
  });
});

describe("composerDraftStore sticky composer settings", () => {
  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores a sticky model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection("codex", "gpt-5.3-codex", {
        reasoningEffort: "medium",
        fastMode: true,
      }),
    );

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toEqual(
      modelSelection("codex", "gpt-5.3-codex", {
        reasoningEffort: "medium",
        fastMode: true,
      }),
    );
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("codex");
  });

  it("stores profiled sticky selections with the full provider kind", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection("codex", "gpt-5.4", "metric", {
        reasoningEffort: "high",
      }),
    );

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider).toMatchObject({
      "codex:metric": modelSelection("codex", "gpt-5.4", "metric", {
        reasoningEffort: "high",
      }),
    });
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("codex:metric");

    store.setStickyModelSelection(
      modelSelection("claudeAgent", "claude-opus-4-8", "metric", {
        effort: "max",
      }),
    );

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider).toMatchObject({
      "codex:metric": modelSelection("codex", "gpt-5.4", "metric", {
        reasoningEffort: "high",
      }),
      "claudeAgent:metric": modelSelection("claudeAgent", "claude-opus-4-8", "metric", {
        effort: "max",
      }),
    });
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("claudeAgent:metric");
  });

  it("normalizes empty sticky model options by dropping selection options", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(modelSelection("codex", "gpt-5.4"));

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toEqual(
      modelSelection("codex", "gpt-5.4"),
    );
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("codex");
  });

  it("applies sticky activeProvider to new drafts", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.makeUnsafe("thread-sticky-active-provider");

    store.setStickyModelSelection(modelSelection("claudeAgent", "claude-opus-4-8"));
    store.applyStickyState(threadId);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        claudeAgent: modelSelection("claudeAgent", "claude-opus-4-8"),
      },
      activeProvider: "claudeAgent",
    });
  });
});

describe("composerDraftStore provider-scoped option updates", () => {
  const threadId = ThreadId.makeUnsafe("thread-provider");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("retains off-provider option memory without changing the active selection", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadId,
      modelSelection("codex", "gpt-5.3-codex", {
        reasoningEffort: "medium",
      }),
    );
    store.setProviderModelOptions(threadId, "claudeAgent", { effort: "max" });
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.modelSelectionByProvider.codex).toEqual(
      modelSelection("codex", "gpt-5.3-codex", { reasoningEffort: "medium" }),
    );
    expect(draft?.modelSelectionByProvider.claudeAgent?.options).toEqual({ effort: "max" });
    expect(draft?.activeProvider).toBe("codex");
  });
});

describe("deriveEffectiveComposerModelState", () => {
  const providers: ReadonlyArray<ServerProvider> = [
    {
      provider: "codex",
      enabled: true,
      installed: true,
      version: "0.116.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-05-03T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: null,
        },
      ],
    },
    {
      provider: "cursor",
      enabled: true,
      installed: true,
      version: "2026.05.01-eea359f",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-05-03T00:00:00.000Z",
      models: [
        {
          slug: "composer-2",
          name: "Composer 2",
          isCustom: false,
          capabilities: null,
        },
      ],
    },
    {
      provider: "cursor:metric" as never,
      displayName: "Cursor (metric)",
      enabled: true,
      installed: true,
      version: "2026.05.01-eea359f",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-05-03T00:00:00.000Z",
      models: [
        {
          slug: "claude-sonnet-5",
          name: "Sonnet 5",
          isCustom: false,
          capabilities: null,
        },
      ],
    },
  ];

  it("uses Cursor defaults when switching providers instead of carrying another provider model", () => {
    const state = deriveEffectiveComposerModelState({
      draft: null,
      providers,
      selectedProvider: "cursor",
      threadModelSelection: modelSelection("codex", "gpt-5.4"),
      projectModelSelection: null,
      settings: DEFAULT_UNIFIED_SETTINGS,
    });

    expect(state.selectedModel).toBe("composer-2");
    expect(state.modelOptions).toBeNull();
  });

  it("uses profiled Cursor model lists when the selected provider is a profile", () => {
    const state = deriveEffectiveComposerModelState({
      draft: null,
      providers,
      selectedProvider: "cursor:metric" as never,
      threadModelSelection: modelSelection("cursor", "composer-2"),
      projectModelSelection: null,
      settings: DEFAULT_UNIFIED_SETTINGS,
    });

    expect(state.selectedModel).toBe("claude-sonnet-5");
  });

  it("does not let a retained profile override the selected provider options", () => {
    const state = deriveEffectiveComposerModelState({
      draft: {
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.4",
            options: { reasoningEffort: "low" },
          },
          ["codex:zbd"]: {
            provider: "codex",
            profileId: "zbd",
            model: "gpt-5.4",
            options: { reasoningEffort: "ultra" },
          },
        },
        activeProvider: "codex",
      },
      providers,
      selectedProvider: "codex",
      threadModelSelection: null,
      projectModelSelection: null,
      settings: DEFAULT_UNIFIED_SETTINGS,
    });

    expect(state.modelOptions).toEqual({
      codex: { reasoningEffort: "low" },
    });
  });
});

describe("composerDraftStore runtime and interaction settings", () => {
  const threadId = ThreadId.makeUnsafe("thread-settings");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores runtime mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.runtimeMode).toBe(
      "approval-required",
    );
  });

  it("stores interaction mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setInteractionMode(threadId, "plan");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.interactionMode).toBe(
      "plan",
    );
  });

  it("removes empty settings-only drafts when overrides are cleared", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");
    store.setInteractionMode(threadId, "plan");
    store.setRuntimeMode(threadId, null);
    store.setInteractionMode(threadId, null);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createDebouncedStorage
// ---------------------------------------------------------------------------

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => store.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

describe("createDebouncedStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates getItem immediately", () => {
    const base = createMockStorage();
    base.getItem.mockReturnValueOnce("value");
    const storage = createDebouncedStorage(base);

    expect(storage.getItem("key")).toBe("value");
    expect(base.getItem).toHaveBeenCalledWith("key");
  });

  it("does not write to base storage until the debounce fires", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "v1");
  });

  it("only writes the last value when setItem is called rapidly", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.setItem("key", "v2");
    storage.setItem("key", "v3");

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "v3");
  });

  it("removeItem cancels a pending setItem write", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.removeItem("key");

    vi.advanceTimersByTime(300);
    expect(base.setItem).not.toHaveBeenCalled();
    expect(base.removeItem).toHaveBeenCalledWith("key");
  });

  it("flush writes the pending value immediately", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    expect(base.setItem).not.toHaveBeenCalled();

    storage.flush();
    expect(base.setItem).toHaveBeenCalledWith("key", "v1");

    // Timer should be cancelled; no duplicate write.
    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is pending", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.flush();
    expect(base.setItem).not.toHaveBeenCalled();
  });

  it("flush after removeItem is a no-op", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.removeItem("key");
    storage.flush();

    expect(base.setItem).not.toHaveBeenCalled();
  });

  it("setItem works normally after removeItem cancels a pending write", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.removeItem("key");
    storage.setItem("key", "v2");

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "v2");
  });
});
