import { Debouncer } from "@tanstack/react-pacer";
import { type ProjectId, type ThreadId, type TicketId } from "@t3tools/contracts";
import { create } from "zustand";

const PERSISTED_STATE_KEY = "t3code:ui-state:v2";
const PREVIOUS_PERSISTED_STATE_KEY = "t3code:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  PREVIOUS_PERSISTED_STATE_KEY,
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export type ViewMode = "chat" | "management";

export interface BoardContext {
  projectId: ProjectId;
  ticketStack: TicketId[];
  boardScrollLeft: number;
  updatedAt: string;
}

interface PersistedUiState {
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  viewMode?: ViewMode;
  boardContextByThreadId?: Record<
    string,
    {
      projectId?: string;
      ticketStack?: string[];
      boardScrollLeft?: number;
      updatedAt?: string;
    }
  >;
  managementLastProjectId?: string | null;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: ProjectId[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
}

export interface UiBoardState {
  boardContextByThreadId: Record<string, BoardContext>;
  managementLastProjectId: ProjectId | null;
}

export interface UiState extends UiProjectState, UiThreadState, UiBoardState {
  viewMode: ViewMode;
}

export interface SyncProjectInput {
  id: ProjectId;
  cwd: string;
}

export interface SyncThreadInput {
  id: ThreadId;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  boardContextByThreadId: {},
  managementLastProjectId: null,
  viewMode: "chat",
};

const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
let persistedViewMode: ViewMode = "chat";
let persistedBoardContextByThreadId: Record<string, BoardContext> = {};
let persistedManagementLastProjectId: ProjectId | null = null;
const currentProjectCwdById = new Map<ProjectId, string>();
let legacyKeysCleanedUp = false;

const nowIso = () => new Date().toISOString();

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        hydratePersistedUiState(JSON.parse(legacyRaw) as PersistedUiState);
        return {
          ...initialState,
          viewMode: persistedViewMode,
          boardContextByThreadId: persistedBoardContextByThreadId,
          managementLastProjectId: persistedManagementLastProjectId,
        };
      }
      return initialState;
    }
    hydratePersistedUiState(JSON.parse(raw) as PersistedUiState);
    return {
      ...initialState,
      viewMode: persistedViewMode,
      boardContextByThreadId: persistedBoardContextByThreadId,
      managementLastProjectId: persistedManagementLastProjectId,
    };
  } catch {
    return initialState;
  }
}

function hydratePersistedUiState(parsed: PersistedUiState): void {
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  persistedBoardContextByThreadId = {};
  persistedManagementLastProjectId = null;
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
      persistedProjectOrderCwds.push(cwd);
    }
  }
  persistedViewMode =
    parsed.viewMode === "chat" || parsed.viewMode === "management" ? parsed.viewMode : "chat";

  for (const [threadId, context] of Object.entries(parsed.boardContextByThreadId ?? {})) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      continue;
    }
    if (typeof context?.projectId !== "string" || context.projectId.length === 0) {
      continue;
    }
    const ticketStack = (context.ticketStack ?? []).filter(
      (ticketId): ticketId is TicketId => typeof ticketId === "string" && ticketId.length > 0,
    );
    persistedBoardContextByThreadId[threadId] = {
      projectId: context.projectId as ProjectId,
      ticketStack,
      boardScrollLeft:
        typeof context.boardScrollLeft === "number" && Number.isFinite(context.boardScrollLeft)
          ? context.boardScrollLeft
          : 0,
      updatedAt:
        typeof context.updatedAt === "string" && context.updatedAt.length > 0
          ? context.updatedAt
          : nowIso(),
    };
  }

  if (
    typeof parsed.managementLastProjectId === "string" &&
    parsed.managementLastProjectId.length > 0
  ) {
    persistedManagementLastProjectId = parsed.managementLastProjectId as ProjectId;
  }
}

function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([projectId]) => {
        const cwd = currentProjectCwdById.get(projectId as ProjectId);
        return cwd ? [cwd] : [];
      });
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds,
        projectOrderCwds,
        viewMode: state.viewMode,
        boardContextByThreadId: state.boardContextByThreadId,
        managementLastProjectId: state.managementLastProjectId,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly ProjectId[], right: readonly ProjectId[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function ticketStacksEqual(left: readonly TicketId[], right: readonly TicketId[]): boolean {
  return left.length === right.length && left.every((ticketId, index) => ticketId === right[index]);
}

function boardContextsEqual(
  left: Record<string, BoardContext>,
  right: Record<string, BoardContext>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    const other = right[key];
    if (!other) {
      return false;
    }
    if (
      value.projectId !== other.projectId ||
      value.boardScrollLeft !== other.boardScrollLeft ||
      value.updatedAt !== other.updatedAt ||
      !ticketStacksEqual(value.ticketStack, other.ticketStack)
    ) {
      return false;
    }
  }
  return true;
}

function buildBoardContext(
  projectId: ProjectId,
  input?: Partial<Pick<BoardContext, "ticketStack" | "boardScrollLeft" | "updatedAt">>,
): BoardContext {
  return {
    projectId,
    ticketStack: [...(input?.ticketStack ?? [])],
    boardScrollLeft: input?.boardScrollLeft ?? 0,
    updatedAt: input?.updatedAt ?? nowIso(),
  };
}

