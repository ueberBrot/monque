import {
	ConnectionError,
	InvalidCursorError,
	JobStateError,
	type PersistedJob,
} from '@monque/core';
import { ObjectId } from 'mongodb';
import { describe, expect, test } from 'vitest';

import { createManagementSurface, HttpMethod, HttpStatus, ManagementRoutePath } from '@/index';
import type { ManagementMonque } from '@/surface';

function createJob(overrides: Partial<PersistedJob> = {}): PersistedJob {
	return {
		_id: new ObjectId(),
		name: 'send-email',
		data: { ok: true },
		status: 'pending',
		nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
		failCount: 0,
		createdAt: new Date('2025-12-31T23:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:01:00.000Z'),
		...overrides,
	};
}

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

describe('Management Surface contract', () => {
	test('bulk cancels Jobs through public core API with selector DTO', async () => {
		const calls: unknown[] = [];
		const authorizeCalls: unknown[] = [];
		const monque = createManagementMonque({
			cancelJobs: async (selector) => {
				calls.push(selector);
				return {
					count: 2,
					errors: [],
				};
			},
		});
		const surface = createManagementSurface<{ userId: string }>({
			monque,
			authorize: ({ action, context, selector }) => {
				authorizeCalls.push({ action, context, selector });
				return true;
			},
		});

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: {
				name: 'send-email',
				status: ['pending'],
				olderThan: '2026-02-01T10:30:00.000Z',
				newerThan: '2026-01-01T00:00:00.000Z',
			},
			context: { userId: 'operator-1' },
		});

		const expectedSelector = {
			name: 'send-email',
			status: ['pending'],
			olderThan: new Date('2026-02-01T10:30:00.000Z'),
			newerThan: new Date('2026-01-01T00:00:00.000Z'),
		};
		expect(calls).toEqual([expectedSelector]);
		expect(authorizeCalls).toEqual([
			{
				action: 'cancel',
				context: { userId: 'operator-1' },
				selector: expectedSelector,
			},
		]);
		expect(response).toEqual({
			status: HttpStatus.OK,
			body: {
				count: 2,
				errors: [],
			},
		});
	});

	test('keeps bulk cancel idempotent for repeated empty-result operations', async () => {
		const calls: unknown[] = [];
		const monque = createManagementMonque({
			cancelJobs: async (selector) => {
				calls.push(selector);
				return { count: 0, errors: [] };
			},
		});
		const surface = createManagementSurface({ monque });
		const request = {
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { status: ['pending'] },
			context: {},
		};

		const first = await surface.handle(request);
		const second = await surface.handle(request);

		expect(first).toEqual({
			status: HttpStatus.OK,
			body: { count: 0, errors: [] },
		});
		expect(second).toEqual({
			status: HttpStatus.OK,
			body: { count: 0, errors: [] },
		});
		expect(calls).toEqual([{ status: ['pending'] }, { status: ['pending'] }]);
		expect(calls[0]).toEqual(calls[1]);
	});

	test('bulk retries and deletes Jobs through public core APIs with stable result DTOs', async () => {
		const calls: Array<{ action: string; selector: unknown }> = [];
		const monque = createManagementMonque({
			retryJobs: async (selector) => {
				calls.push({ action: 'retry', selector });
				return {
					count: 1,
					errors: [{ jobId: 'job-1', error: 'still processing' }],
				};
			},
			deleteJobs: async (selector) => {
				calls.push({ action: 'delete', selector });
				return {
					count: 3,
					errors: [],
				};
			},
		});
		const surface = createManagementSurface({ monque });

		const retry = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_RETRY,
			body: {
				status: 'failed',
			},
			context: {},
		});
		const deleted = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_DELETE,
			body: {
				status: ['completed', 'cancelled'],
			},
			context: {},
		});

		expect(calls).toEqual([
			{ action: 'retry', selector: { status: 'failed' } },
			{ action: 'delete', selector: { status: ['completed', 'cancelled'] } },
		]);
		expect(retry).toEqual({
			status: HttpStatus.OK,
			body: {
				count: 1,
				errors: [{ jobId: 'job-1', error: 'still processing' }],
			},
		});
		expect(deleted).toEqual({
			status: HttpStatus.OK,
			body: {
				count: 3,
				errors: [],
			},
		});
	});

	test('rejects invalid bulk selector request shapes before calling core', async () => {
		const calls: string[] = [];
		const monque = createManagementMonque({
			cancelJobs: async () => {
				calls.push('cancel');
				return { count: 0, errors: [] };
			},
		});
		const surface = createManagementSurface({ monque });

		const invalidShape = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: [],
			context: {},
		});
		const invalidStatus = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { status: [] },
			context: {},
		});
		const invalidDate = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { olderThan: 'February 1, 2026 10:30:00' },
			context: {},
		});
		const unknownSelectorField = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { olderThen: '2026-02-01T10:30:00.000Z' },
			context: {},
		});
		const mixedUnknownSelectorField = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { name: 'send-email', unexpected: true },
			context: {},
		});

		expect(invalidShape).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid job selector' },
		});
		expect(invalidStatus).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid status' },
		});
		expect(invalidDate).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid olderThan' },
		});
		expect(unknownSelectorField).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid job selector' },
		});
		expect(mixedUnknownSelectorField).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid job selector' },
		});
		expect(calls).toEqual([]);
	});

	test('rejects all bulk Job mutations in read-only mode before calling core actions', async () => {
		const calls: string[] = [];
		const monque = createManagementMonque({
			cancelJobs: async () => {
				calls.push('cancel');
				return { count: 0, errors: [] };
			},
			retryJobs: async () => {
				calls.push('retry');
				return { count: 0, errors: [] };
			},
			deleteJobs: async () => {
				calls.push('delete');
				return { count: 0, errors: [] };
			},
		});
		const surface = createManagementSurface({ monque, readOnly: true });

		const responses = await Promise.all([
			surface.handle({
				method: HttpMethod.POST,
				path: ManagementRoutePath.JOBS_BULK_CANCEL,
				body: {},
				context: {},
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: ManagementRoutePath.JOBS_BULK_RETRY,
				body: {},
				context: {},
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: ManagementRoutePath.JOBS_BULK_DELETE,
				body: {},
				context: {},
			}),
		]);

		expect(responses).toEqual([
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
		]);
		expect(calls).toEqual([]);
	});

	test('rejects malformed single Job mutations as read-only before request validation', async () => {
		const calls: string[] = [];
		const monque = createManagementMonque({
			cancelJob: async () => {
				calls.push('cancel');
				return null;
			},
			rescheduleJob: async () => {
				calls.push('reschedule');
				return null;
			},
			deleteJob: async () => {
				calls.push('delete');
				return false;
			},
		});
		const surface = createManagementSurface({ monque, readOnly: true });

		const responses = await Promise.all([
			surface.handle({
				method: HttpMethod.POST,
				path: ManagementRoutePath.JOB_CANCEL,
				params: { id: 'not-an-object-id' },
				context: {},
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: ManagementRoutePath.JOB_RESCHEDULE,
				params: { id: new ObjectId().toHexString() },
				body: { nextRunAt: 'not-a-date' },
				context: {},
			}),
			surface.handle({
				method: HttpMethod.DELETE,
				path: ManagementRoutePath.JOB_DETAIL,
				params: { id: 'not-an-object-id' },
				context: {},
			}),
		]);

		expect(responses).toEqual([
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
		]);
		expect(calls).toEqual([]);
	});

	test('authorizes bulk Job mutations with action, context, and selector before core action', async () => {
		const authorizeCalls: unknown[] = [];
		const actionCalls: string[] = [];
		const monque = createManagementMonque({
			cancelJobs: async () => {
				actionCalls.push('cancel');
				return { count: 0, errors: [] };
			},
		});
		const surface = createManagementSurface<{ userId: string }>({
			monque,
			authorize: ({ action, context, selector }) => {
				authorizeCalls.push({ action, context, selector });
				return false;
			},
		});

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { name: 'send-email' },
			context: { userId: 'operator-1' },
		});

		expect(response).toEqual({
			status: HttpStatus.FORBIDDEN,
			body: { error: 'Action denied' },
		});
		expect(authorizeCalls).toEqual([
			{
				action: 'cancel',
				context: { userId: 'operator-1' },
				selector: { name: 'send-email' },
			},
		]);
		expect(actionCalls).toEqual([]);
	});

	test('maps bulk Job action conflicts and core errors', async () => {
		const monque = createManagementMonque({
			cancelJobs: async () => {
				throw new JobStateError('Cannot cancel selected jobs', 'bulk', 'processing', 'cancel');
			},
			retryJobs: async () => {
				throw new ConnectionError('db down');
			},
		});
		const surface = createManagementSurface({ monque });

		const conflict = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_CANCEL,
			body: { status: 'processing' },
			context: {},
		});
		const unexpected = await surface.handle({
			method: HttpMethod.POST,
			path: ManagementRoutePath.JOBS_BULK_RETRY,
			body: { status: 'failed' },
			context: {},
		});

		expect(conflict).toEqual({
			status: HttpStatus.CONFLICT,
			body: { error: 'Cannot cancel selected jobs' },
		});
		expect(unexpected).toEqual({
			status: HttpStatus.INTERNAL_SERVER_ERROR,
			body: { error: 'Internal server error' },
		});
	});

	test('cancels single pending Job through public core API and returns Job DTO', async () => {
		const jobId = new ObjectId();
		const calls: string[] = [];
		const monque = {
			...createManagementMonque(),
			getJob: async () => createJob({ _id: jobId }),
			cancelJob: async (id: string) => {
				calls.push(id);
				return {
					_id: jobId,
					name: 'send-email',
					data: { ok: true },
					status: 'cancelled',
					nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
					failCount: 0,
					createdAt: new Date('2025-12-31T23:00:00.000Z'),
					updatedAt: new Date('2026-01-01T00:01:00.000Z'),
				};
			},
		} satisfies ManagementMonque & {
			cancelJob(id: string): ReturnType<ManagementMonque['getJob']>;
		};
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/cancel',
			params: { id: jobId.toHexString() },
			context: {},
		});

		expect(calls).toEqual([jobId.toHexString()]);
		expect(response).toEqual({
			status: HttpStatus.OK,
			body: {
				id: jobId.toHexString(),
				name: 'send-email',
				status: 'cancelled',
				payload: { ok: true },
				nextRunAt: '2026-01-01T00:00:00.000Z',
				lockedAt: null,
				claimedBy: null,
				lastHeartbeat: null,
				failCount: 0,
				failureReason: null,
				createdAt: '2025-12-31T23:00:00.000Z',
				updatedAt: '2026-01-01T00:01:00.000Z',
			},
		});
	});

	test('binds public core mutation methods before invoking them', async () => {
		const jobId = new ObjectId();
		const calls: string[] = [];
		const monque = {
			...createManagementMonque(),
			marker: 'bound',
			getJob: async () => createJob({ _id: jobId, status: 'failed' }),
			async retryJob(this: { marker: string }, id: string) {
				calls.push(`${this.marker}:${id}`);
				return createJob({ _id: jobId, status: 'pending' });
			},
		} satisfies ManagementMonque & {
			marker: string;
			retryJob(id: string): ReturnType<ManagementMonque['getJob']>;
		};
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/retry',
			params: { id: jobId.toHexString() },
			context: {},
		});

		expect(calls).toEqual([`bound:${jobId.toHexString()}`]);
		expect(response.status).toBe(HttpStatus.OK);
	});

	test('retries single failed Job through public core API and returns Job DTO', async () => {
		const jobId = new ObjectId();
		const calls: string[] = [];
		const monque = createManagementMonque({
			getJob: async () => createJob({ _id: jobId, status: 'failed' }),
			retryJob: async (id) => {
				calls.push(id);
				return createJob({
					_id: jobId,
					status: 'pending',
					data: { retried: true },
				});
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/retry',
			params: { id: jobId.toHexString() },
			context: {},
		});

		expect(calls).toEqual([jobId.toHexString()]);
		expect(response).toMatchObject({
			status: HttpStatus.OK,
			body: {
				id: jobId.toHexString(),
				status: 'pending',
				payload: { retried: true },
			},
		});
	});

	test('reschedules single pending Job using ISO date strings and returns Job DTO', async () => {
		const jobId = new ObjectId();
		const calls: Array<{ id: string; nextRunAt: string }> = [];
		const monque = createManagementMonque({
			getJob: async () => createJob({ _id: jobId }),
			rescheduleJob: async (id, nextRunAt) => {
				calls.push({ id, nextRunAt: nextRunAt.toISOString() });
				return createJob({
					_id: jobId,
					nextRunAt,
					data: { rescheduled: true },
				});
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/reschedule',
			params: { id: jobId.toHexString() },
			body: { nextRunAt: '2026-02-01T10:30:00.000Z' },
			context: {},
		});

		expect(calls).toEqual([{ id: jobId.toHexString(), nextRunAt: '2026-02-01T10:30:00.000Z' }]);
		expect(response).toMatchObject({
			status: HttpStatus.OK,
			body: {
				id: jobId.toHexString(),
				nextRunAt: '2026-02-01T10:30:00.000Z',
				payload: { rescheduled: true },
			},
		});
	});

	test('deletes single Job through public core API and returns delete DTO', async () => {
		const jobId = new ObjectId();
		const calls: string[] = [];
		const monque = createManagementMonque({
			getJob: async () => createJob({ _id: jobId }),
			deleteJob: async (id) => {
				calls.push(id);
				return true;
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.DELETE,
			path: '/api/v1/jobs/{id}',
			params: { id: jobId.toHexString() },
			context: {},
		});

		expect(calls).toEqual([jobId.toHexString()]);
		expect(response).toEqual({
			status: HttpStatus.OK,
			body: { deleted: true },
		});
	});

	test('maps deleteJob returning false to 404', async () => {
		const jobId = new ObjectId();
		const calls: string[] = [];
		const monque = createManagementMonque({
			getJob: async () => createJob({ _id: jobId }),
			deleteJob: async (id) => {
				calls.push(id);
				return false;
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.DELETE,
			path: '/api/v1/jobs/{id}',
			params: { id: jobId.toHexString() },
			context: {},
		});

		expect(calls).toEqual([jobId.toHexString()]);
		expect(response).toEqual({
			status: HttpStatus.NOT_FOUND,
			body: { error: 'Job not found' },
		});
	});

	test('rejects all single Job mutations in read-only mode before calling core actions', async () => {
		const jobId = new ObjectId().toHexString();
		const calls: string[] = [];
		const monque = createManagementMonque({
			cancelJob: async () => {
				calls.push('cancel');
				return null;
			},
			retryJob: async () => {
				calls.push('retry');
				return null;
			},
			rescheduleJob: async () => {
				calls.push('reschedule');
				return null;
			},
			deleteJob: async () => {
				calls.push('delete');
				return false;
			},
		});
		const surface = createManagementSurface({ monque, readOnly: true });

		const responses = await Promise.all([
			surface.handle({
				method: HttpMethod.POST,
				path: '/api/v1/jobs/{id}/actions/cancel',
				params: { id: jobId },
				context: {},
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: '/api/v1/jobs/{id}/actions/retry',
				params: { id: jobId },
				context: {},
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: '/api/v1/jobs/{id}/actions/reschedule',
				params: { id: jobId },
				body: { nextRunAt: '2026-02-01T10:30:00.000Z' },
				context: {},
			}),
			surface.handle({
				method: HttpMethod.DELETE,
				path: '/api/v1/jobs/{id}',
				params: { id: jobId },
				context: {},
			}),
		]);

		expect(responses).toEqual([
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Management surface is read-only' } },
		]);
		expect(calls).toEqual([]);
	});

	test('authorizes single Job mutations with action, context, and target Job before core action', async () => {
		const targetJob = createJob();
		const authorizeCalls: string[] = [];
		const actionCalls: string[] = [];
		const monque = createManagementMonque({
			getJob: async () => targetJob,
			cancelJob: async () => {
				actionCalls.push('cancel');
				return null;
			},
			retryJob: async () => {
				actionCalls.push('retry');
				return null;
			},
			rescheduleJob: async () => {
				actionCalls.push('reschedule');
				return null;
			},
			deleteJob: async () => {
				actionCalls.push('delete');
				return false;
			},
		});
		const surface = createManagementSurface<{ userId: string }>({
			monque,
			authorize: ({ action, context, job }) => {
				authorizeCalls.push(`${action}:${context.userId}:${job?._id.toHexString()}`);
				return false;
			},
		});
		const params = { id: targetJob._id.toHexString() };
		const context = { userId: 'operator-1' };

		const responses = await Promise.all([
			surface.handle({
				method: HttpMethod.POST,
				path: '/api/v1/jobs/{id}/actions/cancel',
				params,
				context,
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: '/api/v1/jobs/{id}/actions/retry',
				params,
				context,
			}),
			surface.handle({
				method: HttpMethod.POST,
				path: '/api/v1/jobs/{id}/actions/reschedule',
				params,
				body: { nextRunAt: '2026-02-01T10:30:00.000Z' },
				context,
			}),
			surface.handle({
				method: HttpMethod.DELETE,
				path: '/api/v1/jobs/{id}',
				params,
				context,
			}),
		]);

		expect(responses).toEqual([
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Action denied' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Action denied' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Action denied' } },
			{ status: HttpStatus.FORBIDDEN, body: { error: 'Action denied' } },
		]);
		expect(authorizeCalls).toEqual([
			`cancel:operator-1:${targetJob._id.toHexString()}`,
			`retry:operator-1:${targetJob._id.toHexString()}`,
			`reschedule:operator-1:${targetJob._id.toHexString()}`,
			`delete:operator-1:${targetJob._id.toHexString()}`,
		]);
		expect(actionCalls).toEqual([]);
	});

	test('maps invalid single Job state transitions to 409', async () => {
		const targetJob = createJob({ status: 'processing' });
		const monque = createManagementMonque({
			getJob: async () => targetJob,
			cancelJob: async () => {
				throw new JobStateError(
					'Cannot cancel processing job',
					targetJob._id.toHexString(),
					'processing',
					'cancel',
				);
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/cancel',
			params: { id: targetJob._id.toHexString() },
			context: {},
		});

		expect(response).toEqual({
			status: HttpStatus.CONFLICT,
			body: { error: 'Cannot cancel processing job' },
		});
	});

	test('maps invalid retry Job state transitions to 409', async () => {
		const targetJob = createJob({ status: 'pending' });
		const message = 'Cannot retry pending job';
		const monque = createManagementMonque({
			getJob: async () => targetJob,
			retryJob: async () => {
				throw new JobStateError(message, targetJob._id.toHexString(), 'pending', 'retry');
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/retry',
			params: { id: targetJob._id.toHexString() },
			context: {},
		});

		expect(response).toEqual({
			status: HttpStatus.CONFLICT,
			body: { error: message },
		});
	});

	test('maps invalid reschedule Job state transitions to 409', async () => {
		const targetJob = createJob({ status: 'completed' });
		const message = 'Cannot reschedule completed job';
		const monque = createManagementMonque({
			getJob: async () => targetJob,
			rescheduleJob: async () => {
				throw new JobStateError(message, targetJob._id.toHexString(), 'completed', 'reschedule');
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/reschedule',
			params: { id: targetJob._id.toHexString() },
			body: { nextRunAt: '2026-02-01T10:30:00.000Z' },
			context: {},
		});

		expect(response).toEqual({
			status: HttpStatus.CONFLICT,
			body: { error: message },
		});
	});

	test('maps invalid delete Job state transitions to 409', async () => {
		const targetJob = createJob({ status: 'processing' });
		const message = 'Cannot delete processing job';
		const monque = createManagementMonque({
			getJob: async () => targetJob,
			deleteJob: async () => {
				throw new JobStateError(message, targetJob._id.toHexString(), 'processing', 'cancel');
			},
		});
		const surface = createManagementSurface({ monque });

		const response = await surface.handle({
			method: HttpMethod.DELETE,
			path: '/api/v1/jobs/{id}',
			params: { id: targetJob._id.toHexString() },
			context: {},
		});

		expect(response).toEqual({
			status: HttpStatus.CONFLICT,
			body: { error: message },
		});
	});

	test('maps single Job action request and core errors', async () => {
		const targetJob = createJob();
		const actionCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async (id) => (id.equals(targetJob._id) ? targetJob : null),
				cancelJob: async () => {
					throw new ConnectionError('db down');
				},
				retryJob: async () => {
					actionCalls.push('retry');
					return null;
				},
				rescheduleJob: async () => {
					actionCalls.push('reschedule');
					return null;
				},
			}),
		});

		const invalidReschedule = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/reschedule',
			params: { id: targetJob._id.toHexString() },
			body: { nextRunAt: 'not-a-date' },
			context: {},
		});
		const legacyDateReschedule = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/reschedule',
			params: { id: targetJob._id.toHexString() },
			body: { nextRunAt: 'February 1, 2026 10:30:00' },
			context: {},
		});
		const missing = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/retry',
			params: { id: new ObjectId().toHexString() },
			context: {},
		});
		const unexpected = await surface.handle({
			method: HttpMethod.POST,
			path: '/api/v1/jobs/{id}/actions/cancel',
			params: { id: targetJob._id.toHexString() },
			context: {},
		});

		expect(invalidReschedule).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid nextRunAt' },
		});
		expect(legacyDateReschedule).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid nextRunAt' },
		});
		expect(missing).toEqual({
			status: HttpStatus.NOT_FOUND,
			body: { error: 'Job not found' },
		});
		expect(unexpected).toEqual({
			status: HttpStatus.INTERNAL_SERVER_ERROR,
			body: { error: 'Internal server error' },
		});
		expect(actionCalls).toEqual([]);
	});

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
					cancel: false,
					retry: false,
					reschedule: false,
					delete: false,
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
			serializePayload: ({ context, job }) =>
				Promise.resolve({
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

	test('uses default Job cursor page size when limit is omitted', async () => {
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
			serializePayload: ({ context, job }) =>
				Promise.resolve({
					visibleTo: context.userId,
					jobName: job.name,
				}),
		});

		const response = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			query: {
				cursor: 'current-cursor',
				name: 'send-email',
				status: ['pending', 'failed'],
			},
			context: { userId: 'operator-1' },
		});

		expect(capturedOptions).toEqual({
			cursor: 'current-cursor',
			limit: 50,
			filter: {
				name: 'send-email',
				status: ['pending', 'failed'],
			},
		});
		expect(response.status).toBe(HttpStatus.OK);
		expect(response.body).toMatchObject({
			jobs: [
				{
					id: jobId.toHexString(),
					name: 'send-email',
					status: 'failed',
					payload: {
						visibleTo: 'operator-1',
						jobName: 'send-email',
					},
				},
			],
			cursor: 'next-cursor',
			hasNextPage: true,
			hasPreviousPage: false,
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
			serializePayload: () => Promise.resolve({ source: 'global' }),
			serializePayloadByJobName: {
				'send-email': ({ context }) =>
					Promise.resolve({
						source: 'job',
						role: context.role,
					}),
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
					failureReason: null,
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
				failureReason: null,
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
		const unsupportedFilter = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			query: { claimedBy: 'scheduler-1' },
			context: {},
		});
		const emptyStatuses = await surface.handle({
			method: HttpMethod.GET,
			path: ManagementRoutePath.JOBS,
			query: { status: [] },
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
		expect(unsupportedFilter).toEqual({
			status: HttpStatus.BAD_REQUEST,
			body: { error: 'Invalid job list query' },
		});
		expect(emptyStatuses).toEqual({
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
