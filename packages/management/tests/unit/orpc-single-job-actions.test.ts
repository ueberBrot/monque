import { JobStateError, type PersistedJob } from '@monque/core';
import { ObjectId } from 'mongodb';
import { describe, expect, test } from 'vitest';

import { createManagementMonque } from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';
import type { ManagementOpenApiContext, ManagementSurface } from '@/surface';

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

async function handleDelete(
	surface: ManagementSurface,
	path: string,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	const result = await surface.openApiHandler.handle(
		new Request(`https://management.example${path}`, { method: 'DELETE' }),
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

	test('retries one Job through public core API', async () => {
		const jobId = new ObjectId();
		const target = createJob({
			_id: jobId,
			status: 'failed',
			failCount: 2,
			updatedAt: new Date('2026-01-01T00:02:00.000Z'),
		});
		const retried = createJob({
			_id: jobId,
			status: 'pending',
			failCount: 2,
			updatedAt: new Date('2026-01-01T00:03:00.000Z'),
		});
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async (id) => (id.equals(jobId) ? target : null),
				retryJob: async (id) => {
					coreCalls.push(id);

					return retried;
				},
			}),
		});

		const response = await handlePost(surface, `/api/v1/jobs/${jobId.toHexString()}/actions/retry`);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: jobId.toHexString(),
			status: 'pending',
			failCount: 2,
			updatedAt: '2026-01-01T00:03:00.000Z',
		});
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('deletes one Job through public core API with a stable response DTO', async () => {
		const jobId = new ObjectId();
		const target = createJob({ _id: jobId, status: 'completed' });
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async (id) => (id.equals(jobId) ? target : null),
				deleteJob: async (id) => {
					coreCalls.push(id);

					return true;
				},
			}),
		});

		const response = await handleDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ deleted: true });
		expect(coreCalls).toEqual([jobId.toHexString()]);
	});

	test('reschedules one Job with an ISO date DTO mapped to core Date', async () => {
		const jobId = new ObjectId();
		const target = createJob({ _id: jobId });
		const rescheduled = createJob({
			_id: jobId,
			nextRunAt: new Date('2026-02-01T10:30:00.000Z'),
			updatedAt: new Date('2026-01-01T00:04:00.000Z'),
		});
		const coreCalls: Array<{ id: string; runAt: Date }> = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				getJob: async (id) => (id.equals(jobId) ? target : null),
				rescheduleJob: async (id, runAt) => {
					coreCalls.push({ id, runAt });

					return rescheduled;
				},
			}),
		});

		const response = await handlePost(
			surface,
			`/api/v1/jobs/${jobId.toHexString()}/actions/reschedule`,
			{ nextRunAt: '2026-02-01T10:30:00.000Z' },
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: jobId.toHexString(),
			nextRunAt: '2026-02-01T10:30:00.000Z',
			updatedAt: '2026-01-01T00:04:00.000Z',
		});
		expect(coreCalls).toEqual([
			{
				id: jobId.toHexString(),
				runAt: new Date('2026-02-01T10:30:00.000Z'),
			},
		]);
	});

	test('maps single Job action failures to stable HTTP statuses', async () => {
		const jobId = new ObjectId();
		const target = createJob({ _id: jobId });
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
				getJob: async (id) => (id.equals(jobId) ? target : null),
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
				getJob: async (id) => (id.equals(jobId) ? target : null),
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

		const readOnlyResponse = await handlePost(
			readOnly,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);
		const unsupportedResponse = await handlePost(
			unsupported,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);
		const deniedResponse = await handlePost(
			denied,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
			undefined,
			{ managementContext: { role: 'viewer' } },
		);
		const invalidId = await handlePost(
			validatesBeforeCore,
			'/api/v1/jobs/not-an-object-id/actions/cancel',
		);
		const invalidRescheduleBody = await handlePost(
			validatesBeforeCore,
			`/api/v1/jobs/${jobId.toHexString()}/actions/reschedule`,
			{ nextRunAt: 'February 1, 2026 10:30:00' },
		);
		const missingResponse = await handlePost(
			missing,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);
		const conflictResponse = await handlePost(
			conflict,
			`/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
		);

		expect(readOnlyResponse.status).toBe(403);
		expect(await readOnlyResponse.json()).toEqual({ error: 'Management surface is read-only' });
		expect(unsupportedResponse.status).toBe(403);
		expect(await unsupportedResponse.json()).toEqual({ error: 'Unsupported action' });
		expect(deniedResponse.status).toBe(403);
		expect(await deniedResponse.json()).toEqual({ error: 'Action denied' });
		expect(invalidId.status).toBe(400);
		expect(await invalidId.json()).toEqual({ error: 'Invalid job id' });
		expect(invalidRescheduleBody.status).toBe(400);
		expect(await invalidRescheduleBody.json()).toEqual({ error: 'Input validation failed' });
		expect(missingResponse.status).toBe(404);
		expect(await missingResponse.json()).toEqual({ error: 'Job not found' });
		expect(conflictResponse.status).toBe(409);
		expect(await conflictResponse.json()).toEqual({ error: 'Cannot cancel processing job' });
		expect(coreCalls).toEqual([]);
	});
});
