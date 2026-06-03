// @vitest-environment jsdom

import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
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

	it('supports safe shell hotkeys for refresh and clearing URL-backed filters', async () => {
		const fetchSpy = vi.fn(createMockManagementFetch({ scenarioId: 'large-dataset' }));
		const { router } = renderJobsRoute({
			fetch: fetchSpy,
			initialEntry: '/jobs?name=dispatch-webhook&status=failed&limit=25',
		});

		await screen.findByRole('heading', { name: 'Jobs' });
		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalled();
		});

		const initialRequestCount = fetchSpy.mock.calls.length;

		fireEvent.keyDown(window, { key: 'R', shiftKey: true });

		await waitFor(() => {
			expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialRequestCount);
		});

		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		fireEvent.click(getLastElement(screen.getAllByText('Clear Jobs filters')));

		await waitFor(() => {
			expect((screen.getByLabelText('Job name') as HTMLInputElement).value).toBe('');
			expect(router.state.location.search).toMatchObject({
				limit: 50,
				sortBy: 'createdAt',
				sortDirection: 'desc',
				status: [],
			});
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

	it('deletes only explicitly selected jobs after bulk confirmation and refetches the list', async () => {
		const jobA = createListJob({
			id: 'job-bulk-a',
			name: 'send-email',
			status: 'pending',
		});
		const jobB = createListJob({
			id: 'job-bulk-b',
			name: 'dispatch-webhook',
			status: 'pending',
		});
		const fetchState = createJobsActionFetch({
			jobs: [jobA, jobB],
		});

		renderJobsRoute({
			fetch: fetchState.fetch,
			initialEntry: '/jobs',
		});

		expect((await screen.findAllByText(jobA.id)).length).toBeGreaterThan(0);
		expect(screen.getAllByText(jobB.id).length).toBeGreaterThan(0);

		fireEvent.click(getFirstElement(screen.getAllByRole('checkbox', { name: 'Select job row' })));
		fireEvent.click(screen.getByRole('button', { name: 'Delete selected jobs' }));

		expect(await screen.findByRole('heading', { name: 'Delete selected jobs?' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete selected jobs' }));

		await waitFor(() => {
			expect(screen.queryByText(jobA.id)).toBeNull();
		});

		expect(screen.getAllByText(jobB.id).length).toBeGreaterThan(0);
		expect(fetchState.deletedJobIds).toEqual(['job-bulk-a']);
		expect(fetchState.listRequestCount).toBeGreaterThanOrEqual(2);
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

function getLastElement<TElement>(elements: readonly TElement[]): TElement {
	const lastElement = elements[elements.length - 1];

	if (!lastElement) {
		throw new Error('Expected at least one matching element.');
	}

	return lastElement;
}

function createJobsActionFetch(options: {
	readonly capabilities?: CapabilitiesDto;
	readonly jobs: readonly JobDto[];
}): {
	readonly deletedJobIds: string[];
	readonly fetch: typeof fetch;
	readonly listRequestCount: number;
} {
	const capabilities = options.capabilities ?? createCapabilities();
	const jobs = [...options.jobs];
	const deletedJobIds: string[] = [];
	let listRequestCount = 0;

	return {
		deletedJobIds,
		get listRequestCount() {
			return listRequestCount;
		},
		fetch: async (input) => {
			const request = input instanceof Request ? input : new Request(input);
			const url = new URL(request.url, 'https://dashboard.test');

			if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
				return createJsonResponse(capabilities);
			}

			if (request.method === 'GET' && url.pathname === '/api/v1/jobs') {
				listRequestCount += 1;

				return createJsonResponse({
					jobs: [...jobs],
					cursor: null,
					hasNextPage: false,
					hasPreviousPage: false,
				});
			}

			if (request.method === 'DELETE' && url.pathname.startsWith('/api/v1/jobs/')) {
				const jobId = url.pathname.split('/').at(-1);

				if (!jobId) {
					return createJsonResponse({ error: 'Job not found' }, 404);
				}

				const jobIndex = jobs.findIndex((job) => job.id === jobId);

				if (jobIndex === -1) {
					return createOrpcErrorResponse('NOT_FOUND', 404, 'Job not found');
				}

				jobs.splice(jobIndex, 1);
				deletedJobIds.push(jobId);
				return createJsonResponse({ deleted: true });
			}

			return createOrpcErrorResponse('NOT_FOUND', 404, 'Route not found');
		},
	};
}

function createJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json',
		},
	});
}

function createOrpcErrorResponse(code: string, status: number, message: string): Response {
	return createJsonResponse(
		{
			code,
			data: {
				error: message,
			},
			defined: false,
			message,
			status,
		},
		status,
	);
}

function createCapabilities(overrides: Partial<CapabilitiesDto> = {}): CapabilitiesDto {
	return {
		readOnly: false,
		actions: {
			read: true,
			cancel: true,
			cancelBulk: true,
			retry: true,
			retryBulk: true,
			reschedule: true,
			delete: true,
			deleteBulk: true,
			...(overrides.actions ?? {}),
		},
		...overrides,
	};
}

function createListJob(overrides: Partial<JobDto> = {}): JobDto {
	return {
		id: 'job-123',
		name: 'send-email',
		status: 'pending',
		payload: {
			recipient: 'person@example.test',
		},
		nextRunAt: '2026-06-03T12:00:00.000Z',
		lockedAt: null,
		claimedBy: null,
		lastHeartbeat: null,
		heartbeatInterval: undefined,
		failCount: 0,
		failureReason: null,
		repeatInterval: undefined,
		uniqueKey: 'send-email:person@example.test',
		createdAt: '2026-06-03T11:45:00.000Z',
		updatedAt: '2026-06-03T11:55:00.000Z',
		...overrides,
	};
}
