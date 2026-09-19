import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { CommandMenu } from '@/components/command-menu';
import { DashboardShell } from '@/components/dashboard-shell';

import '../styles.css';
import type { DashboardRouterContext } from '../router-context.js';

export const Route = createRootRouteWithContext<DashboardRouterContext>()({
	component: RootComponent,
	errorComponent: RootError,
	notFoundComponent: RootNotFound,
	pendingComponent: RootPending,
});

function RootComponent() {
	return (
		<DashboardShell>
			<CommandMenu />
			<Outlet />
		</DashboardShell>
	);
}

function RootPending() {
	return (
		<section className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
			Loading dashboard route…
		</section>
	);
}

function RootError() {
	return (
		<section className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
			Dashboard route failed. Refresh the page or confirm the Management API is reachable.
		</section>
	);
}

function RootNotFound() {
	return (
		<section className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
			Route not found. Use Queue Views, Jobs, or Health to get back to a supported screen.
		</section>
	);
}
