import type { TicketSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  fetchTicketingState,
  resolveTicketingLoadingState,
  resolveTicketingProjectResyncState,
} from "./useTicketing";

// Audit traceability: 4973c83.

function makeTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: "ticket-1" as TicketSummary["id"],
    projectId: "project-1" as TicketSummary["projectId"],
    parentId: null,
    ticketNumber: 1,
    identifier: "T3CO-1",
    title: "Default ticket",
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function unexpectedListWithoutResolvedProject() {
  throw new Error("ticket listing should not run without a resolved project");
}

describe("resolveTicketingProjectResyncState", () => {
  it("does not resync when no projectId prop is supplied", () => {
    expect(
      resolveTicketingProjectResyncState({
        requestedProjectId: undefined,
        selectedProjectId: "project-1",
      }),
    ).toEqual({
      shouldResync: false,
      nextProjectId: null,
    });
  });

  it("requests a reset when the caller switches to a different project while mounted", () => {
    expect(
      resolveTicketingProjectResyncState({
        requestedProjectId: "project-2",
        selectedProjectId: "project-1",
      }),
    ).toEqual({
      shouldResync: true,
      nextProjectId: "project-2",
    });
  });

  it("requests a reset when the hook receives its first concrete projectId", () => {
    expect(
      resolveTicketingProjectResyncState({
        requestedProjectId: "project-1",
        selectedProjectId: null,
      }),
    ).toEqual({
      shouldResync: true,
      nextProjectId: "project-1",
    });
  });

  it("does not reset when the caller keeps the current project", () => {
    expect(
      resolveTicketingProjectResyncState({
        requestedProjectId: "project-1",
        selectedProjectId: "project-1",
      }),
    ).toEqual({
      shouldResync: false,
      nextProjectId: "project-1",
    });
  });
});

describe("resolveTicketingLoadingState", () => {
  it("shows full loading only when a resolved project has no tickets yet", () => {
    expect(
      resolveTicketingLoadingState({
        tickets: [],
        status: "loading",
        hasResolvedProject: true,
      }),
    ).toEqual({ loading: true, refreshing: false });

    expect(
      resolveTicketingLoadingState({
        tickets: [makeTicket()],
        status: "refreshing",
        hasResolvedProject: true,
      }),
    ).toEqual({ loading: false, refreshing: true });
  });
});

describe("fetchTicketingState", () => {
  it("resolves the requested project and returns its tickets", async () => {
    const tickets = [makeTicket()];
    const api = {
      ticketing: {
        list: async ({ projectId }: { projectId: string }) => {
          expect(projectId).toBe("project-1");
          return tickets;
        },
      },
    } as any;

    const result = await fetchTicketingState({
      api,
      storeProjects: [{ id: "project-1", name: "Project One", cwd: "/repo/project-1" }],
      requestedProjectId: "project-1",
      selectedProjectId: null,
      currentFetchId: 1,
      isCurrentFetch: () => true,
    });

    expect(result).toEqual({
      projects: [{ id: "project-1", title: "Project One", workspaceRoot: "/repo/project-1" }],
      resolvedProjectId: "project-1",
      tickets,
      shouldSelectResolvedProject: true,
    });
  });

  it("returns early with no tickets when neither the selection nor store provides a project", async () => {
    const api = {
      ticketing: {
        list: unexpectedListWithoutResolvedProject,
      },
    } as any;

    const result = await fetchTicketingState({
      api,
      storeProjects: [],
      requestedProjectId: undefined,
      selectedProjectId: null,
      currentFetchId: 1,
      isCurrentFetch: () => true,
    });

    expect(result).toEqual({
      projects: [],
      resolvedProjectId: null,
      tickets: [],
      shouldSelectResolvedProject: false,
    });
  });

  it("suppresses stale results after the active project changes mid-fetch", async () => {
    const tickets = deferred<ReadonlyArray<TicketSummary>>();
    let activeFetchId = 1;
    const api = {
      ticketing: {
        list: () => tickets.promise,
      },
    } as any;

    const staleFetch = fetchTicketingState({
      api,
      storeProjects: [{ id: "project-1", name: "Project One", cwd: "/repo/project-1" }],
      requestedProjectId: "project-1",
      selectedProjectId: "project-1",
      currentFetchId: 1,
      isCurrentFetch: (fetchId) => activeFetchId === fetchId,
    });

    activeFetchId = 2;
    tickets.resolve([makeTicket()]);

    await expect(staleFetch).resolves.toBeNull();
  });
});
