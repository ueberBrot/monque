import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { CommandMenu } from '@/components/command-menu';
import { DashboardShell } from '@/components/dashboard-shell';
import { DashboardRouteNotFound } from '@/components/route-feedback';

import '../styles.css';
import type { DashboardRouterContext } from '../router-context.js';

export const Route = createRootRouteWithContext<DashboardRouterContext>()({
	component: RootComponent,
	notFoundComponent: DashboardRouteNotFound,
});

function RootComponent() {
	return (
		<DashboardShell>
			<CommandMenu />
			<Outlet />
		</DashboardShell>
	);
}
