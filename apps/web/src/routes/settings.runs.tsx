import { createFileRoute } from "@tanstack/react-router";

import { RunsSettingsPanel } from "../components/settings/RunsSettingsPanel";

export const Route = createFileRoute("/settings/runs")({
  component: RunsSettingsPanel,
});
