import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';

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
		<div className="min-h-dvh bg-background text-foreground">
			<header className="border-b border-border">
				<nav className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 text-sm">
					<Link to="/" className="font-semibold">
						Monque
					</Link>
					<Link to="/queue-views" activeProps={{ className: 'text-primary' }}>
						Queue Views
					</Link>
					<Link to="/jobs" activeProps={{ className: 'text-primary' }}>
						Jobs
					</Link>
					<Link to="/health" activeProps={{ className: 'text-primary' }}>
						Health
					</Link>
				</nav>
			</header>
			<main className="mx-auto max-w-6xl px-4 py-6">
				<Outlet />
			</main>
		</div>
	);
}

function RootPending() {
	return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
}

function RootError() {
	return <div className="p-4 text-sm text-destructive">Dashboard route failed.</div>;
}

function RootNotFound() {
	return <div className="p-4 text-sm text-muted-foreground">Route not found.</div>;
}
