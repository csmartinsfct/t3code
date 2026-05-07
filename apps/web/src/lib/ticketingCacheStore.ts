import type {
  NativeApi,
  ProjectId,
  TicketId,
  TicketSummary,
  TicketingStreamEvent,
} from "@t3tools/contracts";
import { create } from "zustand";

import { readNativeApi } from "../nativeApi";

export const TICKETING_CACHE_REFRESH_MS = 30_000;
const HOVER_PRELOAD_DELAY_MS = 200;

export type TicketingProjectCacheStatus = "loading" | "ready" | "refreshing" | "error";

export interface TicketingProjectCacheEntry {
  readonly projectId: ProjectId;
  readonly tickets: ReadonlyArray<TicketSummary>;
  readonly status: TicketingProjectCacheStatus;
  readonly loadedAt: number | null;
  readonly lastAccessedAt: number;
  readonly error: string | null;
  readonly requestId: number;
}

export type TicketingCacheState = Record<string, TicketingProjectCacheEntry>;

interface TicketingCacheStore {
  entries: TicketingCacheState;
  markAccessed: (projectId: ProjectId, now?: number) => void;
}

const inFlightTicketFetches = new Map<ProjectId, Promise<void>>();
const hoverPreloadTimers = new Map<ProjectId, ReturnType<typeof setTimeout>>();
let nextRequestId = 0;

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyEntry(
  projectId: ProjectId,
  status: TicketingProjectCacheStatus,
  requestId: number,
  now: number,
): TicketingProjectCacheEntry {
  return {
    projectId,
    tickets: [],
    status,
    loadedAt: null,
    lastAccessedAt: now,
    error: null,
    requestId,
  };
}

function upsertTicket(
  tickets: ReadonlyArray<TicketSummary>,
  ticket: TicketSummary,
): ReadonlyArray<TicketSummary> {
  const existingIndex = tickets.findIndex((item) => item.id === ticket.id);
  if (ticket.isArchived) {
    return existingIndex >= 0 ? tickets.filter((_, index) => index !== existingIndex) : tickets;
  }
  if (existingIndex >= 0) {
    const next = [...tickets];
    next[existingIndex] = ticket;
    return next;
  }
  return [ticket, ...tickets];
}

export const useTicketingCacheStore = create<TicketingCacheStore>((set) => ({
  entries: {},
  markAccessed: (projectId, now = Date.now()) =>
    set((state) => {
      const entry = state.entries[projectId];
      if (!entry || entry.lastAccessedAt === now) return state;
      return {
        entries: {
          ...state.entries,
          [projectId]: {
            ...entry,
            lastAccessedAt: now,
          },
        },
      };
    }),
}));

export function getCachedTickets(projectId: ProjectId): TicketingProjectCacheEntry | undefined {
  return useTicketingCacheStore.getState().entries[projectId];
}

export function hasCachedTickets(projectId: ProjectId): boolean {
  return getCachedTickets(projectId) !== undefined;
}

export function beginTicketFetch(projectId: ProjectId, mode: "loading" | "refreshing"): number {
  const requestId = ++nextRequestId;
  const now = Date.now();
  useTicketingCacheStore.setState((state) => {
    const previous = state.entries[projectId];
    return {
      entries: {
        ...state.entries,
        [projectId]: previous
          ? {
              ...previous,
              status: mode,
              error: null,
              requestId,
              lastAccessedAt: now,
            }
          : emptyEntry(projectId, mode, requestId, now),
      },
    };
  });
  return requestId;
}

export function completeTicketFetch(
  projectId: ProjectId,
  requestId: number,
  tickets: ReadonlyArray<TicketSummary>,
): void {
  const now = Date.now();
  useTicketingCacheStore.setState((state) => {
    const previous = state.entries[projectId];
    if (!previous || previous.requestId !== requestId) return state;
    return {
      entries: {
        ...state.entries,
        [projectId]: {
          ...previous,
          tickets,
          status: "ready",
          loadedAt: now,
          lastAccessedAt: now,
          error: null,
        },
      },
    };
  });
}

export function failTicketFetch(projectId: ProjectId, requestId: number, error: unknown): void {
  const now = Date.now();
  useTicketingCacheStore.setState((state) => {
    const previous = state.entries[projectId];
    if (!previous || previous.requestId !== requestId) return state;
    return {
      entries: {
        ...state.entries,
        [projectId]: {
          ...previous,
          status: "error",
          lastAccessedAt: now,
          error: errorToMessage(error),
        },
      },
    };
  });
}

