import { describe, expect, it } from 'vitest';

import { createDashboardManagementApi } from '../../../../packages/dashboard/src/management-client.js';
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
			data: {
				body: {
					error: 'Sign in to inspect the dashboard scenario.',
				},
			},
		});
	});
});
