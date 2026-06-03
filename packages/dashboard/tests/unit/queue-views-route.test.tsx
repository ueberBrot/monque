// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { createDashboardManagementApi } from '@/management-client';
import { createDashboardQueryClient } from '@/query-client';
import { getRouter } from '@/router';

import { createMockManagementFetch } from '../../../../apps/dashboard-dev/src/mock/management-server.js';

describe('Queue Views routes', () => {
	it('renders Queue Views from the Management API on the overview route', async () => {
		renderDashboardAt('/queue-views');

		expect(await screen.findByRole('heading', { name: 'Queue Views' })).toBeTruthy();
		expect(
			await screen.findByText(
				'Start from job-name groupings, then drill into one queue family for its live summary and filtered jobs.',
			),
		).toBeTruthy();
		expect(screen.getByText('dispatch-webhook')).toBeTruthy();
		expect(screen.getByText('send-email')).toBeTruthy();
	});

	it('navigates from the overview route into Queue View detail by job name', async () => {
		renderDashboardAt('/queue-views');

		fireEvent.click(await screen.findByText('send-email'));

		expect(await screen.findByRole('heading', { name: 'send-email' })).toBeTruthy();
		expect(screen.queryByLabelText(/job name/i)).toBeNull();
	});

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
	window.scrollTo = () => undefined;
	window.history.replaceState({}, '', pathname);

	const managementApi = createDashboardManagementApi({
		apiBaseUrl: '/',
		fetch:
			options?.fetch ??
			createMockManagementFetch({ scenarioId: options?.scenarioId ?? 'pending-jobs' }),
		origin: 'https://dashboard.test',
	});
	const queryClient = createDashboardQueryClient();
	const router = getRouter({
		managementApi,
		queryClient,
		runtimeConfig: {
			apiBaseUrl: '/',
			basePath: '/',
			pollingIntervalMs: options?.pollingIntervalMs ?? 15_000,
		},
	});

	render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
			</TooltipProvider>
		</QueryClientProvider>,
	);
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
