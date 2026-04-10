import type { TicketSummary } from "@t3tools/contracts";

interface TicketMultiSelectEvent {
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}

interface TicketMultiSelectActions {
  toggleTicket: (ticketId: TicketSummary["id"], ticket: TicketSummary) => void;
  rangeSelectTo: (ticketId: TicketSummary["id"], orderedTickets: readonly TicketSummary[]) => void;
}

export function handleTicketMultiSelectGesture(
  event: TicketMultiSelectEvent,
  ticket: TicketSummary,
  orderedTickets: readonly TicketSummary[],
  actions: TicketMultiSelectActions,
): boolean {
  if (event.altKey || event.metaKey) {
    event.preventDefault();
    actions.toggleTicket(ticket.id, ticket);
    return true;
  }

  if (event.shiftKey) {
    event.preventDefault();
    actions.rangeSelectTo(ticket.id, orderedTickets);
    return true;
  }

  return false;
}
