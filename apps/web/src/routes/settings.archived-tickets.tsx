import { createFileRoute } from "@tanstack/react-router";

import { ArchivedTicketsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/archived-tickets")({
  component: ArchivedTicketsPanel,
});
