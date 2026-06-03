// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { createDashboardManagementApi } from '@/management-client';
import { createDashboardQueryClient } from '@/query-client';
import { getRouter } from '@/router';

import { createMockManagementFetch } from '../../../../apps/dashboard-dev/src/mock/management-server.js';

describe('Jobs route', () => {
	afterEach(() => {
		cleanup();
	});

	it('restores URL-backed filters and sorting into the Jobs table query', async () => {
		const fetchSpy = vi.fn(createMockManagementFetch({ scenarioId: 'large-dataset' }));

		renderJobsRoute({
			fetch: fetchSpy,
			initialEntry:
				'/jobs?name=dispatch-webhook&status=failed&sortBy=updatedAt&sortDirection=asc&limit=25',
		});

		await screen.findByRole('heading', { name: 'Jobs' });

		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalled();
		});

		expect((screen.getByLabelText('Job name') as HTMLInputElement).value).toBe('dispatch-webhook');
		expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
		expect(screen.getByText('Updated time')).toBeTruthy();
		expect(
			fetchSpy.mock.calls.some(([request]) => {
				const url = new URL(
					request instanceof Request ? request.url : String(request),
					'https://dashboard.test',
				);

				return (
					url.pathname === '/api/v1/jobs' &&
					url.searchParams.get('name') === 'dispatch-webhook' &&
					url.searchParams.get('status') === 'failed' &&
					url.searchParams.get('sortBy') === 'updatedAt' &&
					url.searchParams.get('sortDirection') === 'asc' &&
					url.searchParams.get('limit') === '25'
				);
			}),
		).toBe(true);
	});

	it('navigates with cursor pagination and keeps selection out of URL state', async () => {
		const { router } = renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs?limit=10',
		});

		const matchingCells = await screen.findAllByRole('cell', { name: /scenario-46003-/i });
		expect(matchingCells.length).toBeGreaterThan(0);

		fireEvent.click(getFirstElement(screen.getAllByRole('checkbox', { name: 'Select job row' })));
		expect(router.state.location.search).not.toHaveProperty('selected');

		const nextPageButtons = screen.getAllByRole('button', { name: 'Next page' });
		const nextPageButton = nextPageButtons.find((button) => !button.hasAttribute('disabled'));

		if (!nextPageButton) {
			throw new Error('Expected an enabled next page button.');
		}

		fireEvent.click(nextPageButton);

		await waitFor(() => {
			expect(router.state.location.search).toMatchObject({
				cursor: expect.any(String),
				limit: 10,
			});
		});
	});

	it('preserves selected rows across refreshes when the rows remain valid', async () => {
		const { router } = renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'pending-jobs' }),
			initialEntry: '/jobs?limit=10',
		});

		await screen.findAllByRole('checkbox', { name: 'Select job row' });

		fireEvent.click(getFirstElement(screen.getAllByRole('checkbox', { name: 'Select job row' })));
		expect(router.state.location.search).not.toHaveProperty('selected');

		await waitFor(() => {
			expect(screen.getByText('1 rows selected on this page')).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

		await waitFor(() => {
			expect(screen.getByText('1 rows selected on this page')).toBeTruthy();
		});
	});

	it('renders an empty state when no jobs match the current view', async () => {
		renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'empty-state' }),
			initialEntry: '/jobs',
		});

		expect(await screen.findByText('No jobs found')).toBeTruthy();
	});

	it('renders an unauthorized state when the API returns 401', async () => {
		renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'unauthorized' }),
			initialEntry: '/jobs',
		});

		expect(await screen.findByText('Sign in required')).toBeTruthy();
	});

	it('renders a forbidden state when the API returns 403', async () => {
		cleanup();

		renderJobsRoute({
			fetch: createForbiddenFetch(),
			initialEntry: '/jobs',
		});

		expect(await screen.findByText('Access denied')).toBeTruthy();
	});
});

function renderJobsRoute({
	fetch: fetchImplementation,
	initialEntry,
}: {
	readonly fetch: typeof globalThis.fetch;
	readonly initialEntry: string;
}) {
	const runtimeConfig = {
		apiBaseUrl: '/',
		basePath: '/',
	} as const;
	const managementApi = createDashboardManagementApi({
		apiBaseUrl: runtimeConfig.apiBaseUrl,
		fetch: fetchImplementation,
		origin: 'https://dashboard.test',
	});
	const queryClient = createDashboardQueryClient();
	const router = getRouter(
		{ managementApi, queryClient, runtimeConfig },
		{
			history: createMemoryHistory({
				initialEntries: [initialEntry],
			}),
		},
	);

	render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
			</TooltipProvider>
		</QueryClientProvider>,
	);

	return { router };
}

function createForbiddenFetch(): typeof fetch {
	return async () =>
		new Response(JSON.stringify({ error: 'Forbidden by test fixture.' }), {
			status: 403,
			headers: {
				'content-type': 'application/json',
			},
		});
}

function getFirstElement<TElement>(elements: readonly TElement[]): TElement {
	const firstElement = elements[0];

	if (!firstElement) {
		throw new Error('Expected at least one matching element.');
	}

	return firstElement;
}
