import type { CursorOptions, PersistedJob, QueueStats } from '@monque/core';
import { ObjectId } from 'mongodb';
import { describe, expect, test } from 'vitest';

import { createManagementSurface } from '@/index';
import type { ManagementMonque, ManagementOpenApiContext, ManagementSurface } from '@/surface';

function createManagementMonque(overrides: Partial<ManagementMonque> = {}): ManagementMonque {
	return {
		isHealthy: () => true,
		getQueueViewSummaries: async () => [],
		getJobsWithCursor: async (_options?: CursorOptions) => ({
			jobs: [],
			cursor: null,
			hasNextPage: false,
			hasPreviousPage: false,
		}),
		getJob: async () => null,
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

function createJob(overrides: Partial<PersistedJob> = {}): PersistedJob {
	return {
		_id: new ObjectId(),
		name: 'send-email',
		data: { to: 'person@example.test' },
		status: 'pending',
		nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
		failCount: 0,
		createdAt: new Date('2025-12-31T23:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:01:00.000Z'),
		...overrides,
	};
}

async function handlePost(
	surface: ManagementSurface,
	path: string,
	body?: unknown,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	const init: RequestInit = { method: 'POST' };

	if (body !== undefined) {
		init.headers = { 'content-type': 'application/json' };
		init.body = JSON.stringify(body);
	}

	const result = await surface.openApiHandler.handle(
		new Request(`https://management.example${path}`, init),
		context === undefined ? {} : { context },
	);

	if (!result.matched) {
		throw new Error(`Expected oRPC OpenAPI handler to match ${path}`);
	}

	return result.response;
}

describe('oRPC Management single Job action routes', () => {
	test('cancels one Job through public core API with target authorization', async () => {
		const jobId = new ObjectId();
		const target = createJob({ _id: jobId });
		const cancelled = createJob({
			_id: jobId,
			status: 'cancelled',
			updatedAt: new Date('2026-01-01T00:02:00.000Z'),
		});
		const coreCalls: string[] = [];
		const authorizeCalls: unknown[] = [];
		const surface = createManagementSurface<{ userId: string }>({
			monque: createManagementMonque({
				getJob: async (id) => (id.equals(jobId) ? target : null),
				cancelJob: async (id) => {
					coreCalls.push(id);

					return cancelled;
				},
			}),
			authorize: ({ action, context, job }) => {
				authorizeCalls.push({ action, context, job });
				return true;
			},
		});

		const response = await handlePost(
			surface,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
			undefined,
			{ managementContext: { userId: 'operator-1' } },
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: jobId.toHexString(),
			name: 'send-email',
			status: 'cancelled',
			payload: { to: 'person@example.test' },
			nextRunAt: '2026-01-01T00:00:00.000Z',
			lockedAt: null,
			claimedBy: null,
			lastHeartbeat: null,
			failCount: 0,
			failureReason: null,
			createdAt: '2025-12-31T23:00:00.000Z',
			updatedAt: '2026-01-01T00:02:00.000Z',
		});
		expect(coreCalls).toEqual([jobId.toHexString()]);
		expect(authorizeCalls).toEqual([
			{
				action: 'cancel',
				context: { userId: 'operator-1' },
				job: target,
			},
		]);
	});
});
