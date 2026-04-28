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
export type BoardViewMode = "cards" | "list";

export interface BoardFilters {
  priorityFilter: string[];
  labelFilter: string[];
  statusFilter: string[];
  searchQuery: string;
  collapsedStatuses: string[];
}

export const DEFAULT_BOARD_FILTERS: BoardFilters = {
  priorityFilter: [],
  labelFilter: [],
  statusFilter: [],
  searchQuery: "",
  collapsedStatuses: [],
};

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
  boardViewMode?: BoardViewMode | "browser";
  browserVisibleByProjectId?: Record<string, boolean>;
  boardFiltersByProjectId?: Record<
    string,
    {
      priorityFilter?: string[];
      labelFilter?: string[];
      statusFilter?: string[];
      searchQuery?: string;
      collapsedStatuses?: string[];
    }
  >;
  managementBoardContext?: {
    projectId?: string;
    ticketStack?: string[];
    boardScrollLeft?: number;
    updatedAt?: string;
  } | null;
  /**
   * Ticket IDs the user has collapsed in the recursive sub-tickets tree on the
   * ticket detail view. Open is the default — only collapsed entries are stored
   * so the set stays bounded as users navigate. FIFO-trimmed to {@link COLLAPSED_TICKET_LIMIT}.
   */
  collapsedTicketIds?: string[];
}

/**
 * Maximum number of collapsed ticket IDs persisted to localStorage. Prevents
 * unbounded growth as users navigate many tickets over time. Older entries are
 * dropped first when the limit is exceeded.
 */
const COLLAPSED_TICKET_LIMIT = 5000;

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: ProjectId[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  startupRecoveryStateByThreadId: Record<string, "active" | "dismissed">;
}

export interface UiBoardState {
  managementBoardContext: BoardContext | null;
  boardViewMode: BoardViewMode;
  browserVisibleByProjectId: Record<string, boolean>;
  boardFiltersByProjectId: Record<string, BoardFilters>;
}

export interface UiTicketState {
  /**
   * Set-shaped record where present keys mark a sub-ticket node as collapsed.
   * Default for any ticket is "open" — absence means open.
   */
  collapsedTicketIds: Record<string, true>;
  /** Insertion-ordered list of collapsed ticket IDs, used for FIFO eviction. */
  collapsedTicketOrder: TicketId[];
}

export interface UiState extends UiProjectState, UiThreadState, UiBoardState, UiTicketState {
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
  startupRecoveryStateByThreadId: {},
  managementBoardContext: null,
  boardViewMode: "cards",
  browserVisibleByProjectId: {},
  boardFiltersByProjectId: {},
  viewMode: "chat",
  collapsedTicketIds: {},
  collapsedTicketOrder: [],
};

const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
let persistedViewMode: ViewMode = "chat";
let persistedBoardViewMode: BoardViewMode = "cards";
let persistedBrowserVisibleByProjectId: Record<string, boolean> = {};
let persistedBoardFiltersByProjectId: Record<string, BoardFilters> = {};
let persistedManagementBoardContext: BoardContext | null = null;
let persistedCollapsedTicketOrder: TicketId[] = [];
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
          boardViewMode: persistedBoardViewMode,
          browserVisibleByProjectId: persistedBrowserVisibleByProjectId,
          boardFiltersByProjectId: persistedBoardFiltersByProjectId,
          managementBoardContext: persistedManagementBoardContext,
          collapsedTicketIds: Object.fromEntries(
            persistedCollapsedTicketOrder.map((id) => [id, true] as const),
          ),
          collapsedTicketOrder: [...persistedCollapsedTicketOrder],
        };
      }
      return initialState;
    }
    hydratePersistedUiState(JSON.parse(raw) as PersistedUiState);
    return {
      ...initialState,
      viewMode: persistedViewMode,
      boardViewMode: persistedBoardViewMode,
      browserVisibleByProjectId: persistedBrowserVisibleByProjectId,
      boardFiltersByProjectId: persistedBoardFiltersByProjectId,
      managementBoardContext: persistedManagementBoardContext,
      collapsedTicketIds: Object.fromEntries(
        persistedCollapsedTicketOrder.map((id) => [id, true] as const),
      ),
      collapsedTicketOrder: [...persistedCollapsedTicketOrder],
    };
  } catch {
    return initialState;
  }
}

