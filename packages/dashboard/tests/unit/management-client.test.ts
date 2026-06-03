import { describe, expect, it } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';

describe('createDashboardManagementApi', () => {
	it('includes browser credentials by default on Management API requests', async () => {
		let capturedCredentials: RequestCredentials | undefined;

		const managementApi = createDashboardManagementApi({
			apiBaseUrl: '/api/management',
			fetch: async (_request, init) => {
				capturedCredentials = init?.credentials;

				return new Response(JSON.stringify({ status: 'ok', scheduler: { healthy: true } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			origin: 'https://dashboard.example',
		});

		await managementApi.client.health();

		expect(capturedCredentials).toBe('include');
	});
});
