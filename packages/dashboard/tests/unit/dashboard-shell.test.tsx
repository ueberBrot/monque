// @vitest-environment jsdom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from '@/components/dashboard-shell';

describe('DashboardShell', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('keeps navigation and theme changes working when browser storage is blocked', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('Storage blocked', 'SecurityError');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Storage blocked', 'SecurityError');
		});
		const router = await renderShell('/jobs');
		fireEvent.click(getThemeButton());
		fireEvent.click(screen.getByRole('menuitem', { name: 'Dark theme' }));
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		fireEvent.click(screen.getByRole('link', { name: 'Health' }));
		await waitFor(() => expect(router.state.location.pathname).toBe('/health'));
	});

	it('renders primary navigation and opens the mobile drawer', async () => {
		const router = await renderShell('/queue-views');

		expect(screen.getAllByText('Queue Views').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Jobs').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Health').length).toBeGreaterThan(0);
		expect(screen.queryByText('Dashboard navigation')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

		const dialogContent = getDialogContent();

		expect(screen.getByText('Dashboard navigation')).toBeTruthy();
		expect(dialogContent.classList.contains('top-0')).toBe(true);
		expect(dialogContent.classList.contains('bottom-0')).toBe(true);
		expect(screen.getByText('Route content')).toBeTruthy();
		fireEvent.click(within(dialogContent).getByRole('link', { name: 'Jobs' }));
		await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
		await waitFor(() => expect(screen.queryByText('Dashboard navigation')).toBeNull());
		expect(screen.getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
	});

	it('lets the operator switch theme modes', async () => {
		await renderShell('/jobs');

		fireEvent.click(getThemeButton());
		fireEvent.click(screen.getByRole('menuitem', { name: 'Dark theme' }));

		expect(document.documentElement.classList.contains('dark')).toBe(true);

		fireEvent.click(getThemeButton());
		fireEvent.click(screen.getByRole('menuitem', { name: 'System theme' }));

		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});

function getThemeButton(): HTMLElement {
	const themeButtons = screen.getAllByRole('button', { name: 'Change theme' });
	const firstThemeButton = themeButtons[0];

	if (!firstThemeButton) {
		throw new Error('Expected at least one theme button.');
	}

	return firstThemeButton;
}

function getDialogContent(): HTMLElement {
	const dialogContent = screen
		.getByText('Dashboard navigation')
		.closest('[data-slot="dialog-content"]');

	if (!(dialogContent instanceof HTMLElement)) {
		throw new Error('Expected dashboard navigation to be inside dialog content.');
	}

	return dialogContent;
}

async function renderShell(path: string) {
	const root = createRootRoute({
		component: () => (
			<DashboardShell>
				<div>Route content</div>
			</DashboardShell>
		),
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: [path] }),
		routeTree: root.addChildren(
			['/queue-views', '/jobs', '/health'].map((path) =>
				createRoute({ getParentRoute: () => root, path }),
			),
		),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByText('Route content');
	return router;
}
