import { createMockManagementFetch } from '@dashboard-dev/mock/management-server';
import { createManagementSurface, type ManagementMonque } from '@monque/management';
import { describe, expect, test } from 'vitest';

function unexpectedRead(): never {
	throw new Error('Invalid listing limits must be rejected before reading scheduler state');
}

const monque: ManagementMonque = {
	isHealthy: () => true,
	getQueueViewSummaries: unexpectedRead,
	getJobsWithCursor: unexpectedRead,
	getJob: unexpectedRead,
	getQueueStats: unexpectedRead,
};

describe.each(['production', 'mock'] as const)('%s Management listing limits', (adapter) => {
	test.each(['0', '-1', 'abc', '1junk', '1.5', ''])('rejects invalid limit %j', async (limit) => {
		const request = new Request(
			`https://dashboard.test/api/v1/jobs?limit=${encodeURIComponent(limit)}`,
		);
		let response: Response;
		if (adapter === 'mock') {
			response = await createMockManagementFetch()(request);
		} else {
			const result = await createManagementSurface({ monque }).openApiHandler.handle(request, {});
			if (!result.matched) throw new Error('Expected the Management listing route to match');
			response = result.response;
		}
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: 'Invalid limit' });
	});
});
