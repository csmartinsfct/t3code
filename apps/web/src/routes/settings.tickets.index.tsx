import { createFileRoute } from "@tanstack/react-router";

import { TicketsPanel } from "../components/settings/TicketsPanel";

type TicketsSearch = { project?: string };

export const Route = createFileRoute("/settings/tickets/")({
  validateSearch: (search: Record<string, unknown>): TicketsSearch => {
    const project = typeof search.project === "string" ? search.project : null;
    return project ? { project } : {};
  },
  component: TicketsPanel,
});
