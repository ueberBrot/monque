import { describe, test } from 'vitest';

import {
	createManagementMonque,
	expectJsonResponse,
	handleManagementGet,
} from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management health route', () => {
	test('serves scheduler health through the OpenAPI handler', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({ isHealthy: () => false }),
		});

		const response = await handleManagementGet(surface, '/api/v1/health');

		await expectJsonResponse(response, 200, {
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

		await expectJsonResponse(response, 200, {
			status: 'ok',
			scheduler: {
				healthy: true,
			},
		});
	});
});
