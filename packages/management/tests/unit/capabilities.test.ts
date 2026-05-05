import { describe, expect, test } from 'vitest';

import { createManagementSurface, HttpMethod, HttpStatus, ManagementRoutePath } from '@/index';
import type { ManagementAction, ManagementMonque } from '@/surface';

describe('Management capabilities', () => {
	test('reflects read-only mode and action-grained authorization outcomes', async () => {
		const authorizedActions = new Set<ManagementAction>(['read', 'retry']);
		const monque: ManagementMonque = {
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
		};
		const surface = createManagementSurface({
			monque,
			readOnly: true,
			authorize: ({ action, context }) => {
				expect(context).toEqual({ role: 'viewer' });
				return authorizedActions.has(action);
			},
		});

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.CAPABILITIES,
			context: { role: 'viewer' },
		});

		expect(response).toEqual({
			status: HttpStatus.OK,
			body: {
				readOnly: true,
				actions: {
					read: true,
					cancel: false,
					retry: false,
					reschedule: false,
					delete: false,
				},
			},
		});
	});

	test('disables unsupported optional mutation actions and routes', async () => {
		const monque: ManagementMonque = {
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
			retryJob: async () => null,
		};
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.CAPABILITIES,
			context: {},
		});
		const unsupported = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOB_CANCEL,
			params: { id: '000000000000000000000000' },
			context: {},
		});

		expect(response).toEqual({
			status: HttpStatus.OK,
			body: {
				readOnly: false,
				actions: {
					read: true,
					cancel: false,
					retry: true,
					reschedule: false,
					delete: false,
				},
			},
		});
		expect(surface.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
			'GET /api/v1/health',
			'GET /api/v1/capabilities',
			'GET /api/v1/queue-views',
			'GET /api/v1/jobs',
			'GET /api/v1/jobs/stats',
			'GET /api/v1/jobs/{id}',
			'POST /api/v1/jobs/{id}/actions/retry',
		]);
		expect(unsupported).toEqual({
			status: HttpStatus.FORBIDDEN,
			body: { error: 'Management action is unsupported' },
		});
	});
});
