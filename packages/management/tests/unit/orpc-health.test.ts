import { describe, expect, test } from 'vitest';

import { createManagementSurface } from '@/index';
import type { ManagementMonque } from '@/surface';

function createManagementMonque(overrides: Partial<ManagementMonque> = {}): ManagementMonque {
	return {
		isHealthy: () => true,
		getQueueViewSummaries: async () => [],
		getJobsWithCursor: async () => ({
			jobs: [],
			cursor: null,
			hasNextPage: false,
			hasPreviousPage: false,
		}),
		getJob: async () => null,
		getQueueStats: async () => ({
			pending: 0,
			processing: 0,
			completed: 0,
			failed: 0,
			cancelled: 0,
			total: 0,
		}),
		...overrides,
	};
}

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
});
