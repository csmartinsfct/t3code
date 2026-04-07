import { createFileRoute } from "@tanstack/react-router";

import { TaskDetailPanel } from "../components/settings/TaskDetailPanel";

export const Route = createFileRoute("/settings/tasks/$ticketId")({
  component: TaskDetailPanel,
});