function setBoardContextForThread(
  state: UiState,
  threadId: ThreadId,
  nextContext: BoardContext | null,
): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  if (nextContext === null) {
    if (!currentContext) {
      return state;
    }
    const boardContextByThreadId = { ...state.boardContextByThreadId };
    delete boardContextByThreadId[threadId];
    return {
      ...state,
      boardContextByThreadId,
    };
  }

  if (
    currentContext &&
    currentContext.projectId === nextContext.projectId &&
    currentContext.boardScrollLeft === nextContext.boardScrollLeft &&
    currentContext.updatedAt === nextContext.updatedAt &&
    ticketStacksEqual(currentContext.ticketStack, nextContext.ticketStack)
  ) {
    return state;
  }

  return {
    ...state,
    boardContextByThreadId: {
      ...state.boardContextByThreadId,
      [threadId]: nextContext,
    },
  };
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousProjectIdByCwd = new Map(
    [...previousProjectCwdById.entries()].map(([projectId, cwd]) => [cwd, projectId] as const),
  );
  currentProjectCwdById.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.id, project.cwd);
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.id) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    const previousProjectIdForCwd = previousProjectIdByCwd.get(project.cwd);
    const expanded =
      previousExpandedById[project.id] ??
      (previousProjectIdForCwd ? previousExpandedById[previousProjectIdForCwd] : undefined) ??
      (persistedExpandedProjectCwds.size > 0
        ? persistedExpandedProjectCwds.has(project.cwd)
        : true);
    nextExpandedById[project.id] = expanded;
    return {
      id: project.id,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<ProjectId>();
          const orderedProjectIds: ProjectId[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (projectId in nextExpandedById ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  const nextManagementLastProjectId = (() => {
    const current = state.managementLastProjectId;
    if (!current) {
      return null;
    }
    if (currentProjectCwdById.has(current)) {
      return current;
    }
    const previousCwd = previousProjectCwdById.get(current);
    if (!previousCwd) {
      return null;
    }
    const recreatedProjectId = mappedProjects.find((project) => project.cwd === previousCwd)?.id;
    return recreatedProjectId ?? null;
  })();

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    state.managementLastProjectId === nextManagementLastProjectId &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
    managementLastProjectId: nextManagementLastProjectId,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.id));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId),
    ),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.id] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.id] = thread.seedVisitedAt;
    }
  }
  const nextBoardContextByThreadId = Object.fromEntries(
    Object.entries(state.boardContextByThreadId).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId),
    ),
  ) as Record<string, BoardContext>;

  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    boardContextsEqual(state.boardContextByThreadId, nextBoardContextByThreadId)
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    boardContextByThreadId: nextBoardContextByThreadId,
  };
}

export function markThreadVisited(state: UiState, threadId: ThreadId, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: ThreadId,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: ThreadId): UiState {
  const hasVisitState = threadId in state.threadLastVisitedAtById;
  const hasBoardContext = threadId in state.boardContextByThreadId;
  if (!hasVisitState && !hasBoardContext) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  const nextBoardContextByThreadId = { ...state.boardContextByThreadId };
  delete nextThreadLastVisitedAtById[threadId];
  delete nextBoardContextByThreadId[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    boardContextByThreadId: nextBoardContextByThreadId,
  };
}

export function setThreadBoardRoot(
  state: UiState,
  threadId: ThreadId,
  projectId: ProjectId,
): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  const boardScrollLeft =
    currentContext?.projectId === projectId ? currentContext.boardScrollLeft : 0;
  return setBoardContextForThread(
    state,
    threadId,
    buildBoardContext(projectId, { boardScrollLeft }),
  );
}

export function pushThreadBoardTicket(
  state: UiState,
  threadId: ThreadId,
  projectId: ProjectId,
  ticketId: TicketId,
): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  const currentStack = currentContext?.projectId === projectId ? currentContext.ticketStack : [];
  if (currentStack[currentStack.length - 1] === ticketId) {
    return state;
  }
  return setBoardContextForThread(
    state,
    threadId,
    buildBoardContext(projectId, {
      ticketStack: [...currentStack, ticketId],
      boardScrollLeft: currentContext?.projectId === projectId ? currentContext.boardScrollLeft : 0,
    }),
  );
}

export function popThreadBoardTicket(state: UiState, threadId: ThreadId): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  if (!currentContext || currentContext.ticketStack.length === 0) {
    return state;
  }
  return setBoardContextForThread(
    state,
    threadId,
    buildBoardContext(currentContext.projectId, {
      ticketStack: currentContext.ticketStack.slice(0, -1),
      boardScrollLeft: currentContext.boardScrollLeft,
    }),
  );
}

export function replaceThreadBoardStack(
  state: UiState,
  threadId: ThreadId,
  projectId: ProjectId,
  ticketStack: readonly TicketId[],
): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  return setBoardContextForThread(
    state,
    threadId,
    buildBoardContext(projectId, {
      ticketStack: [...ticketStack],
      boardScrollLeft: currentContext?.projectId === projectId ? currentContext.boardScrollLeft : 0,
    }),
  );
}

