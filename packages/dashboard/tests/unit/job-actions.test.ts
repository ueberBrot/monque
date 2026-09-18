import { describe, expect, it, vi } from 'vitest';

import { runJobActions } from '@/features/jobs/job-actions';
import { createDashboardManagementApi } from '@/management-client';

describe('runJobActions', () => {
	it('limits concurrent requests and keeps failures in selection order across batches', async () => {
		const pending: { id: string; resolve: (response: Response) => void }[] = [];
		const fetch = vi.fn<typeof globalThis.fetch>((input) => {
			const request = input instanceof Request ? input : new Request(input);
			const id = new URL(request.url).pathname.split('/').at(-3) ?? '';
			return new Promise((resolve) => pending.push({ id, resolve }));
		});
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch,
		});
		const jobIds = Array.from({ length: 7 }, (_, index) => `job-${index}`);
		const result = runJobActions(api, { action: 'retry', jobIds });

		await vi.waitFor(() => expect(pending).toHaveLength(5));
		expect(fetch).toHaveBeenCalledTimes(5);
		for (const request of pending.splice(0).reverse()) {
			request.resolve(actionResponse(request.id === 'job-1' || request.id === 'job-3'));
		}
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		for (const request of pending.splice(0)) {
			request.resolve(actionResponse(request.id === 'job-6'));
		}

		expect(await result).toMatchObject({
			action: 'retry',
			count: 4,
			failed: ['job-1', 'job-3', 'job-6'],
			firstError: { status: 409 },
		});
		expect(fetch).toHaveBeenCalledTimes(7);
	});

	it('returns an empty result without issuing requests when nothing is selected', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch,
		});
		expect(await runJobActions(api, { action: 'delete', jobIds: [] })).toEqual({
			action: 'delete',
			count: 0,
			failed: [],
			firstError: undefined,
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});

function actionResponse(conflict: boolean): Response {
	return new Response(
		JSON.stringify(
			conflict
				? {
						code: 'CONFLICT',
						status: 409,
						message: 'Job changed',
						defined: false,
						data: { error: 'Job changed' },
					}
				: { retried: true },
		),
		{
			status: conflict ? 409 : 200,
			headers: { 'content-type': 'application/json' },
		},
	);
}
