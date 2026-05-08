import { describe, expect, test } from 'vitest';

import {
	createManagementMonque,
	expectJsonResponse,
	handleManagementGet,
	handleManagementPost,
} from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

describe('oRPC Management capabilities route', () => {
	test('reports every Management action available when the scheduler supports them', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({}, { mutations: true }),
		});

		const response = await handleManagementGet(surface, '/api/v1/capabilities');

		await expectJsonResponse(response, 200, {
			readOnly: false,
			actions: {
				read: true,
				cancel: true,
				retry: true,
				reschedule: true,
				delete: true,
			},
		});
	});

	test('uses adapter-provided request context for action authorization', async () => {
		const authorizedActions = new Set(['read', 'retry']);
		const surface = createManagementSurface<{ role: string }>({
			monque: createManagementMonque({}, { mutations: true }),
			authorize: ({ action, context }) => {
				expect(context).toEqual({ role: 'viewer' });
				return authorizedActions.has(action);
			},
		});

		const response = await handleManagementGet(surface, '/api/v1/capabilities', {
			managementContext: { role: 'viewer' },
		});

		await expectJsonResponse(response, 200, {
			readOnly: false,
			actions: {
				read: true,
				cancel: false,
				retry: true,
				reschedule: false,
				delete: false,
			},
		});
	});

	test('reports writable actions unavailable in read-only mode', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({}, { mutations: true }),
			readOnly: true,
		});

		const response = await handleManagementGet(surface, '/api/v1/capabilities');

		await expectJsonResponse(response, 200, {
			readOnly: true,
			actions: {
				read: true,
				cancel: false,
				retry: false,
				reschedule: false,
				delete: false,
			},
		});
	});

	test('keeps unsupported actions visible as unavailable capabilities', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({
				retryJob: async () => null,
				retryJobs: async () => ({ count: 0, errors: [] }),
			}),
		});

		const response = await handleManagementGet(surface, '/api/v1/capabilities');

		await expectJsonResponse(response, 200, {
			readOnly: false,
			actions: {
				read: true,
				cancel: false,
				retry: true,
				reschedule: false,
				delete: false,
			},
		});
	});

	test('keeps action capabilities separate from route-level scheduler support', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({
				cancelJobs: async () => ({ count: 0, errors: [] }),
			}),
		});

		const capabilities = await handleManagementGet(surface, '/api/v1/capabilities');
		const singleCancel = await handleManagementPost(
			surface,
			'/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel',
		);
		const bulkCancel = await handleManagementPost(surface, '/api/v1/jobs/actions/cancel', {});

		await expectJsonResponse(
			capabilities,
			200,
			expect.objectContaining({
				actions: expect.objectContaining({
					cancel: true,
				}),
			}),
		);
		await expectJsonResponse(singleCancel, 403, { error: 'Unsupported action' });
		await expectJsonResponse(bulkCancel, 200, { count: 0, errors: [] });
	});
});
