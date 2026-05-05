import { ConnectionError, InvalidCursorError } from '@monque/core';
import { ObjectId } from 'mongodb';
import { describe, expect, test } from 'vitest';

import { createManagementSurface, HttpMethod, HttpStatus, ManagementRoutePath } from '@/index';
import type { ManagementMonque } from '@/surface';

describe('Management Surface contract', () => {
	test('dispatches health and capabilities through the versioned route map', async () => {
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

		const surface = createManagementSurface({ monque });

		const health = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.HEALTH,
			context: { userId: 'operator-1' },
		});
		const capabilities = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.CAPABILITIES,
			context: { userId: 'operator-1' },
		});

		expect(health).toEqual({
			status: HttpStatus.OK,
			body: {
				status: 'ok',
				scheduler: {
					healthy: true,
				},
			},
		});
		expect(capabilities).toEqual({
			status: HttpStatus.OK,
			body: {
				readOnly: false,
				actions: {
					read: true,
					cancel: true,
					retry: true,
					reschedule: true,
					delete: true,
				},
			},
		});
		expect(surface.routes.map((route) => route.path)).toEqual([
			'/api/v1/health',
			'/api/v1/capabilities',
			'/api/v1/queue-views',
			'/api/v1/jobs',
			'/api/v1/jobs/stats',
			'/api/v1/jobs/{id}',
		]);
	});

	test('returns Queue View summary DTOs from public core API', async () => {
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => [
				{
					name: 'send-email',
					hasPersistedJobs: true,
					hasRegisteredWorker: true,
					stats: {
						pending: 2,
						processing: 1,
						completed: 3,
						failed: 4,
						cancelled: 5,
						total: 15,
						avgProcessingDurationMs: 123,
					},
					worker: {
						concurrency: 5,
						activeCount: 1,
					},
				},
			],
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
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.QUEUE_VIEWS,
			context: { userId: 'operator-1' },
		});

		expect(response).toEqual({
			status: HttpStatus.OK,
			body: {
				queueViews: [
					{
						name: 'send-email',
						hasPersistedJobs: true,
						hasRegisteredWorker: true,
						stats: {
							pending: 2,
							processing: 1,
							completed: 3,
							failed: 4,
							cancelled: 5,
							total: 15,
							avgProcessingDurationMs: 123,
						},
						worker: {
							concurrency: 5,
							activeCount: 1,
						},
					},
				],
			},
		});
	});

	test('denies read endpoints before calling core when read authorization fails', async () => {
		const coreCalls: string[] = [];
		const authorizeCalls: string[] = [];
		const jobId = new ObjectId();
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => {
				coreCalls.push('getQueueViewSummaries');
				return [];
			},
			getJobsWithCursor: async () => {
				coreCalls.push('getJobsWithCursor');
				return {
					jobs: [],
					cursor: null,
					hasNextPage: false,
					hasPreviousPage: false,
				};
			},
			getJob: async () => {
				coreCalls.push('getJob');
				return null;
			},
			getQueueStats: async () => {
				coreCalls.push('getQueueStats');
				return {
					pending: 0,
					processing: 0,
					completed: 0,
					failed: 0,
					cancelled: 0,
					total: 0,
				};
			},
		};
		const surface = createManagementSurface<{ userId: string }>({
			monque,
			authorize: ({ action, context }) => {
				authorizeCalls.push(`${action}:${context.userId}`);
				return action !== 'read';
			},
		});
		const context = { userId: 'operator-1' };

		const responses = await Promise.all([
			surface.handle({
				method: HttpMethod.GET,
				path: ManagementRoutePath.QUEUE_VIEWS,
				context,
			}),
			surface.handle({
				method: HttpMethod.GET,
				path: ManagementRoutePath.JOBS,
				context,
			}),
			surface.handle({
				method: HttpMethod.GET,
				path: ManagementRoutePath.JOB_STATS,
				context,
			}),
			surface.handle({
				method: HttpMethod.GET,
				path: ManagementRoutePath.JOB_DETAIL,
				params: { id: jobId.toHexString() },
				context,
			}),
		]);

		expect(responses).toEqual([
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Read access denied' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Read access denied' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Read access denied' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Read access denied' } },
		]);
		expect(coreCalls).toEqual([]);
		expect(authorizeCalls).toEqual([
			'read:operator-1',
			'read:operator-1',
			'read:operator-1',
			'read:operator-1',
		]);
	});

	test('lists Job DTOs through cursor pagination with repeated status filters', async () => {
		const jobId = new ObjectId();
		let capturedOptions: unknown;
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => [],
			getJobsWithCursor: async (options) => {
				capturedOptions = options;
				return {
					jobs: [
						{
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
						},
					],
					cursor: 'next-cursor',
					hasNextPage: true,
					hasPreviousPage: false,
				};
			},
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
		const surface = createManagementSurface<{ userId: string }>({
			monque,
			serializePayload: ({ context, job }) => ({
				visibleTo: context.userId,
				jobName: job.name,
			}),
		});

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			query: {
				cursor: 'current-cursor',
				limit: '250',
				name: 'send-email',
				status: ['pending', 'failed'],
			},
			context: { userId: 'operator-1' },
		});

		expect(capturedOptions).toEqual({
			cursor: 'current-cursor',
			limit: 100,
			filter: {
				name: 'send-email',
				status: ['pending', 'failed'],
			},
		});
		expect(response).toEqual({
			status: HttpStatus.OK,
			body: {
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
			},
		});
	});

	test('uses per Job Name payload serialization before global serialization', async () => {
		const jobId = new ObjectId();
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => [],
			getJobsWithCursor: async () => ({
				jobs: [
					{
						_id: jobId,
						name: 'send-email',
						data: { token: 'secret' },
						status: 'pending',
						nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
						failCount: 0,
						createdAt: new Date('2025-12-31T23:00:00.000Z'),
						updatedAt: new Date('2026-01-01T00:01:00.000Z'),
					},
				],
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
		const surface = createManagementSurface<{ role: string }>({
			monque,
			serializePayload: () => ({ source: 'global' }),
			serializePayloadByJobName: {
				'send-email': ({ context }) => ({ source: 'job', role: context.role }),
			},
		});

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			context: { role: 'admin' },
		});

		expect(response.body).toMatchObject({
			jobs: [
				{
					payload: {
						source: 'job',
						role: 'admin',
					},
				},
			],
		});
	});

	test('returns Job detail DTOs by id and maps missing Jobs to 404', async () => {
		const jobId = new ObjectId();
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => [],
			getJobsWithCursor: async () => ({
				jobs: [],
				cursor: null,
				hasNextPage: false,
				hasPreviousPage: false,
			}),
			getJob: async (id) => {
				if (!id.equals(jobId)) {
					return null;
				}

				return {
					_id: jobId,
					name: 'send-email',
					data: { visible: true },
					status: 'completed',
					nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
					failCount: 0,
					createdAt: new Date('2025-12-31T23:00:00.000Z'),
					updatedAt: new Date('2026-01-01T00:01:00.000Z'),
				};
			},
			getQueueStats: async () => ({
				pending: 0,
				processing: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				total: 0,
			}),
		};
		const surface = createManagementSurface({ monque });

		const found = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOB_DETAIL,
			params: { id: jobId.toHexString() },
			context: {},
		});
		const missing = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOB_DETAIL,
			params: { id: new ObjectId().toHexString() },
			context: {},
		});
		const invalid = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOB_DETAIL,
			params: { id: 'not-an-object-id' },
			context: {},
		});

		expect(found).toEqual({
			status: HttpStatus.OK,
			body: {
				id: jobId.toHexString(),
				name: 'send-email',
				status: 'completed',
				payload: { visible: true },
				nextRunAt: '2026-01-01T00:00:00.000Z',
				lockedAt: null,
				claimedBy: null,
				lastHeartbeat: null,
				failCount: 0,
				createdAt: '2025-12-31T23:00:00.000Z',
				updatedAt: '2026-01-01T00:01:00.000Z',
			},
		});
		expect(missing).toEqual({
			status: HttpStatus.NOT_FOUND,
			body: { error: 'Job not found' },
		});
		expect(invalid).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid job id' },
		});
	});

	test('returns Job statistics as Job-resource endpoints', async () => {
		const calls: Array<{ name?: string }> = [];
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
			getQueueStats: async (filter) => {
				calls.push(filter ?? {});
				return {
					pending: 1,
					processing: 2,
					completed: 3,
					failed: 4,
					cancelled: 5,
					total: 15,
					avgProcessingDurationMs: 42,
				};
			},
		};
		const surface = createManagementSurface({ monque });

		const all = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOB_STATS,
			context: {},
		});
		const named = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOB_STATS,
			query: { name: 'send-email' },
			context: {},
		});

		expect(calls).toEqual([{}, { name: 'send-email' }]);
		expect(all).toEqual({
			status: HttpStatus.OK,
			body: {
				pending: 1,
				processing: 2,
				completed: 3,
				failed: 4,
				cancelled: 5,
				total: 15,
				avgProcessingDurationMs: 42,
			},
		});
		expect(named).toEqual(all);
	});

	test('maps invalid request shape to 400 and unexpected core errors to 500', async () => {
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => [],
			getJobsWithCursor: async () => {
				throw new ConnectionError('db down');
			},
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
		const surface = createManagementSurface({ monque });

		const invalid = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			query: { status: 'wat' },
			context: {},
		});
		const unexpected = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			context: {},
		});

		expect(invalid).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid status' },
		});
		expect(unexpected).toEqual({
			status: HttpStatus.INTERNAL_SERVER_ERROR,
			body: { error: 'Internal server error' },
		});
	});

	test('maps malformed cursors from core to 400', async () => {
		const monque: ManagementMonque = {
			isHealthy: () => true,
			getQueueViewSummaries: async () => [],
			getJobsWithCursor: async () => {
				throw new InvalidCursorError('Invalid cursor');
			},
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
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			query: { cursor: 'not-a-valid-cursor' },
			context: {},
		});

		expect(response).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid cursor' },
		});
	});
});
