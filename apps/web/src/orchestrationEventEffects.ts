import type { OrchestrationEvent, ProviderInteractionMode, ThreadId } from "@t3tools/contracts";

export interface OrchestrationBatchEffects {
  clearPromotedDraftThreadIds: ThreadId[];
  clearDeletedThreadIds: ThreadId[];
  removeTerminalStateThreadIds: ThreadId[];
  syncInteractionModes: Array<{ threadId: ThreadId; interactionMode: ProviderInteractionMode }>;
  needsProviderInvalidation: boolean;
}

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const threadLifecycleEffects = new Map<
    ThreadId,
    {
      clearPromotedDraft: boolean;
      clearDeletedThread: boolean;
      removeTerminalState: boolean;
    }
  >();
  let needsProviderInvalidation = false;
  const syncInteractionModes: OrchestrationBatchEffects["syncInteractionModes"] = [];

  for (const event of events) {
    switch (event.type) {
      case "thread.turn-diff-completed":
      case "thread.reverted": {
        needsProviderInvalidation = true;
        break;
      }

      case "thread.created": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: true,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      case "thread.deleted": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: true,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.archived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.unarchived": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      case "thread.interaction-mode-set": {
        syncInteractionModes.push({
          threadId: event.payload.threadId,
          interactionMode: event.payload.interactionMode,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  const clearPromotedDraftThreadIds: ThreadId[] = [];
  const clearDeletedThreadIds: ThreadId[] = [];
  const removeTerminalStateThreadIds: ThreadId[] = [];
  for (const [threadId, effect] of threadLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      clearPromotedDraftThreadIds.push(threadId);
    }
    if (effect.clearDeletedThread) {
      clearDeletedThreadIds.push(threadId);
    }
    if (effect.removeTerminalState) {
      removeTerminalStateThreadIds.push(threadId);
    }
  }

  return {
    clearPromotedDraftThreadIds,
    clearDeletedThreadIds,
    removeTerminalStateThreadIds,
    syncInteractionModes,
    needsProviderInvalidation,
  };
}

type ThreadParentLookup = Partial<
  Record<string, { readonly id: ThreadId; readonly parentThreadId: string | null } | undefined>
>;

function addThreadAndParentIds(
  output: Set<ThreadId>,
  threadsById: ThreadParentLookup,
  threadId: ThreadId,
): void {
  const thread = threadsById[threadId];
  if (!thread) {
    return;
  }

  output.add(thread.id);
  if (thread.parentThreadId !== null) {
    output.add(thread.parentThreadId as ThreadId);
  }
}

export function deriveStartupRecoveryClearThreadIds(input: {
  events: readonly OrchestrationEvent[];
  threadsById: ThreadParentLookup;
}): ThreadId[] {
  const clearThreadIds = new Set<ThreadId>();

  for (const event of input.events) {
    switch (event.type) {
      case "thread.turn-start-requested": {
        addThreadAndParentIds(clearThreadIds, input.threadsById, event.payload.threadId);
        break;
      }

      case "thread.session-set": {
        if (
          event.payload.session.status === "running" &&
          event.payload.session.activeTurnId !== null
        ) {
          addThreadAndParentIds(clearThreadIds, input.threadsById, event.payload.threadId);
        }
        break;
      }

      case "thread.message-sent": {
        if (event.payload.role === "assistant" && event.payload.streaming) {
          addThreadAndParentIds(clearThreadIds, input.threadsById, event.payload.threadId);
        }
        break;
      }

      default: {
        break;
      }
    }
  }

  return [...clearThreadIds];
}