export function applyTicketEvent(event: TicketingStreamEvent): void {
  useTicketingCacheStore.setState((state) => {
    if (event.type === "ticket_upserted") {
      const entry = state.entries[event.projectId];
      if (!entry) return state;
      return {
        entries: {
          ...state.entries,
          [event.projectId]: {
            ...entry,
            tickets: upsertTicket(entry.tickets, event.ticket),
          },
        },
      };
    }

    if (event.type === "ticket_deleted") {
      const entry = state.entries[event.projectId];
      if (!entry) return state;
      return {
        entries: {
          ...state.entries,
          [event.projectId]: {
            ...entry,
            tickets: entry.tickets.filter((ticket) => ticket.id !== event.ticketId),
          },
        },
      };
    }

    return state;
  });
}

export function applyTicketDeletedEverywhere(ticketId: TicketId): void {
  useTicketingCacheStore.setState((state) => {
    let changed = false;
    const entries: TicketingCacheState = {};
    for (const [projectId, entry] of Object.entries(state.entries)) {
      const tickets = entry.tickets.filter((ticket) => ticket.id !== ticketId);
      changed ||= tickets.length !== entry.tickets.length;
      entries[projectId] = tickets.length === entry.tickets.length ? entry : { ...entry, tickets };
    }
    return changed ? { entries } : state;
  });
}

export function applyLocalTicketUpdates(
  projectId: ProjectId,
  updates: ReadonlyArray<{ id: string; sortOrder: number; status?: string }>,
): void {
  useTicketingCacheStore.setState((state) => {
    const entry = state.entries[projectId];
    if (!entry) return state;
    const updateMap = new Map(updates.map((update) => [update.id, update]));
    return {
      entries: {
        ...state.entries,
        [projectId]: {
          ...entry,
          tickets: entry.tickets.map((ticket) => {
            const update = updateMap.get(ticket.id);
            if (!update) return ticket;
            if (update.status) {
              return Object.assign({}, ticket, {
                sortOrder: update.sortOrder,
                status: update.status as TicketSummary["status"],
              });
            }
            return Object.assign({}, ticket, { sortOrder: update.sortOrder });
          }),
        },
      },
    };
  });
}

export async function fetchTicketingProject(input: {
  api: Pick<NativeApi, "ticketing">;
  projectId: ProjectId;
  force?: boolean;
}): Promise<void> {
  const { api, projectId, force = false } = input;
  const existingFetch = inFlightTicketFetches.get(projectId);
  if (existingFetch) {
    await existingFetch;
    return;
  }

  const existing = getCachedTickets(projectId);
  if (!force && existing?.loadedAt && Date.now() - existing.loadedAt < TICKETING_CACHE_REFRESH_MS) {
    useTicketingCacheStore.getState().markAccessed(projectId);
    return;
  }

  const mode: "loading" | "refreshing" =
    existing && existing.tickets.length > 0 ? "refreshing" : "loading";
  const requestId = beginTicketFetch(projectId, mode);
  const promise = api.ticketing
    .list({ projectId: projectId as never })
    .then((tickets) => completeTicketFetch(projectId, requestId, tickets))
    .catch((error) => {
      failTicketFetch(projectId, requestId, error);
      throw error;
    })
    .finally(() => {
      if (inFlightTicketFetches.get(projectId) === promise) {
        inFlightTicketFetches.delete(projectId);
      }
    });

  inFlightTicketFetches.set(projectId, promise);
  await promise;
}

export function preloadTicketingProject(projectId: ProjectId): void {
  const entry = getCachedTickets(projectId);
  if (entry || inFlightTicketFetches.has(projectId) || hoverPreloadTimers.has(projectId)) return;

  const timer = setTimeout(() => {
    hoverPreloadTimers.delete(projectId);
    const api = readNativeApi();
    if (!api) return;
    void fetchTicketingProject({ api, projectId }).catch(() => {});
  }, HOVER_PRELOAD_DELAY_MS);

  hoverPreloadTimers.set(projectId, timer);
}

export function __resetTicketingCacheForTests(): void {
  for (const timer of hoverPreloadTimers.values()) {
    clearTimeout(timer);
  }
  hoverPreloadTimers.clear();
  inFlightTicketFetches.clear();
  nextRequestId = 0;
  useTicketingCacheStore.setState({ entries: {} });
}