function hydratePersistedUiState(parsed: PersistedUiState): void {
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  persistedManagementBoardContext = null;
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
  // Legacy `boardViewMode: "browser"` and the previous global `browserVisible`
  // boolean were app-wide flags. Visibility is now per-project, so neither
  // legacy shape can be safely migrated without knowing which project they
  // applied to — drop them and let the user re-toggle per project.
  persistedBoardViewMode =
    parsed.boardViewMode === "cards" || parsed.boardViewMode === "list"
      ? parsed.boardViewMode
      : "cards";
  persistedBrowserVisibleByProjectId = {};
  if (parsed.browserVisibleByProjectId && typeof parsed.browserVisibleByProjectId === "object") {
    for (const [projectId, value] of Object.entries(parsed.browserVisibleByProjectId)) {
      if (typeof projectId === "string" && projectId.length > 0 && value === true) {
        persistedBrowserVisibleByProjectId[projectId] = true;
      }
    }
  }
  persistedBoardFiltersByProjectId = {};
  if (parsed.boardFiltersByProjectId && typeof parsed.boardFiltersByProjectId === "object") {
    for (const [projectId, raw] of Object.entries(parsed.boardFiltersByProjectId)) {
      if (!raw || typeof raw !== "object") continue;
      persistedBoardFiltersByProjectId[projectId] = {
        priorityFilter: Array.isArray(raw.priorityFilter)
          ? raw.priorityFilter.filter((v): v is string => typeof v === "string")
          : [],
        labelFilter: Array.isArray(raw.labelFilter)
          ? raw.labelFilter.filter((v): v is string => typeof v === "string")
          : [],
        statusFilter: Array.isArray(raw.statusFilter)
          ? raw.statusFilter.filter((v): v is string => typeof v === "string")
          : [],
        searchQuery: typeof raw.searchQuery === "string" ? raw.searchQuery : "",
        collapsedStatuses: Array.isArray(raw.collapsedStatuses)
          ? raw.collapsedStatuses.filter((v): v is string => typeof v === "string")
          : [],
      };
    }
  }

  persistedCollapsedTicketOrder = [];
  if (Array.isArray(parsed.collapsedTicketIds)) {
    const seen = new Set<string>();
    for (const value of parsed.collapsedTicketIds) {
      if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
      seen.add(value);
      persistedCollapsedTicketOrder.push(value as TicketId);
      if (persistedCollapsedTicketOrder.length >= COLLAPSED_TICKET_LIMIT) break;
    }
  }

  const context = parsed.managementBoardContext;
  if (typeof context?.projectId === "string" && context.projectId.length > 0) {
    const ticketStack = (context.ticketStack ?? []).filter(
      (ticketId): ticketId is TicketId => typeof ticketId === "string" && ticketId.length > 0,
    );
    persistedManagementBoardContext = {
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
        boardViewMode: state.boardViewMode,
        browserVisibleByProjectId: state.browserVisibleByProjectId,
        boardFiltersByProjectId: state.boardFiltersByProjectId,
        managementBoardContext: state.managementBoardContext,
        collapsedTicketIds: state.collapsedTicketOrder.slice(-COLLAPSED_TICKET_LIMIT),
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

function boardContextEqual(left: BoardContext | null, right: BoardContext | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.projectId === right.projectId &&
    left.boardScrollLeft === right.boardScrollLeft &&
    left.updatedAt === right.updatedAt &&
    ticketStacksEqual(left.ticketStack, right.ticketStack)
  );
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

function setManagementBoardContext(state: UiState, nextContext: BoardContext | null): UiState {
  if (boardContextEqual(state.managementBoardContext, nextContext)) {
    return state;
  }
  return {
    ...state,
    managementBoardContext: nextContext,
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

  const nextManagementBoardContext = (() => {
    const current = state.managementBoardContext;
    if (!current) {
      return null;
    }
    if (currentProjectCwdById.has(current.projectId)) {
      return current;
    }
    const previousCwd = previousProjectCwdById.get(current.projectId);
    if (!previousCwd) {
      return null;
    }
    const recreatedProjectId = mappedProjects.find((project) => project.cwd === previousCwd)?.id;
    return recreatedProjectId ? buildBoardContext(recreatedProjectId, current) : null;
  })();

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    boardContextEqual(state.managementBoardContext, nextManagementBoardContext) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
    managementBoardContext: nextManagementBoardContext,
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
  const nextStartupRecoveryStateByThreadId = Object.fromEntries(
    Object.entries(state.startupRecoveryStateByThreadId).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId),
    ),
  ) as Record<string, "active" | "dismissed">;

  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    recordsEqual(state.startupRecoveryStateByThreadId, nextStartupRecoveryStateByThreadId)
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    startupRecoveryStateByThreadId: nextStartupRecoveryStateByThreadId,
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
  const hasStartupRecoveryState = threadId in state.startupRecoveryStateByThreadId;
  if (!hasVisitState && !hasStartupRecoveryState) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  const nextStartupRecoveryStateByThreadId = { ...state.startupRecoveryStateByThreadId };
  delete nextThreadLastVisitedAtById[threadId];
  delete nextStartupRecoveryStateByThreadId[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    startupRecoveryStateByThreadId: nextStartupRecoveryStateByThreadId,
  };
}

export function setStartupWasWorkingThreads(
  state: UiState,
  threadIds: readonly ThreadId[],
): UiState {
  const nextStartupRecoveryStateByThreadId = Object.fromEntries(
    threadIds.map((threadId) => [threadId, "active"] as const),
  ) as Record<string, "active" | "dismissed">;
  if (recordsEqual(state.startupRecoveryStateByThreadId, nextStartupRecoveryStateByThreadId)) {
    return state;
  }
  return {
    ...state,
    startupRecoveryStateByThreadId: nextStartupRecoveryStateByThreadId,
  };
}

export function clearStartupWasWorkingThread(state: UiState, threadId: ThreadId): UiState {
  if (state.startupRecoveryStateByThreadId[threadId] !== "active") {
    return state;
  }
  const nextStartupRecoveryStateByThreadId = { ...state.startupRecoveryStateByThreadId };
  nextStartupRecoveryStateByThreadId[threadId] = "dismissed";
  return {
    ...state,
    startupRecoveryStateByThreadId: nextStartupRecoveryStateByThreadId,
  };
}

export function removeStartupRecoveryState(state: UiState, threadId: ThreadId): UiState {
  if (!(threadId in state.startupRecoveryStateByThreadId)) {
    return state;
  }
  const nextStartupRecoveryStateByThreadId = { ...state.startupRecoveryStateByThreadId };
  delete nextStartupRecoveryStateByThreadId[threadId];
  return {
    ...state,
    startupRecoveryStateByThreadId: nextStartupRecoveryStateByThreadId,
  };
}

export function setManagementBoardRoot(state: UiState, projectId: ProjectId): UiState {
  const currentContext = state.managementBoardContext;
  const boardScrollLeft =
    currentContext?.projectId === projectId ? currentContext.boardScrollLeft : 0;
  return setManagementBoardContext(state, buildBoardContext(projectId, { boardScrollLeft }));
}

export function pushManagementBoardTicket(
  state: UiState,
  projectId: ProjectId,
  ticketId: TicketId,
): UiState {
  const currentContext = state.managementBoardContext;
  const currentStack = currentContext?.projectId === projectId ? currentContext.ticketStack : [];
  if (currentStack[currentStack.length - 1] === ticketId) {
    return state;
  }
  return setManagementBoardContext(
    state,
    buildBoardContext(projectId, {
      ticketStack: [...currentStack, ticketId],
      boardScrollLeft: currentContext?.projectId === projectId ? currentContext.boardScrollLeft : 0,
    }),
  );
}

export function popManagementBoardTicket(state: UiState): UiState {
  const currentContext = state.managementBoardContext;
  if (!currentContext || currentContext.ticketStack.length === 0) {
    return state;
  }
  return setManagementBoardContext(
    state,
    buildBoardContext(currentContext.projectId, {
      ticketStack: currentContext.ticketStack.slice(0, -1),
      boardScrollLeft: currentContext.boardScrollLeft,
    }),
  );
}

export function replaceManagementBoardStack(
  state: UiState,
  projectId: ProjectId,
  ticketStack: readonly TicketId[],
): UiState {
  const currentContext = state.managementBoardContext;
  return setManagementBoardContext(
    state,
    buildBoardContext(projectId, {
      ticketStack: [...ticketStack],
      boardScrollLeft: currentContext?.projectId === projectId ? currentContext.boardScrollLeft : 0,
    }),
  );
}

export function setManagementBoardScrollLeft(state: UiState, scrollLeft: number): UiState {
  const currentContext = state.managementBoardContext;
  if (!currentContext) {
    return state;
  }
  const normalizedScrollLeft = Math.max(0, scrollLeft);
  if (currentContext.boardScrollLeft === normalizedScrollLeft) {
    return state;
  }
  return setManagementBoardContext(
    state,
    buildBoardContext(currentContext.projectId, {
      ticketStack: currentContext.ticketStack,
      boardScrollLeft: normalizedScrollLeft,
    }),
  );
}

export function clearManagementBoardContext(state: UiState): UiState {
  return setManagementBoardContext(state, null);
}

export function sanitizeManagementBoardContext(
  state: UiState,
  projectId: ProjectId,
  validTicketIds: ReadonlySet<TicketId>,
): UiState {
  const currentContext = state.managementBoardContext;
  if (!currentContext || currentContext.projectId !== projectId) {
    return setManagementBoardRoot(state, projectId);
  }

  const sanitizedStack = currentContext.ticketStack.filter((ticketId) =>
    validTicketIds.has(ticketId),
  );
  if (ticketStacksEqual(currentContext.ticketStack, sanitizedStack)) {
    return state;
  }

  return setManagementBoardContext(
    state,
    buildBoardContext(projectId, {
      ticketStack: sanitizedStack,
      boardScrollLeft: currentContext.boardScrollLeft,
    }),
  );
}

export function setBoardViewMode(state: UiState, mode: BoardViewMode): UiState {
  if (state.boardViewMode === mode) return state;
  return { ...state, boardViewMode: mode };
}

export function setBrowserVisible(state: UiState, projectId: ProjectId, visible: boolean): UiState {
  const current = state.browserVisibleByProjectId[projectId] ?? false;
  if (current === visible) return state;
  const next = { ...state.browserVisibleByProjectId };
  if (visible) {
    next[projectId] = true;
  } else {
    delete next[projectId];
  }
  return { ...state, browserVisibleByProjectId: next };
}

export function setBoardFilters(
  state: UiState,
  projectId: ProjectId,
  updates: Partial<BoardFilters>,
): UiState {
  const current = state.boardFiltersByProjectId[projectId] ?? DEFAULT_BOARD_FILTERS;
  const next = { ...current, ...updates };
  return {
    ...state,
    boardFiltersByProjectId: { ...state.boardFiltersByProjectId, [projectId]: next },
  };
}

export function toggleBoardCollapsedStatus(
  state: UiState,
  projectId: ProjectId,
  status: string,
): UiState {
  const current = state.boardFiltersByProjectId[projectId] ?? DEFAULT_BOARD_FILTERS;
  const collapsed = current.collapsedStatuses.includes(status)
    ? current.collapsedStatuses.filter((s) => s !== status)
    : [...current.collapsedStatuses, status];
  return {
    ...state,
    boardFiltersByProjectId: {
      ...state.boardFiltersByProjectId,
      [projectId]: { ...current, collapsedStatuses: collapsed },
    },
  };
}

export function toggleTicketCollapsed(state: UiState, ticketId: TicketId): UiState {
  const wasCollapsed = state.collapsedTicketIds[ticketId] === true;
  if (wasCollapsed) {
    const nextCollapsedIds = { ...state.collapsedTicketIds };
    delete nextCollapsedIds[ticketId];
    return {
      ...state,
      collapsedTicketIds: nextCollapsedIds,
      collapsedTicketOrder: state.collapsedTicketOrder.filter((id) => id !== ticketId),
    };
  }
  // Mark as collapsed. Append to the order list (FIFO), trimming the oldest entries
  // when we exceed the persistence cap so localStorage stays bounded.
  const order = [...state.collapsedTicketOrder, ticketId];
  const trimmed =
    order.length > COLLAPSED_TICKET_LIMIT ? order.slice(-COLLAPSED_TICKET_LIMIT) : order;
  const nextCollapsedIds: Record<string, true> =
    trimmed.length === order.length
      ? { ...state.collapsedTicketIds, [ticketId]: true }
      : Object.fromEntries(trimmed.map((id) => [id, true] as const));
  return {
    ...state,
    collapsedTicketIds: nextCollapsedIds,
    collapsedTicketOrder: trimmed,
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
  setStartupWasWorkingThreads: (threadIds: readonly ThreadId[]) => void;
  clearStartupWasWorkingThread: (threadId: ThreadId) => void;
  removeStartupRecoveryState: (threadId: ThreadId) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: ThreadId) => void;
  setManagementBoardRoot: (projectId: ProjectId) => void;
  pushManagementBoardTicket: (projectId: ProjectId, ticketId: TicketId) => void;
  popManagementBoardTicket: () => void;
  replaceManagementBoardStack: (projectId: ProjectId, ticketStack: readonly TicketId[]) => void;
  setManagementBoardScrollLeft: (scrollLeft: number) => void;
  clearManagementBoardContext: () => void;
  sanitizeManagementBoardContext: (
    projectId: ProjectId,
    validTicketIds: ReadonlySet<TicketId>,
  ) => void;
  toggleProject: (projectId: ProjectId) => void;
  toggleTicketCollapsed: (ticketId: TicketId) => void;
  setProjectExpanded: (projectId: ProjectId, expanded: boolean) => void;
  reorderProjects: (draggedProjectId: ProjectId, targetProjectId: ProjectId) => void;
  setViewMode: (mode: ViewMode) => void;
  setBoardViewMode: (mode: BoardViewMode) => void;
  setBrowserVisible: (projectId: ProjectId, visible: boolean) => void;
  setBoardFilters: (projectId: ProjectId, updates: Partial<BoardFilters>) => void;
  toggleBoardCollapsedStatus: (projectId: ProjectId, status: string) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  setStartupWasWorkingThreads: (threadIds) =>
    set((state) => setStartupWasWorkingThreads(state, threadIds)),
  clearStartupWasWorkingThread: (threadId) =>
    set((state) => clearStartupWasWorkingThread(state, threadId)),
  removeStartupRecoveryState: (threadId) =>
    set((state) => removeStartupRecoveryState(state, threadId)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  setManagementBoardRoot: (projectId) => set((state) => setManagementBoardRoot(state, projectId)),
  pushManagementBoardTicket: (projectId, ticketId) =>
    set((state) => pushManagementBoardTicket(state, projectId, ticketId)),
  popManagementBoardTicket: () => set((state) => popManagementBoardTicket(state)),
  replaceManagementBoardStack: (projectId, ticketStack) =>
    set((state) => replaceManagementBoardStack(state, projectId, ticketStack)),
  setManagementBoardScrollLeft: (scrollLeft) =>
    set((state) => setManagementBoardScrollLeft(state, scrollLeft)),
  clearManagementBoardContext: () => set((state) => clearManagementBoardContext(state)),
  sanitizeManagementBoardContext: (projectId, validTicketIds) =>
    set((state) => sanitizeManagementBoardContext(state, projectId, validTicketIds)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  toggleTicketCollapsed: (ticketId) => set((state) => toggleTicketCollapsed(state, ticketId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  setViewMode: (mode) => set({ viewMode: mode }),
  setBoardViewMode: (mode) => set((state) => setBoardViewMode(state, mode)),
  setBrowserVisible: (projectId, visible) =>
    set((state) => setBrowserVisible(state, projectId, visible)),
  setBoardFilters: (projectId, updates) =>
    set((state) => setBoardFilters(state, projectId, updates)),
  toggleBoardCollapsedStatus: (projectId, status) =>
    set((state) => toggleBoardCollapsedStatus(state, projectId, status)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
