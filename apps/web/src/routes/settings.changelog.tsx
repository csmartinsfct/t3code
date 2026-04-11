import { createFileRoute } from "@tanstack/react-router";

import { ChangelogPanel } from "../components/settings/ChangelogPanel";

export const Route = createFileRoute("/settings/changelog")({
  component: ChangelogPanel,
});
