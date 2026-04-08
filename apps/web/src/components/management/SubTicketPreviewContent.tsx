import type { AcceptanceCriterion, Ticket, TicketId } from "@t3tools/contracts";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";


import { TicketMarkdown } from "./TicketMarkdown";

interface SubTicketPreviewContentProps {
  ticketId: TicketId;
  fetchPreview: (id: TicketId) => Promise<Ticket | null>;
  getCached: (id: TicketId) => Ticket | undefined;
}

export function SubTicketPreviewContent({
  ticketId,
  fetchPreview,
  getCached,
}: SubTicketPreviewContentProps) {
  const [ticket, setTicket] = useState<Ticket | null | undefined>(getCached(ticketId) ?? undefined);

  useEffect(() => {
    const cached = getCached(ticketId);
    if (cached) {
      setTicket(cached);
      return;
    }
    let cancelled = false;
    void fetchPreview(ticketId).then((result) => {
      if (!cancelled) setTicket(result);
    });
    return () => {
      cancelled = true;
    };
  }, [ticketId, fetchPreview, getCached]);

  if (ticket === undefined) {
    return <PreviewSkeleton />;
  }

  if (ticket === null) {
    return <p className="py-2 text-center text-xs text-muted-foreground">Failed to load preview</p>;
  }

  const criteria = ticket.acceptanceCriteria ?? [];
  const metCount = criteria.filter((c) => c.status === "met").length;

  return (
    <div className="-mr-4 flex max-h-[568px] flex-col gap-3 overflow-y-auto pr-4">
      {/* Title */}
      <h4 className="text-sm font-medium leading-snug text-foreground">{ticket.title}</h4>

      {/* Description */}
      {ticket.description && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Description</span>
          <div className="text-foreground/80">
            <TicketMarkdown>{ticket.description}</TicketMarkdown>
          </div>
        </div>
      )}

      {/* Acceptance Criteria (read-only) */}
      {criteria.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Acceptance Criteria ({metCount}/{criteria.length})
          </span>
          <div className="flex flex-col gap-1">
            {criteria.map((c, i) => (
              <ReadOnlyCriterion key={i} criterion={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyCriterion({ criterion }: { criterion: AcceptanceCriterion }) {
  return (
    <div className="flex items-start gap-2 rounded-md px-1 py-0.5">
      <div className="mt-0.5 shrink-0">
        {criterion.status === "met" ? (
          <div className="flex size-3.5 items-center justify-center rounded-[.2rem] bg-emerald-500 text-white">
            <CheckIcon className="size-2.5" strokeWidth={3} />
          </div>
        ) : criterion.status === "not_met" ? (
          <div className="flex size-3.5 items-center justify-center rounded-[.2rem] bg-destructive text-white">
            <XIcon className="size-2.5" strokeWidth={3} />
          </div>
        ) : (
          <div className="size-3.5 rounded-[.2rem] border border-input" />
        )}
      </div>
      <span
        className={`text-xs leading-snug ${
          criterion.status === "met"
            ? "text-muted-foreground line-through"
            : criterion.status === "not_met"
              ? "text-destructive"
              : "text-foreground"
        }`}
      >
        {criterion.text}
      </span>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="flex flex-col gap-1.5">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-5/6 rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    </div>
  );
}
