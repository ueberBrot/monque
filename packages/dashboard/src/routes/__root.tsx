import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { CommandMenu } from "@/components/command-menu";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardRouteNotFound } from "@/components/route-feedback";

import "../styles.css";
import type { DashboardRouterContext } from "../router-context.js";

const RootComponent = () => (
  <DashboardShell>
    <CommandMenu />
    <Outlet />
  </DashboardShell>
);
export const Route = createRootRouteWithContext<DashboardRouterContext>()({
  component: RootComponent,
  notFoundComponent: DashboardRouteNotFound,
});
