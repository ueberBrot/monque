import type { JobDto } from '@monque/management/contract';
import { describe, expect, it, vi } from 'vitest';

import { jobActionMutationOptions } from '@/features/jobs/job-action-mutation';
import { runJobActions } from '@/features/jobs/job-actions';
import { createDashboardManagementApi } from '@/management-client';
import { createDashboardQueryClient } from '@/query-client';

describe('runJobActions', () => {
	it('stores the returned job after a single selected job is retried', async () => {
		const job: JobDto = {
			id: '000000000000000000000001',
			name: 'email',
			status: 'pending',
			payload: { recipient: 'person@example.test' },
			nextRunAt: '2026-09-19T12:00:00.000Z',
			createdAt: '2026-09-19T11:00:00.000Z',
			updatedAt: '2026-09-19T12:00:00.000Z',
			lockedAt: null,
			claimedBy: null,
			lastHeartbeat: null,
			failCount: 0,
			failureReason: null,
		};
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch: async () => Response.json(job),
		});
		const client = createDashboardQueryClient();
		const mutation = client.getMutationCache().build(client, jobActionMutationOptions(api, client));
		expect(await mutation.execute({ action: 'retry', jobIds: [job.id] })).toMatchObject({
			count: 1,
			jobs: [job],
		});
		expect(
			client.getQueryData(api.orpc.job.queryKey({ input: { params: { id: job.id } } })),
		).toEqual(job);
		client.clear();
	});

	it('sends selected ids in one request and preserves failure selection order', async () => {
		const ids = [
			'000000000000000000000001',
			'000000000000000000000002',
			'000000000000000000000003',
		];
		const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
			const request = input instanceof Request ? input : new Request(input);
			expect(new URL(request.url).pathname).toBe('/api/v1/jobs/actions/selected');
			expect(await request.json()).toEqual({ action: 'retry', ids });
			return Response.json({
				count: 1,
				errors: [
					{ jobId: ids[2], error: 'Denied', status: 403 },
					{ jobId: ids[1], error: 'Changed', status: 409 },
				],
			});
		});
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch,
		});
		const client = createDashboardQueryClient();
		const capabilities = api.orpc.capabilities.queryOptions();
		const health = api.orpc.health.queryOptions();
		client.getQueryCache().build(client, capabilities);
		client.getQueryCache().build(client, health);
		const mutation = client.getMutationCache().build(client, jobActionMutationOptions(api, client));
		expect(await mutation.execute({ action: 'retry', jobIds: ids })).toMatchObject({
			count: 1,
			failed: [ids[1], ids[2]],
			firstError: { status: 409 },
			authorizationChanged: true,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(client.getQueryState(capabilities.queryKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(health.queryKey)?.isInvalidated).toBe(false);
		client.clear();
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
			jobs: [],
			failed: [],
			firstError: undefined,
			authorizationChanged: false,
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
