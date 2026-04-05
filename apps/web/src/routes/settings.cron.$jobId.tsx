import { createFileRoute } from "@tanstack/react-router";

import { CronJobDetailPanel } from "../components/settings/CronJobDetailPanel";

export const Route = createFileRoute("/settings/cron/$jobId")({
  component: CronJobDetailPanel,
});
