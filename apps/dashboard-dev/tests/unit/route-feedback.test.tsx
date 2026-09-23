// @vitest-environment jsdom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardRouteError, DashboardRoutePending } from '@/components/route-feedback';

describe('Router feedback', () => {
	it.each(['loader', 'render'])(
		'retries a failed route %s through router invalidation',
		async (failure) => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			let failed = true;
			const root = createRootRoute({ component: Outlet });
			const route = createRoute({
				getParentRoute: () => root,
				path: '/queue-views',
				loader: () => {
					if (failed && failure === 'loader') throw new Error('Temporary loader failure');
				},
				component: () => {
					if (failed && failure === 'render') throw new Error('Temporary render failure');
					return <h1>Recovered page</h1>;
				},
			});
			const router = createRouter({
				routeTree: root.addChildren([route]),
				history: createMemoryHistory({ initialEntries: ['/queue-views'] }),
				defaultErrorComponent: DashboardRouteError,
			});
			try {
				render(<RouterProvider router={router} />);
				await screen.findByRole('heading', { name: 'Dashboard route failed' });
				failed = false;
				fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
				expect(await screen.findByRole('heading', { name: 'Recovered page' })).toBeTruthy();
				expect(router.state.location.pathname).toBe('/queue-views');
			} finally {
				warn.mockRestore();
				error.mockRestore();
			}
		},
	);

	it('uses the shared pending component while a route loader is unresolved', async () => {
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const root = createRootRoute({ component: Outlet });
		const route = createRoute({
			getParentRoute: () => root,
			path: '/',
			loader: () => pending,
			component: () => <h1>Loaded page</h1>,
		});
		const router = createRouter({
			routeTree: root.addChildren([route]),
			history: createMemoryHistory({ initialEntries: ['/'] }),
			defaultPendingComponent: DashboardRoutePending,
			defaultPendingMs: 0,
			defaultPendingMinMs: 0,
		});
		render(<RouterProvider router={router} />);
		expect(await screen.findByText('Loading dashboard route…')).toBeTruthy();
		release();
		expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeTruthy();
	});
});
