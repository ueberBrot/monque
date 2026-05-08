import { describe, expect, test } from 'vitest';

import { createManagementMonque } from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management health route', () => {
	test('serves scheduler health through the OpenAPI handler', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({ isHealthy: () => false }),
		});

		const result = await surface.openApiHandler.handle(
			new Request('https://management.example/api/v1/health', { method: 'GET' }),
		);

		if (!result.matched) {
			throw new Error('Expected oRPC OpenAPI handler to match health route');
		}

		expect(result.response.status).toBe(200);
		expect(await result.response.json()).toEqual({
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

		const result = await surface.openApiHandler.handle(
			new Request('https://management.example/api/v1/health', { method: 'GET' }),
		);

		if (!result.matched) {
			throw new Error('Expected oRPC OpenAPI handler to match health route');
		}

		expect(result.response.status).toBe(200);
		expect(await result.response.json()).toEqual({
			status: 'ok',
			scheduler: {
				healthy: true,
			},
		});
	});
});
