import {
	createRootRouteWithContext,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from '@tanstack/react-router';

import { type DashboardNavItem, DashboardShell } from '@/components/dashboard-shell';

import '../styles.css';
import type { DashboardRouterContext } from '../router-context.js';

export const Route = createRootRouteWithContext<DashboardRouterContext>()({
	component: RootComponent,
	errorComponent: RootError,
	notFoundComponent: RootNotFound,
	pendingComponent: RootPending,
});

function RootComponent() {
	const currentPath = useLocation().pathname;
	const navigate = useNavigate();

	return (
		<DashboardShell
			currentPath={currentPath}
			onNavigate={(href) => {
				void navigate({ to: href });
			}}
			renderNavLink={(item, options) => (
				<DashboardRouterNavLink item={item} onNavigate={options.onNavigate} />
			)}
		>
			<Outlet />
		</DashboardShell>
	);
}

function DashboardRouterNavLink({
	item,
	onNavigate,
}: {
	readonly item: DashboardNavItem;
	readonly onNavigate: (() => void) | undefined;
}) {
	return (
		<Link
			to={item.href}
			onClick={onNavigate}
			className="flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
			activeProps={{
				className: 'bg-primary/12 text-primary hover:bg-primary/12 hover:text-primary',
			}}
		>
			{item.label}
		</Link>
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
