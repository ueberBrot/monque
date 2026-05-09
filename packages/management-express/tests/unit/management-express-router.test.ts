import type { JobSelector } from '@monque/core';
import type { ManagementMonque } from '@monque/management';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';

import { createManagementExpressRouter, type ManagementExpressRouterOptions } from '@/index';

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

function createManagementApp<TContext>(options: ManagementExpressRouterOptions<TContext>): Express {
	const app = express();

	app.use('/monque', createManagementExpressRouter(options));

	return app;
}

describe('Express Management Adapter', () => {
	test('serves management routes under the host mount path', async () => {
		const app = createManagementApp({
			monque: createManagementMonque({ isHealthy: () => false }),
		});

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

	test('passes Express-derived context into management authorization hooks', async () => {
		const authorize = vi.fn(({ context }) => context.role === 'operator');
		const app = createManagementApp<{ role: string }>({
			monque: createManagementMonque(),
			context: ({ req }) => ({ role: req.get('x-role') ?? 'viewer' }),
			authorize,
		});

		await request(app)
			.get('/monque/api/v1/capabilities')
			.set('x-role', 'operator')
			.expect(200)
			.expect({
				readOnly: false,
				actions: {
					read: true,
					cancel: false,
					cancelBulk: false,
					retry: false,
					retryBulk: false,
					reschedule: false,
					delete: false,
					deleteBulk: false,
				},
			});

		expect(authorize).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'read',
				context: { role: 'operator' },
			}),
		);
	});

	test('supports authorization hooks that do not need Express-derived context', async () => {
		const authorize = vi.fn(({ action }) => action === 'read');
		const app = createManagementApp({
			monque: createManagementMonque(),
			authorize,
		});

		await request(app).get('/monque/api/v1/capabilities').expect(200);

		expect(authorize).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'read',
				context: {},
			}),
		);
	});

	test('serves the management OpenAPI document with mount-specific server metadata', async () => {
		const app = createManagementApp({
			monque: createManagementMonque(),
		});

		const response = await request(app)
			.get('/monque/openapi.json')
			.expect(200)
			.expect('content-type', /json/);

		expect(response.body).toEqual(
			expect.objectContaining({
				openapi: '3.1.1',
				info: expect.objectContaining({
					title: 'Monque Management API',
				}),
				servers: [{ url: '/monque' }],
			}),
		);
		expect(response.body.paths).toHaveProperty('/api/v1/health');
	});

	test('serves OpenAPI JSON from a configured path and server URL', async () => {
		const app = createManagementApp({
			monque: createManagementMonque(),
			openApi: {
				path: 'docs/openapi.json',
				serverUrl: 'https://ops.example.test/monque',
			},
		});

		const response = await request(app).get('/monque/docs/openapi.json').expect(200);

		expect(response.body.servers).toEqual([{ url: 'https://ops.example.test/monque' }]);
		await request(app).get('/monque/openapi.json').expect(404);
	});

	test('can disable adapter-served OpenAPI JSON', async () => {
		const app = createManagementApp({
			monque: createManagementMonque(),
			openApi: false,
		});

		await request(app).get('/monque/openapi.json').expect(404);
		await request(app).get('/monque/api/v1/health').expect(200);
	});

	test('lets host auth middleware wrap body-bearing management routes', async () => {
		const app = express();
		const selectors: JobSelector[] = [];

		app.use((req, res, next) => {
			if (req.get('authorization') !== 'Bearer secret') {
				res.status(401).json({ error: 'Unauthorized' });
				return;
			}

			next();
		});
		app.use(
			'/monque',
			createManagementExpressRouter({
				monque: createManagementMonque({
					cancelJobs: async (selector) => {
						selectors.push(selector);

						return {
							count: 2,
							errors: [],
						};
					},
				}),
			}),
		);

		await request(app).post('/monque/api/v1/jobs/actions/cancel').expect(401).expect({
			error: 'Unauthorized',
		});

		await request(app)
			.post('/monque/api/v1/jobs/actions/cancel')
			.set('authorization', 'Bearer secret')
			.send({
				name: 'send-email',
				status: ['pending'],
				olderThan: '2026-02-01T10:30:00.000Z',
			})
			.expect(200)
			.expect({
				count: 2,
				errors: [],
			});

		expect(selectors).toEqual([
			{
				name: 'send-email',
				status: ['pending'],
				olderThan: new Date('2026-02-01T10:30:00.000Z'),
			},
		]);
	});

	test('accepts body-bearing management routes after Express parsed JSON', async () => {
		const app = express();
		const selectors: JobSelector[] = [];

		app.use(express.json());
		app.use(
			'/monque',
			createManagementExpressRouter({
				monque: createManagementMonque({
					cancelJobs: async (selector) => {
						selectors.push(selector);

						return {
							count: 1,
							errors: [],
						};
					},
				}),
			}),
		);

		await request(app)
			.post('/monque/api/v1/jobs/actions/cancel')
			.send({
				name: 'send-email',
				status: ['pending'],
			})
			.expect(200)
			.expect({
				count: 1,
				errors: [],
			});

		expect(selectors).toEqual([
			{
				name: 'send-email',
				status: ['pending'],
			},
		]);
	});
});
