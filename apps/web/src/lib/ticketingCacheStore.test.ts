import type { NativeApi, ProjectId, TicketSummary } from "@t3tools/contracts";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  __resetTicketingCacheForTests,
  applyLocalTicketUpdates,
  applyTicketEvent,
  beginTicketFetch,
  completeTicketFetch,
  fetchTicketingProject,
  getCachedTickets,
} from "./ticketingCacheStore";

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

describe("ticketingCacheStore", () => {
  beforeEach(() => {
    __resetTicketingCacheForTests();
  });

  it("keeps stale fetch completions from overwriting newer project cache data", () => {
    const projectId = "project-1" as ProjectId;
    const staleRequest = beginTicketFetch(projectId, "loading");
    const freshRequest = beginTicketFetch(projectId, "loading");
    const freshTicket = makeTicket({ title: "Fresh" });

    completeTicketFetch(projectId, freshRequest, [freshTicket]);
    completeTicketFetch(projectId, staleRequest, [makeTicket({ title: "Stale" })]);

    expect(getCachedTickets(projectId)?.tickets).toEqual([freshTicket]);
  });

  it("patches only cached matching projects from ticket stream events", () => {
    const project1 = "project-1" as ProjectId;
    const project2 = "project-2" as ProjectId;
    const request = beginTicketFetch(project1, "loading");
    completeTicketFetch(project1, request, [makeTicket()]);

    applyTicketEvent({
      type: "ticket_upserted",
      projectId: project2,
      ticket: makeTicket({
        id: "ticket-2" as TicketSummary["id"],
        projectId: project2,
        title: "Uncached project",
      }),
    });
    expect(getCachedTickets(project2)).toBeUndefined();

    applyTicketEvent({
      type: "ticket_upserted",
      projectId: project1,
      ticket: makeTicket({ title: "Updated cached project" }),
    });
    expect(getCachedTickets(project1)?.tickets[0]?.title).toBe("Updated cached project");
  });

  it("removes archived tickets and applies optimistic reorder within one project cache", () => {
    const projectId = "project-1" as ProjectId;
    const request = beginTicketFetch(projectId, "loading");
    completeTicketFetch(projectId, request, [
      makeTicket({ id: "ticket-1" as TicketSummary["id"], sortOrder: 0 }),
      makeTicket({ id: "ticket-2" as TicketSummary["id"], sortOrder: 1000 }),
    ]);

    applyLocalTicketUpdates(projectId, [{ id: "ticket-2", sortOrder: 0, status: "in_progress" }]);
    expect(getCachedTickets(projectId)?.tickets[1]).toMatchObject({
      id: "ticket-2",
      sortOrder: 0,
      status: "in_progress",
    });

    applyTicketEvent({
      type: "ticket_upserted",
      projectId,
      ticket: makeTicket({ id: "ticket-2" as TicketSummary["id"], isArchived: true }),
    });
    expect(getCachedTickets(projectId)?.tickets.map((ticket) => ticket.id)).toEqual(["ticket-1"]);
  });

  it("dedupes in-flight project fetches", async () => {
    const projectId = "project-1" as ProjectId;
    const list = vi.fn(async () => [makeTicket()]);
    const api = { ticketing: { list } } as unknown as Pick<NativeApi, "ticketing">;

    await Promise.all([
      fetchTicketingProject({ api, projectId, force: true }),
      fetchTicketingProject({ api, projectId, force: true }),
    ]);

    expect(list).toHaveBeenCalledOnce();
    expect(getCachedTickets(projectId)?.tickets).toHaveLength(1);
  });
});
