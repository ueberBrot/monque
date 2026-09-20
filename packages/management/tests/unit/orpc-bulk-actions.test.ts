import type { BulkOperationResult, JobSelector } from '@monque/core';
import { JobStateError } from '@monque/core';
import { describe, expect, test } from 'vitest';

import {
	createManagementJob,
	createManagementMonque,
	expectJsonResponse,
	handleManagementPost,
} from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management bulk action routes', () => {
	test('starts waiting selected jobs as soon as a worker finishes while another job is slow', async () => {
		const jobs = Array.from({ length: 8 }, () => createManagementJob({ status: 'failed' }));
		const ids = jobs.map((job) => job._id.toHexString());
		const slow = Promise.withResolvers<void>();
		const started: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque(
				{
					getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
					retryJob: async (id) => {
						started.push(id);
						if (id === ids[0]) await slow.promise;
						return createManagementJob({ status: 'pending' });
					},
				},
				{ mutations: true },
			),
		});
		const request = handleManagementPost(surface, '/api/v1/jobs/actions/selected', {
			action: 'retry',
			ids,
		});
		try {
			await expect.poll(() => started.length, { timeout: 200 }).toBe(8);
		} finally {
			slow.resolve();
			await request;
		}
		expect(await (await request).json()).toMatchObject({ count: 8, errors: [] });
	});

	test('selected actions authorize each job and report partial failures without touching other jobs', async () => {
		const allowed = createManagementJob({ status: 'failed' });
		const denied = createManagementJob({ status: 'failed' });
		const changed: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque(
				{
					getJob: async (id) =>
						[allowed, denied].find((job) => job._id.toHexString() === id) ?? null,
					retryJob: async (id) => {
						changed.push(id);
						return { ...allowed, status: 'pending' };
					},
				},
				{ mutations: true },
			),
			authorize: ({ job, ids }) => {
				if (ids) expect(ids).toEqual([allowed._id.toHexString(), denied._id.toHexString()]);
				return !job || job._id.equals(allowed._id);
			},
			serializePayload: () => {
				throw new Error('Bulk actions do not return payloads');
			},
		});
		const response = await handleManagementPost(
			surface,
			'/api/v1/jobs/actions/selected',
			{
				action: 'retry',
				ids: [allowed._id.toHexString(), denied._id.toHexString(), allowed._id.toHexString()],
			},
			{ managementContext: {} },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			count: 1,
			errors: [{ jobId: denied._id.toHexString(), status: 403 }],
		});
		expect(changed).toEqual([allowed._id.toHexString()]);
	});

	test.each(['cancel', 'retry', 'delete', 'reschedule'] as const)(
		'selected %s is bounded and reports missing jobs independently',
		async (action) => {
			const jobs = Array.from({ length: 12 }, () => createManagementJob());
			let active = 0;
			let maximum = 0;
			const changed: string[] = [];
			const mutate = async (id: string) => {
				active++;
				maximum = Math.max(active, maximum);
				await new Promise((resolve) => setTimeout(resolve, 2));
				active--;
				changed.push(id);
				return createManagementJob();
			};
			const surface = createManagementSurface({
				monque: createManagementMonque(
					{
						getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
						cancelJob: mutate,
						retryJob: mutate,
						rescheduleJob: mutate,
						deleteJob: async (id) => {
							await mutate(id);
							return true;
						},
					},
					{ mutations: true },
				),
			});
			const missing = createManagementJob()._id.toHexString();
			const response = await handleManagementPost(surface, '/api/v1/jobs/actions/selected', {
				action,
				ids: [...jobs.map((job) => job._id.toHexString()), missing],
				...(action === 'reschedule' ? { nextRunAt: '2027-01-01T00:00:00.000Z' } : {}),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				count: 12,
				errors: [{ jobId: missing, status: 404 }],
			});
			expect(maximum).toBe(5);
			expect(changed).toHaveLength(12);
		},
	);

	test('rejects oversized selections and read-only mutations before touching jobs', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({}, { mutations: true }),
			readOnly: true,
		});
		const id = createManagementJob()._id.toHexString();
		const oversized = await handleManagementPost(surface, '/api/v1/jobs/actions/selected', {
			action: 'retry',
			ids: Array.from({ length: 101 }, () => id),
		});
		expect(oversized.status).toBe(400);
		const denied = await handleManagementPost(surface, '/api/v1/jobs/actions/selected', {
			action: 'retry',
			ids: [id],
		});
		expect(denied.status).toBe(403);
	});

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

		const response = await handleManagementPost(
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
		await expectJsonResponse(response, 200, {
			count: 2,
			errors: [],
		});
		expect(coreCalls).toEqual([expectedSelector]);
		expect(authorizeCalls).toEqual([
			{
				action: 'cancelBulk',
				context: { userId: 'operator-1' },
				selector: expectedSelector,
			},
		]);
	});

	test('bulk retries and deletes Jobs through public core APIs with stable result DTOs', async () => {
		const coreCalls: Array<{ action: string; selector: JobSelector }> = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				retryJobs: async (selector): Promise<BulkOperationResult> => {
					coreCalls.push({ action: 'retry', selector });

					return {
						count: 1,
						errors: [{ jobId: 'job-1', error: 'still processing' }],
					};
				},
				deleteJobs: async (selector): Promise<BulkOperationResult> => {
					coreCalls.push({ action: 'delete', selector });

					return {
						count: 3,
						errors: [],
					};
				},
			}),
		});

		const retry = await handleManagementPost(surface, '/api/v1/jobs/actions/retry', {
			status: 'failed',
		});
		const deleted = await handleManagementPost(surface, '/api/v1/jobs/actions/delete', {
			status: ['completed', 'cancelled'],
		});

		await expectJsonResponse(retry, 200, {
			count: 1,
			errors: [{ jobId: 'job-1', error: 'still processing' }],
		});
		await expectJsonResponse(deleted, 200, {
			count: 3,
			errors: [],
		});
		expect(coreCalls).toEqual([
			{ action: 'retry', selector: { status: 'failed' } },
			{ action: 'delete', selector: { status: ['completed', 'cancelled'] } },
		]);
	});

	test('passes an empty bulk Job selector through to public core APIs', async () => {
		const coreCalls: JobSelector[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				deleteJobs: async (selector): Promise<BulkOperationResult> => {
					coreCalls.push(selector);

					return { count: 0, errors: [] };
				},
			}),
		});

		const response = await handleManagementPost(surface, '/api/v1/jobs/actions/delete', {});

		await expectJsonResponse(response, 200, { count: 0, errors: [] });
		expect(coreCalls).toEqual([{}]);
	});

	test('rejects read-only, unsupported, and denied bulk actions with 403', async () => {
		const coreCalls: string[] = [];
		const readOnly = createManagementSurface({
			monque: createManagementMonque({
				cancelJobs: async (): Promise<BulkOperationResult> => {
					coreCalls.push('read-only');

					return { count: 0, errors: [] };
				},
			}),
			readOnly: true,
		});
		const unsupported = createManagementSurface({
			monque: createManagementMonque(),
		});
		const denied = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({
				cancelJobs: async (): Promise<BulkOperationResult> => {
					coreCalls.push('denied');

					return { count: 0, errors: [] };
				},
			}),
			authorize: ({ action, context, selector }) => {
				expect({ action, context, selector }).toEqual({
					action: 'cancelBulk',
					context: { role: 'viewer' },
					selector: { name: 'send-email' },
				});

				return false;
			},
		});

		const readOnlyResponse = await handleManagementPost(
			readOnly,
			'/api/v1/jobs/actions/cancel',
			{},
		);
		const unsupportedResponse = await handleManagementPost(
			unsupported,
			'/api/v1/jobs/actions/cancel',
			{},
		);
		const deniedResponse = await handleManagementPost(
			denied,
			'/api/v1/jobs/actions/cancel',
			{ name: 'send-email' },
			{ managementContext: { role: 'viewer' } },
		);

		await expectJsonResponse(readOnlyResponse, 403, { error: 'Management surface is read-only' });
		await expectJsonResponse(unsupportedResponse, 403, { error: 'Unsupported action' });
		await expectJsonResponse(deniedResponse, 403, { error: 'Action denied' });
		expect(coreCalls).toEqual([]);
	});

	test('rejects invalid bulk selector request shapes before calling core', async () => {
		const coreCalls: string[] = [];
		const surface = createManagementSurface({
			monque: createManagementMonque({
				cancelJobs: async (): Promise<BulkOperationResult> => {
					coreCalls.push('called');

					return { count: 0, errors: [] };
				},
			}),
		});

		const invalidShape = await handleManagementPost(surface, '/api/v1/jobs/actions/cancel', []);
		const invalidStatus = await handleManagementPost(surface, '/api/v1/jobs/actions/cancel', {
			status: [],
		});
		const invalidDate = await handleManagementPost(surface, '/api/v1/jobs/actions/cancel', {
			olderThan: 'February 1, 2026 10:30:00',
		});
		const unknownSelectorField = await handleManagementPost(
			surface,
			'/api/v1/jobs/actions/cancel',
			{
				olderThen: '2026-02-01T10:30:00.000Z',
			},
		);

		for (const response of [invalidShape, invalidStatus, invalidDate, unknownSelectorField]) {
			await expectJsonResponse(response, 400, { error: 'Input validation failed' });
		}
		expect(coreCalls).toEqual([]);
	});

	test('maps invalid bulk Job state transitions to 409', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({
				cancelJobs: async () => {
					throw new JobStateError('Cannot cancel selected jobs', 'bulk', 'processing', 'cancel');
				},
			}),
		});

		const response = await handleManagementPost(surface, '/api/v1/jobs/actions/cancel', {
			status: 'processing',
		});

		await expectJsonResponse(response, 409, { error: 'Cannot cancel selected jobs' });
	});

	test('maps unexpected bulk action failures to the documented 500 response', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({
				cancelJobs: async () => {
					throw new Error('Database unavailable');
				},
			}),
		});

		const response = await handleManagementPost(surface, '/api/v1/jobs/actions/cancel', {});

		await expectJsonResponse(response, 500, { error: 'Internal server error' });
	});
});
