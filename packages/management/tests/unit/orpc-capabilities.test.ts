import { describe, expect, test } from 'vitest';

import { createManagementMonque } from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';
import type { ManagementOpenApiContext, ManagementSurface } from '@/surface';

async function handleCapabilities(surface: ManagementSurface, context?: ManagementOpenApiContext) {
	const result = await surface.openApiHandler.handle(
		new Request('https://management.example/api/v1/capabilities', { method: 'GET' }),
		context === undefined ? {} : { context },
	);

	if (!result.matched) {
		throw new Error('Expected oRPC OpenAPI handler to match capabilities route');
	}

	return result.response;
}

describe('oRPC Management capabilities route', () => {
	test('reports every Management action available when the scheduler supports them', async () => {
		const surface = createManagementSurface({
			monque: createManagementMonque({}, { mutations: true }),
		});

		const response = await handleCapabilities(surface);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
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

		const response = await handleCapabilities(surface, {
			managementContext: { role: 'viewer' },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
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

		const response = await handleCapabilities(surface);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
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

		const response = await handleCapabilities(surface);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
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
});
