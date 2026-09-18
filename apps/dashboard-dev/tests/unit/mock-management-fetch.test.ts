import { describe, expect, it } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';

import { createMockManagementFetch } from '../../src/mock/management-server.js';

describe('createMockManagementFetch', () => {
	it('returns seeded pending-job scenario data through the dashboard oRPC client path', async () => {
		const managementApi = createDashboardManagementApi({
			apiBaseUrl: '/',
			fetch: createMockManagementFetch({ scenarioId: 'pending-jobs' }),
			origin: 'https://dashboard-dev.example',
		});

		const queueViews = await managementApi.client.queueViews();

		expect(queueViews.queueViews.length).toBeGreaterThan(0);
		expect(queueViews.queueViews[0]?.stats.pending).toBeGreaterThan(0);
	});

	it('returns typed unauthorized errors for the unauthorized scenario', async () => {
		const managementApi = createDashboardManagementApi({
			apiBaseUrl: '/',
			fetch: createMockManagementFetch({ scenarioId: 'unauthorized' }),
			origin: 'https://dashboard-dev.example',
		});

		await expect(managementApi.client.queueViews()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
			status: 401,
			message: 'Sign in to inspect the dashboard scenario.',
			data: { error: 'Sign in to inspect the dashboard scenario.' },
		});
	});
});

it('persists mutations and statistics while keeping separate handlers isolated', async () => {
	const api = createDashboardManagementApi({
		apiBaseUrl: '/',
		origin: 'https://dashboard.test',
		fetch: createMockManagementFetch(),
	});
	const other = createDashboardManagementApi({
		apiBaseUrl: '/',
		origin: 'https://dashboard.test',
		fetch: createMockManagementFetch(),
	});
	const page = await api.client.jobs({ status: 'pending', limit: '1' });
	const job = page.jobs[0];
	if (!job) throw new Error('Expected a seeded pending job');
	const before = await api.client.jobStats({ name: job.name });
	await api.client.cancelJob({ params: { id: job.id } });
	expect((await api.client.job({ params: { id: job.id } })).status).toBe('cancelled');
	expect((await api.client.jobStats({ name: job.name })).pending).toBe(before.pending - 1);
	expect((await other.client.job({ params: { id: job.id } })).status).toBe('pending');
	await expect(api.client.cancelJob({ params: { id: job.id } })).rejects.toMatchObject({
		status: 409,
	});
	await api.client.retryJob({ params: { id: job.id } });
	await api.client.rescheduleJob({ params: { id: job.id }, body: { nextRunAt: job.nextRunAt } });
	await api.client.deleteJob({ params: { id: job.id } });
	await expect(api.client.job({ params: { id: job.id } })).rejects.toMatchObject({ status: 404 });
});

it('rejects writes to a read-only mock API', async () => {
	const api = createDashboardManagementApi({
		apiBaseUrl: '/',
		origin: 'https://dashboard.test',
		fetch: createMockManagementFetch({ scenarioId: 'read-only' }),
	});
	const job = (await api.client.jobs({ limit: '1' })).jobs[0];
	if (!job) throw new Error('Expected a seeded job');
	await expect(api.client.deleteJob({ params: { id: job.id } })).rejects.toMatchObject({
		status: 403,
	});
});
