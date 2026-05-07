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
		cancelJob: async () => null,
		retryJob: async () => null,
		rescheduleJob: async () => null,
		deleteJob: async () => false,
		cancelJobs: async () => ({ count: 0, errors: [] }),
		retryJobs: async () => ({ count: 0, errors: [] }),
		deleteJobs: async () => ({ count: 0, errors: [] }),
		...overrides,
	};
}

async function handleCapabilities(surface: ReturnType<typeof createManagementSurface>) {
	const result = await surface.openApiHandler.handle(
		new Request('https://management.example/api/v1/capabilities', { method: 'GET' }),
	);

	if (!result.matched) {
		throw new Error('Expected oRPC OpenAPI handler to match capabilities route');
	}

	return result.response;
}

describe('oRPC Management capabilities route', () => {
	test('reports every Management action available when the scheduler supports them', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque(),
		});

		const response = await handleCapabilities(surface);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			readOnly: false,
			actions: {
				read: true,
				cancel: true,
				retry: true,
				reschedule: true,
				delete: true,
			},
		});
	});
});
