import { createFileRoute } from "@tanstack/react-router";

import { TasksPanel } from "../components/settings/TasksPanel";

type TasksSearch = { project?: string };

export const Route = createFileRoute("/settings/tasks/")({
  validateSearch: (search: Record<string, unknown>): TasksSearch => {
    const project = typeof search.project === "string" ? search.project : null;
    return project ? { project } : {};
  },
  component: TasksPanel,
});
