import type {
	BulkOperationResult,
	CursorOptions,
	JobSelector,
	QueueStats,
	QueueViewSummary,
} from '@monque/core';
import { describe, expect, test } from 'vitest';

import { createManagementSurface } from '@/index';
import type { ManagementMonque, ManagementOpenApiContext, ManagementSurface } from '@/surface';

function createManagementMonque(overrides: Partial<ManagementMonque> = {}): ManagementMonque {
	return {
		isHealthy: () => true,
		getQueueViewSummaries: async (): Promise<QueueViewSummary[]> => [],
		getJobsWithCursor: async (_options?: CursorOptions) => ({
			jobs: [],
			cursor: null,
			hasNextPage: false,
			hasPreviousPage: false,
		}),
		getJob: async (_id) => null,
		getQueueStats: async (_filter?: { name?: string }): Promise<QueueStats> => ({
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

async function handlePost(
	surface: ManagementSurface,
	path: string,
	body: unknown,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	const result = await surface.openApiHandler.handle(
		new Request(`https://management.example${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
		context === undefined ? {} : { context },
	);

	if (!result.matched) {
		throw new Error(`Expected oRPC OpenAPI handler to match ${path}`);
	}

	return result.response;
}

describe('oRPC Management bulk action routes', () => {
	test('bulk cancels Jobs through public core API with selector DTOs', async () => {
		const coreCalls: JobSelector[] = [];
		const authorizeCalls: unknown[] = [];
		const surface = createManagementSurface<{ userId: string }>({
			monque: createManagementMonque({
				cancelJobs: async (selector): Promise<BulkOperationResult> => {
					coreCalls.push(selector);

					return {
						count: 2,
						errors: [],
					};
				},
			}),
			authorize: ({ action, context, selector }) => {
				authorizeCalls.push({ action, context, selector });
				return true;
			},
		});

		const response = await handlePost(
			surface,
			'/api/v1/jobs/actions/cancel',
			{
				name: 'send-email',
				status: ['pending'],
				olderThan: '2026-02-01T10:30:00.000Z',
				newerThan: '2026-01-01T00:00:00.000Z',
			},
			{ managementContext: { userId: 'operator-1' } },
		);

		const expectedSelector = {
			name: 'send-email',
			status: ['pending'],
			olderThan: new Date('2026-02-01T10:30:00.000Z'),
			newerThan: new Date('2026-01-01T00:00:00.000Z'),
		};
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			count: 2,
			errors: [],
		});
		expect(coreCalls).toEqual([expectedSelector]);
		expect(authorizeCalls).toEqual([
			{
				action: 'cancel',
				context: { userId: 'operator-1' },
				selector: expectedSelector,
			},
		]);
	});
});
