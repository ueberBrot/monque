// @vitest-environment jsdom

import { createMockManagementFetch } from '@dashboard-dev/mock/management-server';
import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseJobsRouteSearch } from '@/features/jobs/job-list-search';

import { createDashboardHarness } from '../setup/dashboard-harness.js';

describe('Jobs route', () => {
	afterEach(() => {
		cleanup();
	});

	it('sorts on mobile and unmounts columns hidden by responsive breakpoints', async () => {
		const mediaDefaults = window.matchMedia('');
		const listeners = new Set<() => void>();
		let compact = true;
		const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
			...mediaDefaults,
			media: query,
			matches: compact,
			addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
				if (typeof listener === 'function') listeners.add(() => listener(new Event('change')));
			},
			removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
				void listener;
			},
		}));
		try {
			const fetchSpy = vi.fn(createMockManagementFetch({ scenarioId: 'large-dataset' }));
			const { router } = await renderJobsRoute({ fetch: fetchSpy, initialEntry: '/jobs' });
			await screen.findAllByRole('link', { name: /dispatch-webhook/ });
			expect(screen.getByRole('combobox', { name: 'Sort by' }).textContent).toContain(
				'Created time',
			);
			expect(screen.getByRole('combobox', { name: 'Sort direction' }).textContent).toContain(
				'Descending',
			);
			expect(screen.getByRole('combobox', { name: 'Page size' }).textContent).toContain('50 rows');
			expect(
				screen.queryByRole('columnheader', {
					name: /Created time|Updated time|Next run|Identifier/,
				}),
			).toBeNull();
			expect(document.querySelectorAll('tbody time')).toHaveLength(0);
			fireEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
			const sortOption = await screen.findByRole('option', { name: 'Updated time' });
			fireEvent.pointerDown(sortOption, { pointerType: 'mouse' });
			fireEvent.click(sortOption);
			await waitFor(() => expect(router.state.location.search.sortBy).toBe('updatedAt'));
			expect(screen.getByRole('combobox', { name: 'Sort by' }).textContent).toContain(
				'Updated time',
			);
			fireEvent.click(screen.getByRole('combobox', { name: 'Sort direction' }));
			const directionOption = await screen.findByRole('option', { name: 'Ascending' });
			fireEvent.pointerDown(directionOption, { pointerType: 'mouse' });
			fireEvent.click(directionOption);
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					sortBy: 'updatedAt',
					sortDirection: 'asc',
				}),
			);
			expect(screen.getByRole('combobox', { name: 'Sort direction' }).textContent).toContain(
				'Ascending',
			);
			await waitFor(() =>
				expect(
					fetchSpy.mock.calls.some(([input]) => {
						const url = new URL(input instanceof Request ? input.url : String(input));
						return (
							url.searchParams.get('sortBy') === 'updatedAt' &&
							url.searchParams.get('sortDirection') === 'asc'
						);
					}),
				).toBe(true),
			);
			await act(async () => {
				await router.navigate({
					to: '/jobs',
					search: (current) => ({ ...parseJobsRouteSearch(current), sortDirection: 'desc' }),
				});
			});
			await act(async () => router.history.back());
			await waitFor(() =>
				expect(screen.getByRole('combobox', { name: 'Sort direction' }).textContent).toContain(
					'Ascending',
				),
			);
			act(() => {
				compact = false;
				for (const listener of listeners) listener();
			});
			expect(screen.getByRole('columnheader', { name: 'Created time' })).toBeTruthy();
			expect(document.querySelectorAll('tbody time').length).toBeGreaterThan(0);
		} finally {
			media.mockRestore();
		}
	});

	it('restores URL-backed filters and sorting into the Jobs table query', async () => {
		const fetchSpy = vi.fn(createMockManagementFetch({ scenarioId: 'large-dataset' }));

		await renderJobsRoute({
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

	it.each(['/jobs', '/jobs/job-123'])(
		'refreshes granted permissions without leaving %s',
		async (initialEntry) => {
			const job = createListJob();
			const state = createJobsActionFetch({ jobs: [job] });
			let capabilitiesRequests = 0;
			const fetch: typeof globalThis.fetch = async (input, init) => {
				const request = new Request(input, init);
				const path = new URL(request.url).pathname;
				if (path === '/api/v1/capabilities') {
					capabilitiesRequests++;
					const capabilities = createCapabilities();
					return Response.json({
						...capabilities,
						actions: { ...capabilities.actions, cancel: capabilitiesRequests > 1 },
					});
				}
				if (path === `/api/v1/jobs/${job.id}`) return Response.json(job);
				return state.fetch(request);
			};
			await renderJobsRoute({ fetch, initialEntry, pollingIntervalMs: 100 });
			const isList = initialEntry === '/jobs';
			if (isList) {
				fireEvent.click(await screen.findByRole('button', { name: `Actions for ${job.id}` }));
			}
			const action = await screen.findByRole(isList ? 'menuitem' : 'button', {
				name: isList ? 'Cancel job' : 'Cancel',
			});
			expect(
				action.hasAttribute('disabled') || action.getAttribute('aria-disabled') === 'true',
			).toBe(true);
			await waitFor(
				() => {
					expect(capabilitiesRequests).toBeGreaterThan(1);
					expect(
						action.hasAttribute('disabled') || action.getAttribute('aria-disabled') === 'true',
					).toBe(false);
				},
				{ timeout: 2_000 },
			);
		},
	);

	it('disables cached detail actions when the permission refresh is denied', async () => {
		const job = createListJob();
		let capabilitiesRequests = 0;
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			if (new URL(request.url).pathname === '/api/v1/capabilities') {
				capabilitiesRequests++;
				return capabilitiesRequests === 1
					? Response.json(createCapabilities())
					: Response.json({ error: 'Access revoked' }, { status: 403 });
			}
			return Response.json(job);
		};
		await renderJobsRoute({ fetch, initialEntry: `/jobs/${job.id}`, pollingIntervalMs: 100 });
		const action = await screen.findByRole('button', { name: 'Cancel' });
		await waitFor(() => expect(action.hasAttribute('disabled')).toBe(false));
		await waitFor(
			() => {
				expect(capabilitiesRequests).toBe(2);
				expect(action.hasAttribute('disabled')).toBe(true);
			},
			{ timeout: 2_000 },
		);
	});

	it('refreshes permissions manually when automatic polling is disabled', async () => {
		const capabilities = createCapabilities();
		capabilities.actions.cancel = false;
		const job = createListJob();
		const state = createJobsActionFetch({ jobs: [job], capabilities });
		await renderJobsRoute({ fetch: state.fetch, initialEntry: '/jobs' });
		await screen.findByRole('button', { name: `Actions for ${job.id}` });
		capabilities.actions.cancel = true;
		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
		await waitFor(() => expect(state.listRequestCount).toBe(2));
		fireEvent.click(screen.getByRole('button', { name: `Actions for ${job.id}` }));
		await waitFor(() =>
			expect(
				screen.getByRole('menuitem', { name: 'Cancel job' }).getAttribute('aria-disabled'),
			).not.toBe('true'),
		);
	});

	it('debounces name requests while immediately showing the typed value', async () => {
		const fetchSpy = vi.fn(createMockManagementFetch({ scenarioId: 'large-dataset' }));
		await renderJobsRoute({ fetch: fetchSpy, initialEntry: '/jobs' });
		const input = await screen.findByLabelText('Job name');
		fetchSpy.mockClear();
		for (const value of ['s', 'send', 'send-email']) {
			await act(async () => {
				fireEvent.change(input, { target: { value } });
				await new Promise((resolve) => setTimeout(resolve, 40));
			});
		}
		expect((input as HTMLInputElement).value).toBe('send-email');
		await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
		const names = fetchSpy.mock.calls.map(([request]) =>
			new URL(request instanceof Request ? request.url : String(request)).searchParams.get('name'),
		);
		expect(names).toEqual(['send-email']);
	});

	it('keeps the pending name when another filter triggers a loading state', async () => {
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs',
		});
		const input = await screen.findByLabelText('Job name');
		fireEvent.change(input, { target: { value: 'send-email' } });
		fireEvent.click(screen.getByRole('checkbox', { name: 'Pending' }));
		await waitFor(() => expect(router.state.location.search.name).toBe('send-email'));
		expect(router.state.location.search.status).toEqual(['pending']);
	});

	it('preserves spaces while typing a name into the URL-backed input', async () => {
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs',
		});
		const input = (await screen.findByLabelText('Job name')) as HTMLInputElement;
		for (const character of 'send email') {
			const value = input.value + character;
			fireEvent.change(input, { target: { value } });
			await waitFor(() => expect(router.state.location.search.name).toBe(value));
		}
		expect(input.value).toBe('send email');
	});

	it.each(['toolbar', 'navigation'])('clears a pending name through %s', async (source) => {
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs',
		});
		fireEvent.change(await screen.findByLabelText('Job name'), {
			target: { value: 'send-email' },
		});
		await waitFor(() => expect(router.state.location.search.name).toBe('send-email'));
		if (source === 'toolbar') {
			fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		} else {
			await act(() => router.navigate({ to: '/jobs', search: parseJobsRouteSearch({}) }));
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 350));
		});
		expect(router.state.location.search.name).toBeUndefined();
		expect((screen.getByLabelText('Job name') as HTMLInputElement).value).toBe('');
	});

	it('does not restore a stale draft after navigating away and back to the original filter', async () => {
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs',
		});
		const input = await screen.findByLabelText('Job name');
		fireEvent.change(input, { target: { value: 'unfinished' } });
		await act(() =>
			router.navigate({ to: '/jobs', search: parseJobsRouteSearch({ name: 'send-email' }) }),
		);
		await waitFor(() =>
			expect((screen.getByLabelText('Job name') as HTMLInputElement).value).toBe('send-email'),
		);
		await act(() => router.navigate({ to: '/jobs', search: parseJobsRouteSearch({}) }));
		await waitFor(() =>
			expect((screen.getByLabelText('Job name') as HTMLInputElement).value).toBe(''),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 350));
		});
		expect(router.state.location.search.name).toBeUndefined();
	});

	it('navigates with cursor pagination and keeps selection out of URL state', async () => {
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs?limit=10',
		});

		const matchingCells = await screen.findAllByRole('cell', { name: /scenario-46003-/i });
		expect(matchingCells.length).toBeGreaterThan(0);

		fireEvent.click(getFirstElement(screen.getAllByRole('checkbox', { name: /^Select job row / })));
		expect(router.state.location.search).not.toHaveProperty('selected');

		const nextPageButtons = screen.getAllByRole('link', { name: 'Next page' });
		const nextPageButton = nextPageButtons.find(
			(link) => link.getAttribute('aria-disabled') !== 'true',
		);

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
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'pending-jobs' }),
			initialEntry: '/jobs?limit=10',
		});

		await screen.findAllByRole('checkbox', { name: /^Select job row / });

		fireEvent.click(getFirstElement(screen.getAllByRole('checkbox', { name: /^Select job row / })));
		expect(router.state.location.search).not.toHaveProperty('selected');

		await waitFor(() => {
			expect(screen.getByText('1 rows selected on this page')).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

		await waitFor(() => {
			expect(screen.getByText('1 rows selected on this page')).toBeTruthy();
		});
	});

	it('clears page selection and cursor history when URL filters change', async () => {
		const { router } = await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
			initialEntry: '/jobs?limit=10',
		});
		await screen.findAllByRole('checkbox', { name: /^Select job row / });
		await act(async () => {
			fireEvent.click(screen.getByRole('link', { name: 'Next page' }));
		});
		await waitFor(() => {
			expect(router.state.location.search.cursor).toEqual(expect.any(String));
			expect(
				screen.getByRole('link', { name: 'Previous page' }).getAttribute('aria-disabled') ===
					'true',
			).toBe(false);
		});
		fireEvent.click(
			getFirstElement(await screen.findAllByRole('checkbox', { name: /^Select job row / })),
		);
		await screen.findByText('1 rows selected on this page');
		await router.navigate({
			to: '/jobs',
			search: parseJobsRouteSearch({ name: 'send-email', limit: 10 }),
		});
		await waitFor(() => {
			expect(
				screen.getByRole('link', { name: 'Previous page' }).getAttribute('aria-disabled') ===
					'true',
			).toBe(true);
			expect(screen.getByText('No rows selected')).toBeTruthy();
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('link', { name: 'Next page' }));
		});
		await waitFor(() => {
			expect(
				screen.getByRole('link', { name: 'Previous page' }).getAttribute('aria-disabled') ===
					'true',
			).toBe(false);
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('link', { name: 'Previous page' }));
		});
		await waitFor(() => {
			expect(router.state.location.search.cursor).toBeUndefined();
			expect(router.state.location.search.name).toBe('send-email');
		});
	});

	it('renders an empty state when no jobs match the current view', async () => {
		await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'empty-state' }),
			initialEntry: '/jobs',
		});

		expect(await screen.findByText('No jobs found')).toBeTruthy();
	});

	it('keeps Previous page aligned with browser Back and offers First page after a reload', async () => {
		const fetch = createMockManagementFetch({ scenarioId: 'large-dataset' });
		const { router } = await renderJobsRoute({ fetch, initialEntry: '/jobs?limit=10' });
		await screen.findAllByRole('checkbox', { name: /^Select job row / });
		await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Next page' })));
		await waitFor(() => expect(router.state.location.search.cursor).toEqual(expect.any(String)));
		const secondPageCursor = router.state.location.search.cursor;
		await screen.findAllByRole('checkbox', { name: /^Select job row / });
		await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Next page' })));
		await waitFor(() => expect(router.state.location.search.cursor).not.toBe(secondPageCursor));
		await act(async () => router.history.back());
		await waitFor(() => expect(router.state.location.search.cursor).toBe(secondPageCursor));
		const previousPage = await screen.findByRole('link', { name: 'Previous page' });
		await act(async () => fireEvent.click(previousPage));
		await waitFor(() => expect(router.state.location.search.cursor).toBeUndefined());

		cleanup();
		const reloaded = await renderJobsRoute({
			fetch,
			initialEntry: `/jobs?limit=10&cursor=${encodeURIComponent(String(secondPageCursor))}`,
		});
		const firstPage = await screen.findByRole('link', { name: 'First page' });
		await act(async () => fireEvent.click(firstPage));
		await waitFor(() => expect(reloaded.router.state.location.search.cursor).toBeUndefined());
	});

	it('renders an unauthorized state when the API returns 401', async () => {
		await renderJobsRoute({
			fetch: createMockManagementFetch({ scenarioId: 'unauthorized' }),
			initialEntry: '/jobs',
		});

		expect(await screen.findByText('Sign in required')).toBeTruthy();
	});

	it('renders a forbidden state when the API returns 403', async () => {
		cleanup();

		await renderJobsRoute({
			fetch: createForbiddenFetch(),
			initialEntry: '/jobs',
		});

		expect(await screen.findByText('Access denied')).toBeTruthy();
	});

	it('disables row actions until an outstanding mutation and its refresh finish', async () => {
		const job = createListJob();
		const otherJob = createListJob({ id: 'other-job', name: 'other-job' });
		const state = createJobsActionFetch({ jobs: [job, otherJob] });
		const response = Promise.withResolvers<Response>();
		const refresh = Promise.withResolvers<Response>();
		let listRequests = 0;
		const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
			const request = new Request(input, init);
			if (request.method === 'POST') return response.promise;
			if (new URL(request.url).pathname === '/api/v1/jobs' && ++listRequests > 1)
				return refresh.promise;
			return state.fetch(request);
		});
		await renderJobsRoute({ fetch, initialEntry: '/jobs' });
		const actionButton = () => screen.getByRole('button', { name: `Actions for ${job.id}` });
		fireEvent.click(
			await screen.findByRole('checkbox', { name: 'Select job row other-job other-job' }),
		);
		fireEvent.click(await screen.findByRole('button', { name: `Actions for ${job.id}` }));
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Cancel job' }));
		await waitFor(() =>
			expect(
				fetch.mock.calls.some(([input]) => input instanceof Request && input.method === 'POST'),
			).toBe(true),
		);
		try {
			expect(actionButton().hasAttribute('disabled')).toBe(true);
			await act(async () => response.resolve(createJsonResponse({ cancelled: true })));
			await waitFor(() => expect(listRequests).toBe(2));
			expect(actionButton().hasAttribute('disabled')).toBe(true);
		} finally {
			await act(async () => {
				response.resolve(createJsonResponse({ cancelled: true }));
				refresh.resolve(
					createJsonResponse({
						jobs: [{ ...job, status: 'cancelled' }, otherJob],
						cursor: null,
						hasNextPage: false,
						hasPreviousPage: false,
					}),
				);
			});
		}
		await waitFor(() => expect(actionButton().hasAttribute('disabled')).toBe(false));
		expect(
			screen
				.getByRole('checkbox', { name: 'Select job row other-job other-job' })
				.getAttribute('aria-checked'),
		).toBe('true');
		fireEvent.click(actionButton());
		expect(
			(await screen.findByRole('menuitem', { name: 'Cancel job' })).getAttribute('aria-disabled'),
		).toBe('true');
	});

	it.each(['filters', 'cursor'] as const)(
		'dismisses bulk confirmation when browser Back changes %s',
		async (change) => {
			const { router } = await renderJobsRoute({
				fetch: createMockManagementFetch({ scenarioId: 'large-dataset' }),
				initialEntry: '/jobs?limit=10',
			});
			await screen.findByRole('heading', { name: 'Jobs' });
			if (change === 'cursor') {
				const firstRow = getFirstElement(
					await screen.findAllByRole('checkbox', { name: /^Select job row / }),
				).getAttribute('aria-label');
				fireEvent.click(await screen.findByRole('link', { name: 'Next page' }));
				await waitFor(() =>
					expect(router.state.location.search.cursor).toEqual(expect.any(String)),
				);
				await waitFor(() =>
					expect(
						getFirstElement(
							screen.getAllByRole('checkbox', { name: /^Select job row / }),
						).getAttribute('aria-label'),
					).not.toBe(firstRow),
				);
			} else {
				await act(async () =>
					router.navigate({
						to: '/jobs',
						search: parseJobsRouteSearch({ limit: 10, status: ['pending'] }),
					}),
				);
			}
			fireEvent.click(
				getFirstElement(await screen.findAllByRole('checkbox', { name: /^Select job row / })),
			);
			const deleteButton = screen.getByRole('button', { name: 'Delete selected jobs' });
			await waitFor(() => expect(deleteButton.hasAttribute('disabled')).toBe(false));
			fireEvent.click(deleteButton);
			expect(await screen.findByRole('dialog')).toBeTruthy();
			await act(async () => router.history.back());
			await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		},
	);

	it('preserves an open action confirmation when the Jobs list polls', async () => {
		const job = createListJob();
		const fetchState = createJobsActionFetch({ jobs: [job] });
		await renderJobsRoute({
			fetch: fetchState.fetch,
			initialEntry: '/jobs',
			pollingIntervalMs: 100,
		});
		fireEvent.click(
			getFirstElement(await screen.findAllByRole('checkbox', { name: /^Select job row / })),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Delete selected jobs' }));
		expect(await screen.findByRole('dialog')).toBeTruthy();
		const reads = fetchState.listRequestCount;
		await waitFor(() => expect(fetchState.listRequestCount).toBeGreaterThan(reads));
		expect(screen.getByRole('button', { name: 'Confirm delete selected jobs' })).toBeTruthy();
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

		await renderJobsRoute({
			fetch: fetchState.fetch,
			initialEntry: '/jobs',
		});

		expect((await screen.findAllByText(jobA.id)).length).toBeGreaterThan(0);
		expect(screen.getAllByText(jobB.id).length).toBeGreaterThan(0);

		fireEvent.click(getFirstElement(screen.getAllByRole('checkbox', { name: /^Select job row / })));
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

async function renderJobsRoute({
	fetch: fetchImplementation,
	initialEntry,
	pollingIntervalMs,
}: {
	readonly fetch: typeof globalThis.fetch;
	readonly initialEntry: string;
	readonly pollingIntervalMs?: number;
}) {
	const dashboard = createDashboardHarness(initialEntry, {
		fetch: fetchImplementation,
		history: 'memory',
		...(pollingIntervalMs === undefined ? {} : { pollingIntervalMs }),
	});
	await dashboard.router.load();
	dashboard.render();
	return { router: dashboard.router };
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
