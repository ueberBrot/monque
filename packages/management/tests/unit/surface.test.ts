import { describe, expect, test } from 'vitest';

import { createManagementSurface, HttpMethod, HttpStatus, ManagementRoutePath } from '@/index';
import type { ManagementMonque } from '@/surface';

describe('Management Surface contract', () => {
	test('dispatches health and capabilities through the versioned route map', async () => {
		const monque: ManagementMonque = {
			isHealthy: () => true,
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
		]);
	});
});
