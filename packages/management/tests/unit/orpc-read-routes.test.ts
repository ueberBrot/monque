import {
	type CursorOptions,
	InvalidCursorError,
	type QueueStats,
	type QueueViewSummary,
} from '@monque/core';
import { ObjectId } from 'mongodb';
import { describe, expect, test } from 'vitest';

import {
	createManagementJob,
	createManagementMonque,
	expectJsonResponse,
	getManagementJobById,
	handleManagementGet,
} from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management read routes', () => {
	test('lists Job DTOs through cursor pagination with repeated status filters', async () => {
		const jobId = new ObjectId();
		let capturedOptions: CursorOptions | undefined;
		const serializedPayloads: unknown[] = [];
		const job = createManagementJob({
			_id: jobId,
			data: { to: 'person@example.test', token: 'secret' },
			status: 'failed',
			lockedAt: null,
			claimedBy: null,
			lastHeartbeat: null,
			failCount: 2,
			failReason: 'SMTP rejected',
		});
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
			serializePayload: ({ context, job: serializedJob, payload }) => {
				serializedPayloads.push(payload);

				return Promise.resolve({
					visibleTo: context.userId,
					jobName: serializedJob.name,
				});
			},
		});

		const response = await handleManagementGet(
			surface,
			'/api/v1/jobs?cursor=current-cursor&limit=250&name=send-email&status=pending&status=failed',
			{ managementContext: { userId: 'operator-1' } },
		);

		expect(capturedOptions).toEqual({
			cursor: 'current-cursor',
			limit: 100,
			filter: {
				name: 'send-email',
				status: ['pending', 'failed'],
			},
			sort: {
				by: 'createdAt',
				direction: 'desc',
			},
		});
		expect(serializedPayloads).toEqual([{ to: 'person@example.test', token: 'secret' }]);
		await expectJsonResponse(response, 200, {
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
		const job = createManagementJob({
			_id: jobId,
			data: { visible: true },
			status: 'completed',
		});
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(job),
			}),
		});

		const found = await handleManagementGet(surface, `/api/v1/jobs/${jobId.toHexString()}`);
		const missing = await handleManagementGet(
			surface,
			`/api/v1/jobs/${new ObjectId().toHexString()}`,
		);
		const invalid = await handleManagementGet(surface, '/api/v1/jobs/not-an-object-id');

		await expectJsonResponse(found, 200, {
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
		await expectJsonResponse(missing, 404, { error: 'Job not found' });
		await expectJsonResponse(invalid, 400, { error: 'Invalid job id' });
	});

	test('rejects Job detail query ids before reading from core', async () => {
		const coreCalls: string[] = [];
		const pathId = new ObjectId();
		const queryId = new ObjectId();
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async () => {
					coreCalls.push('called');

					return null;
				},
			}),
		});

		const response = await handleManagementGet(
			surface,
			`/api/v1/jobs/${pathId.toHexString()}?id=${queryId.toHexString()}`,
		);

		await expectJsonResponse(response, 400, { error: 'Input validation failed' });
		expect(coreCalls).toEqual([]);
	});

	test('uses default Job page size and per Job Name payload serialization', async () => {
		const jobId = new ObjectId();
		let capturedOptions: CursorOptions | undefined;
		const job = createManagementJob({
			_id: jobId,
			data: { token: 'secret' },
			lockedAt: new Date('2026-01-01T00:00:01.000Z'),
			claimedBy: 'scheduler-1',
			lastHeartbeat: new Date('2026-01-01T00:00:02.000Z'),
			heartbeatInterval: 5000,
			repeatInterval: '0 * * * *',
			uniqueKey: 'send-email:user-1',
		});
		const surface = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({
				getJobsWithCursor: async (options) => {
					capturedOptions = options;

					return {
						jobs: [job],
						cursor: null,
						hasNextPage: false,
						hasPreviousPage: false,
					};
				},
			}),
			serializePayload: () => Promise.resolve({ source: 'global' }),
			serializePayloadByJobName: {
				'send-email': ({ context }) =>
					Promise.resolve({
						source: 'job',
						role: context.role,
					}),
			},
		});

		const response = await handleManagementGet(surface, '/api/v1/jobs?name=send-email', {
			managementContext: { role: 'admin' },
		});

		expect(capturedOptions).toEqual({
			limit: 50,
			filter: {
				name: 'send-email',
			},
			sort: {
				by: 'createdAt',
				direction: 'desc',
			},
		});
		await expectJsonResponse(response, 200, {
			jobs: [
				{
					id: jobId.toHexString(),
					name: 'send-email',
					status: 'pending',
					payload: {
						source: 'job',
						role: 'admin',
					},
					nextRunAt: '2026-01-01T00:00:00.000Z',
					lockedAt: '2026-01-01T00:00:01.000Z',
					claimedBy: 'scheduler-1',
					lastHeartbeat: '2026-01-01T00:00:02.000Z',
					heartbeatInterval: 5000,
					failCount: 0,
					failureReason: null,
					repeatInterval: '0 * * * *',
					uniqueKey: 'send-email:user-1',
					createdAt: '2025-12-31T23:00:00.000Z',
					updatedAt: '2026-01-01T00:01:00.000Z',
				},
			],
			cursor: null,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	test('passes a single Job status query as a scalar core filter', async () => {
		let capturedOptions: CursorOptions | undefined;
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJobsWithCursor: async (options) => {
					capturedOptions = options;

					return {
						jobs: [],
						cursor: null,
						hasNextPage: false,
						hasPreviousPage: false,
					};
				},
			}),
		});

		const response = await handleManagementGet(surface, '/api/v1/jobs?status=failed');

		await expectJsonResponse(response, 200, {
			jobs: [],
			cursor: null,
			hasNextPage: false,
			hasPreviousPage: false,
		});
		expect(capturedOptions).toEqual({
			limit: 50,
			filter: {
				status: 'failed',
			},
			sort: {
				by: 'createdAt',
				direction: 'desc',
			},
		});
	});

	test('maps invalid Job list query shapes and malformed cursors to stable 400 responses', async () => {
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJobsWithCursor: async () => {
					coreCalls.push('called');
					throw new InvalidCursorError('Invalid cursor');
				},
			}),
		});

		const invalidStatus = await handleManagementGet(surface, '/api/v1/jobs?status=wat');
		const invalidRepeatedStatus = await handleManagementGet(
			surface,
			'/api/v1/jobs?status=pending&status=wat',
		);
		const unsupportedFilter = await handleManagementGet(
			surface,
			'/api/v1/jobs?claimedBy=scheduler-1',
		);
		const invalidLimit = await handleManagementGet(surface, '/api/v1/jobs?limit=0');
		const malformedCursor = await handleManagementGet(
			surface,
			'/api/v1/jobs?cursor=not-a-valid-cursor',
		);

		await expectJsonResponse(invalidStatus, 400, { error: 'Input validation failed' });
		await expectJsonResponse(invalidRepeatedStatus, 400, {
			error: 'Input validation failed',
		});
		await expectJsonResponse(unsupportedFilter, 400, { error: 'Input validation failed' });
		await expectJsonResponse(invalidLimit, 400, { error: 'Invalid limit' });
		await expectJsonResponse(malformedCursor, 400, { error: 'Invalid cursor' });
		expect(coreCalls).toEqual(['called']);
	});

	test('rejects Job reads when authorization denies read access', async () => {
		const calls: unknown[] = [];
		const coreCalls: string[] = [];
		const surface = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({
				getJobsWithCursor: async () => {
					coreCalls.push('list');

					return {
						jobs: [],
						cursor: null,
						hasNextPage: false,
						hasPreviousPage: false,
					};
				},
				getJob: async () => {
					coreCalls.push('detail');

					return null;
				},
			}),
			authorize: ({ action, context }) => {
				calls.push({ action, context });
				return false;
			},
		});

		const list = await handleManagementGet(surface, '/api/v1/jobs', {
			managementContext: { role: 'viewer' },
		});
		const detail = await handleManagementGet(
			surface,
			`/api/v1/jobs/${new ObjectId().toHexString()}`,
			{
				managementContext: { role: 'viewer' },
			},
		);

		await expectJsonResponse(list, 403, { error: 'Read access denied' });
		await expectJsonResponse(detail, 403, { error: 'Read access denied' });
		expect(calls).toEqual([
			{ action: 'read', context: { role: 'viewer' } },
			{ action: 'read', context: { role: 'viewer' } },
		]);
		expect(coreCalls).toEqual([]);
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

		const response = await handleManagementGet(surface, '/api/v1/queue-views');

		await expectJsonResponse(response, 200, {
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

		const response = await handleManagementGet(surface, '/api/v1/jobs/stats?name=send-email');
		const globalResponse = await handleManagementGet(surface, '/api/v1/jobs/stats');

		await expectJsonResponse(response, 200, {
			pending: 4,
			processing: 3,
			completed: 20,
			failed: 2,
			cancelled: 1,
			total: 30,
			avgProcessingDurationMs: 456,
		});
		await expectJsonResponse(globalResponse, 200, {
			pending: 4,
			processing: 3,
			completed: 20,
			failed: 2,
			cancelled: 1,
			total: 30,
			avgProcessingDurationMs: 456,
		});
		expect(calls).toEqual([{ name: 'send-email' }, undefined]);
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

		const response = await handleManagementGet(surface, '/api/v1/queue-views', {
			managementContext: { role: 'viewer' },
		});

		await expectJsonResponse(response, 403, { error: 'Read access denied' });
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

		const response = await handleManagementGet(surface, '/api/v1/jobs/stats?name=one&name=two');

		await expectJsonResponse(response, 400, { error: 'Input validation failed' });
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

		const response = await handleManagementGet(surface, '/api/v1/jobs/stats', {
			managementContext: { role: 'viewer' },
		});

		await expectJsonResponse(response, 403, { error: 'Read access denied' });
		expect(calls).toEqual([{ action: 'read', context: { role: 'viewer' } }]);
		expect(statsCalls).toEqual([]);
	});
});
