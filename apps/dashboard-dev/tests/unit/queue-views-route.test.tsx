// @vitest-environment jsdom

import { createMockManagementFetch } from '@dashboard-dev/mock/management-server';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createDashboardHarness } from '../setup/dashboard-harness.js';

describe('Queue Views routes', () => {
	it('renders Queue Views from the Management API on the overview route', async () => {
		renderDashboardAt('/queue-views');

		expect(await screen.findByRole('heading', { name: 'Queue Views' })).toBeTruthy();
		expect(
			await screen.findByText('Jobs grouped by name. Open a view to investigate.'),
		).toBeTruthy();
		expect(screen.getByText('dispatch-webhook')).toBeTruthy();
		expect(screen.getByText('send-email')).toBeTruthy();
	});

	it('navigates from the overview route into Queue View detail by job name', async () => {
		renderDashboardAt('/queue-views');

		fireEvent.click(await screen.findByText('send-email'));

		expect(await screen.findByRole('heading', { name: 'Filtered jobs' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 1, name: 'send-email' })).toBeTruthy();
		expect(screen.queryByLabelText(/job name/i)).toBeNull();
	});

	it('loads queue detail with summary jobs and a single statistics source', async () => {
		const calls: string[] = [];
		const mockFetch = createMockManagementFetch({ scenarioId: 'pending-jobs' });
		renderDashboardAt('/queue-views/send-email', {
			fetch: async (input, init) => {
				calls.push(input instanceof Request ? input.url : String(input));
				return mockFetch(input, init);
			},
		});
		expect(await screen.findByRole('heading', { name: 'Filtered jobs' })).toBeTruthy();
		expect(calls.some((url) => url.includes('/jobs/stats'))).toBe(false);
		expect(calls.some((url) => new URL(url).searchParams.get('view') === 'summary')).toBe(true);
		expect(calls.filter((url) => new URL(url).pathname === '/api/v1/queue-views')).toEqual([
			'https://dashboard.test/api/v1/queue-views?name=send-email',
		]);
	});

	it('offers another queue page only while more jobs exist', async () => {
		renderDashboardAt('/queue-views/send-email?limit=4');

		fireEvent.click(await screen.findByRole('link', { name: 'Next page' }));

		expect(await screen.findByRole('link', { name: 'Back to first page' })).toBeTruthy();
		expect(screen.getByText('4 jobs on this page')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull();
	});

	it('stops automatic requests after authorization is denied', async () => {
		let requests = 0;
		renderDashboardAt('/queue-views', {
			pollingIntervalMs: 25,
			fetch: async () => {
				requests++;
				return Response.json({ error: 'Sign in' }, { status: 401 });
			},
		});
		await screen.findByRole('heading', { name: 'Authentication required' });
		await pause(180);
		expect(requests).toBe(1);
	});

	it.each(['/queue-views', '/queue-views/send-email'])(
		'distinguishes forbidden access and recovers without navigation on %s',
		async (path) => {
			let denied = true;
			const mockFetch = createMockManagementFetch({ scenarioId: 'pending-jobs' });
			renderDashboardAt(path, {
				fetch: (input, init) =>
					denied
						? Promise.resolve(Response.json({ error: 'Host permission denied.' }, { status: 403 }))
						: mockFetch(input, init),
			});
			expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeTruthy();
			expect(screen.getByRole('alert').textContent).toContain('Host permission denied.');
			denied = false;
			fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
			expect(
				await screen.findByRole('heading', {
					name: path === '/queue-views' ? 'Queue Views' : 'Filtered jobs',
				}),
			).toBeTruthy();
			expect(window.location.pathname).toBe(path);
		},
	);

	it('polls while visible and pauses polling while the document is hidden', async () => {
		const calls: string[] = [];
		const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url =
				typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			calls.push(url);
			return createMockManagementFetch({ scenarioId: 'pending-jobs' })(input, init);
		};

		renderDashboardAt('/queue-views', { fetch, pollingIntervalMs: 25 });
		await waitFor(() => {
			expect(calls.length).toBeGreaterThan(0);
		});

		await waitFor(() => {
			expect(calls.length).toBeGreaterThan(1);
		});

		const hiddenCount = calls.length;
		setDocumentVisibilityState('hidden');
		await waitFor(async () => {
			await pause(80);
			expect(calls.length).toBe(hiddenCount);
		});

		setDocumentVisibilityState('visible');
		await waitFor(() => {
			expect(calls.length).toBeGreaterThan(hiddenCount);
		});
	}, 10_000);
});

afterEach(() => {
	cleanup();
	setDocumentVisibilityState('visible');
});

function renderDashboardAt(
	pathname: string,
	options?: {
		readonly fetch?: typeof fetch;
		readonly pollingIntervalMs?: number;
		readonly scenarioId?: 'pending-jobs' | 'unauthorized';
	},
): void {
	createDashboardHarness(pathname, {
		...options,
		pollingIntervalMs: options?.pollingIntervalMs ?? 15_000,
	}).render();
}

function setDocumentVisibilityState(state: 'hidden' | 'visible'): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		value: state,
	});
	document.dispatchEvent(new Event('visibilitychange'));
}

function pause(durationMs: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, durationMs);
	});
}
