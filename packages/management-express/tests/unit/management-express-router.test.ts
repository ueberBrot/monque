import type { ManagementMonque } from '@monque/management';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { createManagementExpressRouter } from '@/index';

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

describe('Express Management Adapter', () => {
	test('serves management routes under the host mount path', async () => {
		const app = express();

		app.use(
			'/monque',
			createManagementExpressRouter({
				monque: createManagementMonque({ isHealthy: () => false }),
			}),
		);

		await request(app)
			.get('/monque/api/v1/health')
			.expect(200)
			.expect('content-type', /json/)
			.expect({
				status: 'unavailable',
				scheduler: {
					healthy: false,
				},
			});

		const notFound = await request(app).get('/api/v1/health');
		expect(notFound.status).toBe(404);
	});
});
