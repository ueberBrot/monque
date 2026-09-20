import { describe, expect, test } from 'vitest';

import { createManagementMonque, handleManagementGet } from '@tests/unit/management-test-utils';
import { createManagementSurface } from '@/index';

import { createMockManagementFetch } from '../../../../apps/dashboard-dev/src/mock/management-server.js';

describe.each(['production', 'mock'] as const)('%s Management listing limits', (adapter) => {
	test.each(['0', '-1', 'abc', '1junk', '1.5', ''])('rejects invalid limit %j', async (limit) => {
		const path = `/api/v1/jobs?limit=${encodeURIComponent(limit)}`;
		const response =
			adapter === 'mock'
				? await createMockManagementFetch()(`https://dashboard.test${path}`)
				: await handleManagementGet(
						createManagementSurface({ monque: createManagementMonque() }),
						path,
					);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: 'Invalid limit' });
	});
});
