import type { CursorOptions, PersistedJob, QueueStats, QueueViewSummary } from '@monque/core';
import { ObjectId } from 'mongodb';
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
	test('lists Job DTOs through cursor pagination with repeated status filters', async () => {
		const jobId = new ObjectId();
		let capturedOptions: CursorOptions | undefined;
		const job = {
			_id: jobId,
			name: 'send-email',
			data: { to: 'person@example.test', token: 'secret' },
			status: 'failed',
			nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
			lockedAt: null,
			claimedBy: null,
			lastHeartbeat: null,
			failCount: 2,
			failReason: 'SMTP rejected',
			createdAt: new Date('2025-12-31T23:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:01:00.000Z'),
		} satisfies PersistedJob;
		const surface = createManagementSurface<{ userId: string }>({
			monque: createManagementMonque({
				getJobsWithCursor: async (options) => {
					capturedOptions = options;

					return {
						jobs: [job],
						cursor: 'next-cursor',
						hasNextPage: true,
						hasPreviousPage: false,
					};
				},
			}),
			serializePayload: ({ context, job: serializedJob }) =>
				Promise.resolve({
					visibleTo: context.userId,
					jobName: serializedJob.name,
				}),
		});

		const response = await handleGet(
			surface,
			'/api/v1/jobs?cursor=current-cursor&limit=250&name=send-email&status=pending&status=failed',
			{ managementContext: { userId: 'operator-1' } },
		);

		expect(response.status).toBe(200);
		expect(capturedOptions).toEqual({
			cursor: 'current-cursor',
			limit: 100,
			filter: {
				name: 'send-email',
				status: ['pending', 'failed'],
			},
		});
		expect(await response.json()).toEqual({
			jobs: [
				{
					id: jobId.toHexString(),
					name: 'send-email',
					status: 'failed',
					payload: {
						visibleTo: 'operator-1',
						jobName: 'send-email',
					},
					nextRunAt: '2026-01-01T00:00:00.000Z',
					lockedAt: null,
					claimedBy: null,
					lastHeartbeat: null,
					failCount: 2,
					failureReason: 'SMTP rejected',
					createdAt: '2025-12-31T23:00:00.000Z',
					updatedAt: '2026-01-01T00:01:00.000Z',
				},
			],
			cursor: 'next-cursor',
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	test('returns Job detail DTOs by id and maps missing or invalid ids', async () => {
		const jobId = new ObjectId();
		const job = {
			_id: jobId,
			name: 'send-email',
			data: { visible: true },
			status: 'completed',
			nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
			failCount: 0,
			createdAt: new Date('2025-12-31T23:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:01:00.000Z'),
		} satisfies PersistedJob;
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async (id) => (id.equals(jobId) ? job : null),
			}),
		});

		const found = await handleGet(surface, `/api/v1/jobs/${jobId.toHexString()}`);
		const missing = await handleGet(surface, `/api/v1/jobs/${new ObjectId().toHexString()}`);
		const invalid = await handleGet(surface, '/api/v1/jobs/not-an-object-id');

		expect(found.status).toBe(200);
		expect(await found.json()).toEqual({
			id: jobId.toHexString(),
			name: 'send-email',
			status: 'completed',
			payload: { visible: true },
			nextRunAt: '2026-01-01T00:00:00.000Z',
			lockedAt: null,
			claimedBy: null,
			lastHeartbeat: null,
			failCount: 0,
			failureReason: null,
			createdAt: '2025-12-31T23:00:00.000Z',
			updatedAt: '2026-01-01T00:01:00.000Z',
		});
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: 'Job not found' });
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({ error: 'Invalid job id' });
	});

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

	test('returns Job statistics through the public scheduler stats API', async () => {
		const calls: Array<{ name?: string } | undefined> = [];
		const stats = {
			pending: 4,
			processing: 3,
			completed: 20,
			failed: 2,
			cancelled: 1,
			total: 30,
			avgProcessingDurationMs: 456,
		} satisfies QueueStats;
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getQueueStats: async (filter) => {
					calls.push(filter);
					return stats;
				},
			}),
		});

		const response = await handleGet(surface, '/api/v1/jobs/stats?name=send-email');

		expect(response.status).toBe(200);
		expect(calls).toEqual([{ name: 'send-email' }]);
		expect(await response.json()).toEqual({
			pending: 4,
			processing: 3,
			completed: 20,
			failed: 2,
			cancelled: 1,
			total: 30,
			avgProcessingDurationMs: 456,
		});
	});

	test('rejects Queue View reads when authorization denies read access', async () => {
		const calls: unknown[] = [];
		const queueViewCalls: string[] = [];
		const surface = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({
				getQueueViewSummaries: async () => {
					queueViewCalls.push('called');
					return [];
				},
			}),
			authorize: ({ action, context }) => {
				calls.push({ action, context });
				return false;
			},
		});

		const response = await handleGet(surface, '/api/v1/queue-views', {
			managementContext: { role: 'viewer' },
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Read access denied' });
		expect(calls).toEqual([{ action: 'read', context: { role: 'viewer' } }]);
		expect(queueViewCalls).toEqual([]);
	});

	test('rejects invalid Job stats query shapes before calling core', async () => {
		const calls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getQueueStats: async () => {
					calls.push('called');
					return {
						pending: 0,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 0,
					};
				},
			}),
		});

		const response = await handleGet(surface, '/api/v1/jobs/stats?name=one&name=two');

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Input validation failed' });
		expect(calls).toEqual([]);
	});

	test('rejects Job stats reads when authorization denies read access', async () => {
		const calls: unknown[] = [];
		const statsCalls: string[] = [];
		const surface = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({
				getQueueStats: async () => {
					statsCalls.push('called');
					return {
						pending: 0,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 0,
					};
				},
			}),
			authorize: ({ action, context }) => {
				calls.push({ action, context });
				return false;
			},
		});

		const response = await handleGet(surface, '/api/v1/jobs/stats', {
			managementContext: { role: 'viewer' },
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Read access denied' });
		expect(calls).toEqual([{ action: 'read', context: { role: 'viewer' } }]);
		expect(statsCalls).toEqual([]);
	});
});
