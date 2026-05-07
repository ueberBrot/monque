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

async function handleCapabilities(surface: ManagementSurface, context?: ManagementOpenApiContext) {
	const result = await surface.openApiHandler.handle(
		new Request('https://management.example/api/v1/capabilities', { method: 'GET' }),
		context === undefined ? {} : { context },
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

	test('uses adapter-provided request context for action authorization', async () => {
		const authorizedActions = new Set(['read', 'retry']);
		const surface = createManagementSurface<{ role: string }>({
			monque: createManagementMonque(),
			authorize: ({ action, context }) => {
				expect(context).toEqual({ role: 'viewer' });
				return authorizedActions.has(action);
			},
		});

		const response = await handleCapabilities(surface, {
			managementContext: { role: 'viewer' },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			readOnly: false,
			actions: {
				read: true,
				cancel: false,
				retry: true,
				reschedule: false,
				delete: false,
			},
		});
	});
});
