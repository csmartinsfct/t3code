import { createFileRoute } from "@tanstack/react-router";

import { TicketsPanel } from "../components/settings/TicketsPanel";

export const Route = createFileRoute("/settings/tickets")({
  component: TicketsPanel,
});
