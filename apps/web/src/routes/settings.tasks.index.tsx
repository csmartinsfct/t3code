import { createFileRoute } from "@tanstack/react-router";

import { TasksPanel } from "../components/settings/TasksPanel";

export const Route = createFileRoute("/settings/tasks/")({
  component: TasksPanel,
});
