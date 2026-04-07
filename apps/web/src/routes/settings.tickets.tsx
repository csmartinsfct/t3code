import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/tickets")({
  component: () => <Outlet />,
});
