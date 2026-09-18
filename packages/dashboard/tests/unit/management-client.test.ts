import { describe, expect, it } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';

describe('createDashboardManagementApi', () => {
	it('preserves the Management error message and HTTP status for action feedback', async () => {
		const managementApi = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard.example',
			fetch: async () =>
				new Response(JSON.stringify({ error: 'Job state changed.' }), {
					status: 409,
					headers: { 'content-type': 'application/json' },
				}),
		});
		await expect(managementApi.client.cancelJob({ params: { id: 'job-1' } })).rejects.toMatchObject(
			{
				code: 'CONFLICT',
				status: 409,
				message: 'Job state changed.',
			},
		);
	});
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
