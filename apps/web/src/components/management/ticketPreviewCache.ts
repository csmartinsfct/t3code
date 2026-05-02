import type { ProjectId, Ticket, TicketId, TicketingStreamEvent } from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";

import { ensureNativeApi } from "../../nativeApi";

export function buildTicketDetailLookupInput(
  ticketId: TicketId,
  projectId: string,
): {
  id: TicketId;
  projectId: ProjectId;
  includeBody: true;
} {
  return {
    id: ticketId,
    projectId: projectId as ProjectId,
    includeBody: true,
  };
}

export function useTicketPreviewCache(projectId: string): {
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
  invalidatePreview: (id: TicketId) => void;
} {
  const cacheRef = useRef(new Map<string, Ticket>());
  const inflightRef = useRef(new Map<string, Promise<Ticket | null>>());
  const generationRef = useRef(0);

  const invalidatePreview = useCallback((id: TicketId) => {
    cacheRef.current.delete(String(id));
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    cacheRef.current.clear();
    inflightRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    const api = ensureNativeApi();
    return api.ticketing.onEvent((event: TicketingStreamEvent) => {
      if (event.type === "ticket_upserted") {
        invalidatePreview(event.ticket.id);
        return;
      }
      if (event.type === "ticket_deleted") {
        invalidatePreview(event.ticketId);
      }
    });
  }, [invalidatePreview]);

  const getCached = useCallback(
    (id: TicketId): Ticket | undefined => cacheRef.current.get(String(id)),
    [],
  );

  const fetchPreview = useCallback(
    async (id: TicketId): Promise<Ticket | null> => {
      const key = String(id);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;

      const inflight = inflightRef.current.get(key);
      if (inflight) return inflight;

      const generation = generationRef.current;
      const promise = ensureNativeApi()
        .ticketing.getById(buildTicketDetailLookupInput(id, projectId))
        .then((ticket) => {
          if (generation === generationRef.current) {
            cacheRef.current.set(key, ticket);
          }
          return ticket;
        })
        .catch(() => null)
        .finally(() => {
          if (generation === generationRef.current) {
            inflightRef.current.delete(key);
          }
        });

      inflightRef.current.set(key, promise);
      return promise;
    },
    [projectId],
  );

  return { fetchPreview, getCached, invalidatePreview };
}
