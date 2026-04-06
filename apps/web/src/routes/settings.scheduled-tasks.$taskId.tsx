import { createFileRoute } from "@tanstack/react-router";

import { ScheduledTaskDetailPanel } from "../components/settings/ScheduledTaskDetailPanel";

export const Route = createFileRoute("/settings/scheduled-tasks/$taskId")({
  component: ScheduledTaskDetailPanel,
});
