import { createFileRoute } from "@tanstack/react-router";

import { TicketDetailPanel } from "../components/settings/TicketDetailPanel";

export const Route = createFileRoute("/settings/tickets/$ticketId")({
  component: TicketDetailPanel,
});
