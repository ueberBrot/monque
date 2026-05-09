import { JobStateError } from '@monque/core';
import { ObjectId } from 'mongodb';
import { describe, expect, test } from 'vitest';

import {
	createManagementJob,
	createManagementMonque,
	expectJsonResponse,
	getManagementJobById,
	handleManagementDelete,
	handleManagementPost,
} from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management single Job action routes', () => {
	test('cancels one Job through public core API with target authorization', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId });
		const cancelled = createManagementJob({
			_id: jobId,
			status: 'cancelled',
			updatedAt: new Date('2026-01-01T00:02:00.000Z'),
		});
		const coreCalls: string[] = [];
		const authorizeCalls: unknown[] = [];
		const surface = createManagementSurface<{ userId: string }>({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
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

		const response = await handleManagementPost(
			surface,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
			undefined,
			{ managementContext: { userId: 'operator-1' } },
		);

		await expectJsonResponse(response, 200, {
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

	test('retries one Job through public core API', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({
			_id: jobId,
			status: 'failed',
			failCount: 2,
			updatedAt: new Date('2026-01-01T00:02:00.000Z'),
		});
		const retried = createManagementJob({
			_id: jobId,
			status: 'pending',
			failCount: 2,
			updatedAt: new Date('2026-01-01T00:03:00.000Z'),
		});
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				retryJob: async (id) => {
					coreCalls.push(id);

					return retried;
				},
			}),
		});

		const response = await handleManagementPost(
			surface,
			`/api/v1/jobs/${jobId.toHexString()}/actions/retry`,
		);

		await expectJsonResponse(
			response,
			200,
			expect.objectContaining({
				id: jobId.toHexString(),
				status: 'pending',
				failCount: 2,
				updatedAt: '2026-01-01T00:03:00.000Z',
			}),
		);
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('maps a single Job mutation miss after target resolution to 404', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId, status: 'failed' });
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				retryJob: async (id) => {
					coreCalls.push(id);

					return null;
				},
			}),
		});

		const response = await handleManagementPost(
			surface,
			`/api/v1/jobs/${jobId.toHexString()}/actions/retry`,
		);

		await expectJsonResponse(response, 404, { error: 'Job not found' });
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('deletes one Job through public core API with a stable response DTO', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId, status: 'completed' });
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				deleteJob: async (id) => {
					coreCalls.push(id);

					return true;
				},
			}),
		});

		const response = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

		await expectJsonResponse(response, 200, { deleted: true });
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('keeps single Job delete idempotent when repeated after deletion', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId, status: 'completed' });
		const coreCalls: string[] = [];
		let deleted = false;
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async (id) => {
					if (deleted) {
						return null;
					}

					return getManagementJobById(target)(id);
				},
				deleteJob: async (id) => {
					coreCalls.push(id);
					deleted = true;

					return true;
				},
			}),
		});

		const first = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);
		const second = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

		await expectJsonResponse(first, 200, { deleted: true });
		await expectJsonResponse(second, 404, { error: 'Job not found' });
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('maps a single Job delete miss after target resolution to 404', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId, status: 'completed' });
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				deleteJob: async (id) => {
					coreCalls.push(id);

					return false;
				},
			}),
		});

		const response = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

		await expectJsonResponse(response, 404, { error: 'Job not found' });
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('reschedules one Job with an ISO date DTO mapped to core Date', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId });
		const rescheduled = createManagementJob({
			_id: jobId,
			nextRunAt: new Date('2026-02-01T10:30:00.000Z'),
			updatedAt: new Date('2026-01-01T00:04:00.000Z'),
		});
		const coreCalls: Array<{ id: string; runAt: Date }> = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				rescheduleJob: async (id, runAt) => {
					coreCalls.push({ id, runAt });

					return rescheduled;
				},
			}),
		});

		const response = await handleManagementPost(
			surface,
			`/api/v1/jobs/${jobId.toHexString()}/actions/reschedule`,
			{ nextRunAt: '2026-02-01T10:30:00.000Z' },
		);

		await expectJsonResponse(
			response,
			200,
			expect.objectContaining({
				id: jobId.toHexString(),
				nextRunAt: '2026-02-01T10:30:00.000Z',
				updatedAt: '2026-01-01T00:04:00.000Z',
			}),
		);
		expect(coreCalls).toEqual([
			{
				id: jobId.toHexString(),
				runAt: new Date('2026-02-01T10:30:00.000Z'),
			},
		]);
	});

	test('maps single Job action failures to stable HTTP statuses', async () => {
		const jobId = new ObjectId();
		const target = createManagementJob({ _id: jobId });
		const coreCalls: string[] = [];
		const readOnly = createManagementSurface({
			monque: createManagementMonque({
				cancelJob: async () => {
					coreCalls.push('read-only');

					return null;
				},
			}),
			readOnly: true,
		});
		const unsupported = createManagementSurface({
			monque: createManagementMonque(),
		});
		const denied = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				cancelJob: async () => {
					coreCalls.push('denied');

					return null;
				},
			}),
			authorize: ({ action, context, job }) => {
				expect({ action, context, job }).toEqual({
					action: 'cancel',
					context: { role: 'viewer' },
					job: target,
				});

				return false;
			},
		});
		const validatesBeforeCore = createManagementSurface({
			monque: createManagementMonque({
				getJob: async () => {
					coreCalls.push('invalid');

					return target;
				},
				cancelJob: async () => {
					coreCalls.push('invalid');

					return target;
				},
				rescheduleJob: async () => {
					coreCalls.push('invalid');

					return target;
				},
			}),
		});
		const missing = createManagementSurface({
			monque: createManagementMonque({
				getJob: async () => null,
				cancelJob: async () => {
					coreCalls.push('missing');

					return null;
				},
			}),
		});
		const conflict = createManagementSurface({
			monque: createManagementMonque({
				getJob: getManagementJobById(target),
				cancelJob: async () => {
					throw new JobStateError(
						'Cannot cancel processing job',
						jobId.toHexString(),
						'processing',
						'cancel',
					);
				},
			}),
		});

		const readOnlyResponse = await handleManagementPost(
			readOnly,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);
		const unsupportedResponse = await handleManagementPost(
			unsupported,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);
		const deniedResponse = await handleManagementPost(
			denied,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
			undefined,
			{ managementContext: { role: 'viewer' } },
		);
		const invalidId = await handleManagementPost(
			validatesBeforeCore,
			'/api/v1/jobs/not-an-object-id/actions/cancel',
		);
		const invalidRescheduleBody = await handleManagementPost(
			validatesBeforeCore,
			`/api/v1/jobs/${jobId.toHexString()}/actions/reschedule`,
			{ nextRunAt: 'February 1, 2026 10:30:00' },
		);
		const missingResponse = await handleManagementPost(
			missing,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);
		const conflictResponse = await handleManagementPost(
			conflict,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);

		await expectJsonResponse(readOnlyResponse, 403, { error: 'Management surface is read-only' });
		await expectJsonResponse(unsupportedResponse, 403, { error: 'Unsupported action' });
		await expectJsonResponse(deniedResponse, 403, { error: 'Action denied' });
		await expectJsonResponse(invalidId, 400, { error: 'Invalid job id' });
		await expectJsonResponse(invalidRescheduleBody, 400, {
			error: 'Input validation failed',
		});
		await expectJsonResponse(missingResponse, 404, { error: 'Job not found' });
		await expectJsonResponse(conflictResponse, 409, { error: 'Cannot cancel processing job' });
		expect(coreCalls).toEqual([]);
	});
});
