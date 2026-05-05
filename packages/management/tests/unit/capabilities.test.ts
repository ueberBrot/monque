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
});
