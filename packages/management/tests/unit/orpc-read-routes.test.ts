import type { QueueViewSummary } from '@monque/core';
import { describe, expect, test } from 'vitest';

import { createManagementSurface } from '@/index';
import type { ManagementMonque, ManagementOpenApiContext, ManagementSurface } from '@/surface';

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

async function handleGet(
	surface: ManagementSurface,
	path: string,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	const result = await surface.openApiHandler.handle(
		new Request(`https://management.example${path}`, { method: 'GET' }),
		context === undefined ? {} : { context },
	);

	if (!result.matched) {
		throw new Error(`Expected oRPC OpenAPI handler to match ${path}`);
	}

	return result.response;
}

describe('oRPC Management read routes', () => {
	test('lists Queue Views through the public scheduler summary API', async () => {
		const queueViews = [
			{
				name: 'send-email',
				hasPersistedJobs: true,
				hasRegisteredWorker: true,
				stats: {
					pending: 1,
					processing: 2,
					completed: 3,
					failed: 4,
					cancelled: 5,
					total: 15,
					avgProcessingDurationMs: 123,
				},
				worker: {
					concurrency: 10,
					activeCount: 2,
				},
			},
			{
				name: 'historical-report',
				hasPersistedJobs: true,
				hasRegisteredWorker: false,
				stats: {
					pending: 0,
					processing: 0,
					completed: 7,
					failed: 1,
					cancelled: 0,
					total: 8,
				},
				worker: null,
			},
		] satisfies QueueViewSummary[];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getQueueViewSummaries: async () => queueViews,
			}),
		});

		const response = await handleGet(surface, '/api/v1/queue-views');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			queueViews: [
				{
					name: 'send-email',
					hasPersistedJobs: true,
					hasRegisteredWorker: true,
					stats: {
						pending: 1,
						processing: 2,
						completed: 3,
						failed: 4,
						cancelled: 5,
						total: 15,
						avgProcessingDurationMs: 123,
					},
					worker: {
						concurrency: 10,
						activeCount: 2,
					},
				},
				{
					name: 'historical-report',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: {
						pending: 0,
						processing: 0,
						completed: 7,
						failed: 1,
						cancelled: 0,
						total: 8,
					},
					worker: null,
				},
			],
		});
	});
});