export function setThreadBoardScrollLeft(
  state: UiState,
  threadId: ThreadId,
  scrollLeft: number,
): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  if (!currentContext) {
    return state;
  }
  const normalizedScrollLeft = Math.max(0, scrollLeft);
  if (currentContext.boardScrollLeft === normalizedScrollLeft) {
    return state;
  }
  return setBoardContextForThread(
    state,
    threadId,
    buildBoardContext(currentContext.projectId, {
      ticketStack: currentContext.ticketStack,
      boardScrollLeft: normalizedScrollLeft,
    }),
  );
}

export function clearThreadBoardContext(state: UiState, threadId: ThreadId): UiState {
  return setBoardContextForThread(state, threadId, null);
}

export function sanitizeThreadBoardContext(
  state: UiState,
  threadId: ThreadId,
  projectId: ProjectId,
  validTicketIds: ReadonlySet<TicketId>,
): UiState {
  const currentContext = state.boardContextByThreadId[threadId];
  if (!currentContext || currentContext.projectId !== projectId) {
    return setThreadBoardRoot(state, threadId, projectId);
  }

  const sanitizedStack = currentContext.ticketStack.filter((ticketId) =>
    validTicketIds.has(ticketId),
  );
  if (ticketStacksEqual(currentContext.ticketStack, sanitizedStack)) {
    return state;
  }

  return setBoardContextForThread(
    state,
    threadId,
    buildBoardContext(projectId, {
      ticketStack: sanitizedStack,
      boardScrollLeft: currentContext.boardScrollLeft,
    }),
  );
}

export function setManagementLastProjectId(state: UiState, projectId: ProjectId | null): UiState {
  if (state.managementLastProjectId === projectId) {
    return state;
  }
  return {
    ...state,
    managementLastProjectId: projectId,
  };
}

export function toggleProject(state: UiState, projectId: ProjectId): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(
  state: UiState,
  projectId: ProjectId,
  expanded: boolean,
): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectId: ProjectId,
  targetProjectId: ProjectId,
): UiState {
  if (draggedProjectId === targetProjectId) {
    return state;
  }
  const draggedIndex = state.projectOrder.findIndex((projectId) => projectId === draggedProjectId);
  const targetIndex = state.projectOrder.findIndex((projectId) => projectId === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return state;
  }
  const projectOrder = [...state.projectOrder];
  const [draggedProject] = projectOrder.splice(draggedIndex, 1);
  if (!draggedProject) {
    return state;
  }
  projectOrder.splice(targetIndex, 0, draggedProject);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: ThreadId) => void;
  setThreadBoardRoot: (threadId: ThreadId, projectId: ProjectId) => void;
  pushThreadBoardTicket: (threadId: ThreadId, projectId: ProjectId, ticketId: TicketId) => void;
  popThreadBoardTicket: (threadId: ThreadId) => void;
  replaceThreadBoardStack: (
    threadId: ThreadId,
    projectId: ProjectId,
    ticketStack: readonly TicketId[],
  ) => void;
  setThreadBoardScrollLeft: (threadId: ThreadId, scrollLeft: number) => void;
  clearThreadBoardContext: (threadId: ThreadId) => void;
  sanitizeThreadBoardContext: (
    threadId: ThreadId,
    projectId: ProjectId,
    validTicketIds: ReadonlySet<TicketId>,
  ) => void;
  setManagementLastProjectId: (projectId: ProjectId | null) => void;
  toggleProject: (projectId: ProjectId) => void;
  setProjectExpanded: (projectId: ProjectId, expanded: boolean) => void;
  reorderProjects: (draggedProjectId: ProjectId, targetProjectId: ProjectId) => void;
  setViewMode: (mode: ViewMode) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  setThreadBoardRoot: (threadId, projectId) =>
    set((state) => setThreadBoardRoot(state, threadId, projectId)),
  pushThreadBoardTicket: (threadId, projectId, ticketId) =>
    set((state) => pushThreadBoardTicket(state, threadId, projectId, ticketId)),
  popThreadBoardTicket: (threadId) => set((state) => popThreadBoardTicket(state, threadId)),
  replaceThreadBoardStack: (threadId, projectId, ticketStack) =>
    set((state) => replaceThreadBoardStack(state, threadId, projectId, ticketStack)),
  setThreadBoardScrollLeft: (threadId, scrollLeft) =>
    set((state) => setThreadBoardScrollLeft(state, threadId, scrollLeft)),
  clearThreadBoardContext: (threadId) => set((state) => clearThreadBoardContext(state, threadId)),
  sanitizeThreadBoardContext: (threadId, projectId, validTicketIds) =>
    set((state) => sanitizeThreadBoardContext(state, threadId, projectId, validTicketIds)),
  setManagementLastProjectId: (projectId) =>
    set((state) => setManagementLastProjectId(state, projectId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  setViewMode: (mode) => set({ viewMode: mode }),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
