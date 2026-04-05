import { createFileRoute } from "@tanstack/react-router";

import { CronJobsPanel } from "../components/settings/CronJobsPanel";

export const Route = createFileRoute("/settings/cron/")({
  component: CronJobsPanel,
});
