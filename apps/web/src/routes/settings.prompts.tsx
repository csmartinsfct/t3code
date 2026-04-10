import { createFileRoute } from "@tanstack/react-router";

import { PromptsPanel } from "../components/settings/PromptsPanel";

export const Route = createFileRoute("/settings/prompts")({
  component: PromptsPanel,
});
