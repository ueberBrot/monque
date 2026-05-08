import { describe, expect, test } from 'vitest';

import { createManagementMonque, handleManagementGet } from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management health route', () => {
	test('serves scheduler health through the OpenAPI handler', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({ isHealthy: () => false }),
		});

		const response = await handleManagementGet(surface, '/api/v1/health');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: 'unavailable',
			scheduler: {
				healthy: false,
			},
		});
	});

	test('serves scheduler health without read authorization', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({ isHealthy: () => true }),
			authorize: () => false,
		});

		const response = await handleManagementGet(surface, '/api/v1/health');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: 'ok',
			scheduler: {
				healthy: true,
			},
		});
	});
});
