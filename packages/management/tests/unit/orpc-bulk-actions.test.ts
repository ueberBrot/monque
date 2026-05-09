import type { BulkOperationResult, JobSelector } from '@monque/core';
import { JobStateError } from '@monque/core';
import { describe, expect, test } from 'vitest';

import {
	createManagementMonque,
	expectJsonResponse,
	handleManagementPost,
} from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

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
