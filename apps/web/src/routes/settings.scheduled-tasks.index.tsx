import { createFileRoute } from "@tanstack/react-router";

import { ScheduledTasksPanel } from "../components/settings/ScheduledTasksPanel";

export const Route = createFileRoute("/settings/scheduled-tasks/")({
  component: ScheduledTasksPanel,
});
