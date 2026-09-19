import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';

import { createMockManagementFetch } from '../../src/mock/management-server.js';
import * as scenarioCatalog from '../../src/mock/scenario-catalog.js';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

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
	const cancelled = await api.client.job({ params: { id: job.id } });
	await expect(api.client.cancelJob({ params: { id: job.id } })).resolves.toEqual(cancelled);
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

it.each(['single', 'bulk', 'selected'] as const)(
	'resets retry metadata and schedules %s retries from the current time',
	async (mode) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2035-10-01T12:00:00.000Z'));
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch: createMockManagementFetch({ scenarioId: 'failed-jobs' }),
		});
		const job = (await api.client.jobs({ status: 'failed', limit: '1' })).jobs[0];
		if (!job) throw new Error('Expected a failed scenario job');
		if (mode === 'single') await api.client.retryJob({ params: { id: job.id } });
		else if (mode === 'bulk') await api.client.retryJobs({ name: job.name, status: 'failed' });
		else await api.client.selectedJobActions({ action: 'retry', ids: [job.id] });
		const retried = await api.client.job({ params: { id: job.id } });
		expect(retried).toMatchObject({
			status: 'pending',
			failCount: 0,
			failureReason: null,
			claimedBy: null,
			lockedAt: null,
			lastHeartbeat: null,
			updatedAt: '2035-10-01T12:00:00.000Z',
		});
		expect(Date.parse(retried.nextRunAt)).toBeGreaterThanOrEqual(Date.now());
		expect(Date.parse(retried.nextRunAt)).toBeLessThan(Date.now() + 30_000);
		if (mode === 'single') expect(retried.nextRunAt).toBe(retried.updatedAt);
	},
);

it('removes historical-only views after their final job is deleted and preserves registered workers', async () => {
	const api = createDashboardManagementApi({
		apiBaseUrl: '/',
		origin: 'https://dashboard.test',
		fetch: createMockManagementFetch(),
	});
	await api.client.deleteJobs({ name: 'dispatch-webhook' });
	await api.client.deleteJobs({ name: 'send-email' });
	const { queueViews } = await api.client.queueViews();
	expect(queueViews.some((view) => view.name === 'dispatch-webhook')).toBe(false);
	expect(queueViews.find((view) => view.name === 'send-email')).toMatchObject({
		hasRegisteredWorker: true,
		hasPersistedJobs: false,
		stats: { total: 0 },
	});
});

it('applies RequestInit overrides when a Request is passed to the mock fetch adapter', async () => {
	const mockFetch = createMockManagementFetch();
	const response = await mockFetch(
		new Request('https://dashboard.test/api/v1/health', { method: 'POST' }),
		{ method: 'GET' },
	);
	expect(response.status).toBe(200);
});

it.each(['delete', 'cancelBulk', 'retryBulk', 'deleteBulk'] as const)(
	'rejects disabled %s capabilities through the mock HTTP interface',
	async (action) => {
		const scenario = scenarioCatalog.getDashboardDevScenario('failed-jobs');
		if (!scenario) throw new Error('Expected scenario');
		vi.spyOn(scenarioCatalog, 'getDashboardDevScenario').mockReturnValue({
			...scenario,
			capabilities: {
				...scenario.capabilities,
				actions: { ...scenario.capabilities.actions, [action]: false },
			},
		});
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch: createMockManagementFetch(),
		}).client;
		const before = await api.jobs({ limit: '100' });
		const job = before.jobs[0];
		if (!job) throw new Error('Expected job');
		const request =
			action === 'delete'
				? api.deleteJob({ params: { id: job.id } })
				: action === 'cancelBulk'
					? api.cancelJobs({})
					: action === 'retryBulk'
						? api.retryJobs({})
						: api.deleteJobs({});
		await expect(request).rejects.toMatchObject({ status: 403 });
		expect(await api.jobs({ limit: '100' })).toEqual(before);
	},
);

it.each(['single', 'bulk', 'selected'] as const)(
	'clears claim metadata for %s cancellations',
	async (mode) => {
		const scenario = scenarioCatalog.getDashboardDevScenario('pending-jobs');
		if (!scenario) throw new Error('Expected scenario');
		vi.spyOn(scenarioCatalog, 'getDashboardDevScenario').mockReturnValue({
			...scenario,
			jobs: scenario.jobs.map((job) => ({
				...job,
				claimedBy: 'former-worker',
				lockedAt: job.updatedAt,
				lastHeartbeat: job.updatedAt,
			})),
		});
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch: createMockManagementFetch(),
		}).client;
		const job = (await api.jobs({ status: 'pending', limit: '1' })).jobs[0];
		if (!job) throw new Error('Expected pending job');
		if (mode === 'single') await api.cancelJob({ params: { id: job.id } });
		else if (mode === 'bulk') await api.cancelJobs({ name: job.name });
		else await api.selectedJobActions({ action: 'cancel', ids: [job.id] });
		expect(await api.job({ params: { id: job.id } })).toMatchObject({
			status: 'cancelled',
			claimedBy: null,
			lockedAt: null,
			lastHeartbeat: null,
		});
	},
);

it('reports selected failures individually and mutates each existing Job only once', async () => {
	const api = createDashboardManagementApi({
		apiBaseUrl: '/',
		origin: 'https://dashboard.test',
		fetch: createMockManagementFetch(),
	}).client;
	const job = (await api.jobs({ status: 'pending', limit: '1' })).jobs[0];
	if (!job) throw new Error('Expected pending job');
	const result = await api.selectedJobActions({
		action: 'delete',
		ids: [job.id, 'missing-job', job.id],
	});
	expect(result.count).toBe(1);
	expect(result.errors).toEqual([expect.objectContaining({ jobId: 'missing-job', status: 404 })]);
	await expect(api.job({ params: { id: job.id } })).rejects.toMatchObject({ status: 404 });
});

it.each(['delete', 'deleteBulk'] as const)(
	'checks %s permission for selected actions',
	async (deniedAction) => {
		const scenario = scenarioCatalog.getDashboardDevScenario('pending-jobs');
		if (!scenario) throw new Error('Expected scenario');
		vi.spyOn(scenarioCatalog, 'getDashboardDevScenario').mockReturnValue({
			...scenario,
			capabilities: {
				...scenario.capabilities,
				actions: { ...scenario.capabilities.actions, [deniedAction]: false },
			},
		});
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.test',
			fetch: createMockManagementFetch(),
		}).client;
		const job = (await api.jobs({ limit: '1' })).jobs[0];
		if (!job) throw new Error('Expected job');
		const request = api.selectedJobActions({ action: 'delete', ids: [job.id] });
		if (deniedAction === 'deleteBulk') {
			await expect(request).rejects.toMatchObject({ status: 403 });
		} else {
			await expect(request).resolves.toEqual({
				count: 0,
				errors: [expect.objectContaining({ jobId: job.id, status: 403 })],
			});
		}
		expect(await api.job({ params: { id: job.id } })).toEqual(job);
	},
);
