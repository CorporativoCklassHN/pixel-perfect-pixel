import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PortalLayout } from "@/components/portal/Layout";

export const Route = createFileRoute("/_portal")({
  component: () => (
    <PortalLayout>
      <Outlet />
    </PortalLayout>
  ),
});
