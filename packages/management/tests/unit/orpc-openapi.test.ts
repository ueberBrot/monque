import { beforeAll, describe, expect, test } from 'vitest';

import { generateManagementOpenApiDocument } from '@/index';

describe('oRPC Management OpenAPI contract', () => {
	let document: Awaited<ReturnType<typeof generateManagementOpenApiDocument>>;

	beforeAll(async () => {
		document = await generateManagementOpenApiDocument();
	});

	test('includes stable reusable schema names', () => {
		expect(Object.keys(document.components?.schemas ?? {})).toEqual(
			expect.arrayContaining([
				'BulkActionResult',
				'Capabilities',
				'DeleteJob',
				'Job',
				'JobCursorPage',
				'JobSelector',
				'ManagementError',
				'QueueStats',
				'QueueViewSummaryList',
				'RescheduleJobRequest',
				'SchedulerHealth',
			]),
		);
	});

	test('publishes stable document metadata', () => {
		expect(document.info.title).toBe('Monque Management API');
		expect(document.info.version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
	});

	test('derives the health path and response schema from the oRPC contract', () => {
		expect(document.openapi).toBe('3.1.1');
		expect(document.paths?.['/api/v1/health']?.get?.operationId).toBe('getSchedulerHealth');
		expect(document.paths?.['/api/v1/health']?.get?.responses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/SchedulerHealth' },
				},
			},
		});
		expect(document.components?.schemas?.['SchedulerHealth']).toMatchObject({
			type: 'object',
			properties: {
				status: {
					anyOf: [{ const: 'ok' }, { const: 'unavailable' }],
				},
				scheduler: {
					type: 'object',
					properties: {
						healthy: { type: 'boolean' },
					},
					required: ['healthy'],
					additionalProperties: false,
				},
			},
			required: ['status', 'scheduler'],
			additionalProperties: false,
		});
	});

	test('derives the capabilities path and response schema from the oRPC contract', () => {
		expect(document.paths?.['/api/v1/capabilities']?.get?.operationId).toBe('getCapabilities');
		expect(document.paths?.['/api/v1/capabilities']?.get?.responses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/Capabilities' },
				},
			},
		});
		expect(document.components?.schemas?.['Capabilities']).toMatchObject({
			type: 'object',
			properties: {
				readOnly: { type: 'boolean' },
				actions: {
					type: 'object',
					properties: {
						read: { type: 'boolean' },
						cancel: { type: 'boolean' },
						retry: { type: 'boolean' },
						reschedule: { type: 'boolean' },
						delete: { type: 'boolean' },
					},
					required: ['read', 'cancel', 'retry', 'reschedule', 'delete'],
					additionalProperties: false,
				},
			},
			required: ['readOnly', 'actions'],
			additionalProperties: false,
		});
	});

	test('derives Queue View and Job stats paths from the oRPC contract', () => {
		expect(document.paths?.['/api/v1/queue-views']?.get?.operationId).toBe('listQueueViews');
		expect(document.paths?.['/api/v1/queue-views']?.get?.responses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/QueueViewSummaryList' },
				},
			},
		});
		expect(document.paths?.['/api/v1/jobs/stats']?.get?.operationId).toBe('getJobStats');
		expect(document.paths?.['/api/v1/jobs/stats']?.get?.parameters).toEqual([
			expect.objectContaining({
				name: 'name',
				in: 'query',
				schema: { type: 'string' },
			}),
		]);
		expect(document.paths?.['/api/v1/jobs/stats']?.get?.responses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/QueueStats' },
				},
			},
		});
		expect(document.components?.schemas?.['QueueViewSummaryList']).toMatchObject({
			type: 'object',
			required: ['queueViews'],
			additionalProperties: false,
		});
		expect(document.components?.schemas?.['QueueStats']).toMatchObject({
			type: 'object',
			required: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'total'],
			additionalProperties: false,
		});
	});

	test('derives Job list and detail paths from the oRPC contract', () => {
		expect(document.paths?.['/api/v1/jobs']?.get?.operationId).toBe('listJobs');
		expect(document.paths?.['/api/v1/jobs']?.get?.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'cursor',
					in: 'query',
					schema: { type: 'string' },
				}),
				expect.objectContaining({
					name: 'limit',
					in: 'query',
					schema: { type: 'string' },
				}),
				expect.objectContaining({
					name: 'name',
					in: 'query',
					schema: { type: 'string' },
				}),
				expect.objectContaining({
					name: 'status',
					in: 'query',
					explode: true,
				}),
			]),
		);
		expect(document.paths?.['/api/v1/jobs']?.get?.responses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/JobCursorPage' },
				},
			},
		});
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.operationId).toBe('getJob');
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.parameters).toEqual([
			expect.objectContaining({
				name: 'id',
				in: 'path',
				required: true,
				schema: { type: 'string' },
			}),
		]);
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.responses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/Job' },
				},
			},
		});
		expect(document.components?.schemas?.['Job']).toMatchObject({
			type: 'object',
			properties: {
				id: { type: 'string' },
				name: { type: 'string' },
				status: {
					enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
					type: 'string',
				},
				nextRunAt: { type: 'string', format: 'date-time' },
				lockedAt: {
					anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
				},
				claimedBy: {
					anyOf: [{ type: 'string' }, { type: 'null' }],
				},
				lastHeartbeat: {
					anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
				},
				failCount: { type: 'integer' },
				failureReason: {
					anyOf: [{ type: 'string' }, { type: 'null' }],
				},
				createdAt: { type: 'string', format: 'date-time' },
				updatedAt: { type: 'string', format: 'date-time' },
			},
			required: [
				'id',
				'name',
				'status',
				'payload',
				'nextRunAt',
				'lockedAt',
				'claimedBy',
				'lastHeartbeat',
				'failCount',
				'failureReason',
				'createdAt',
				'updatedAt',
			],
			additionalProperties: false,
		});
		expect(document.components?.schemas?.['JobCursorPage']).toMatchObject({
			type: 'object',
			required: ['jobs', 'cursor', 'hasNextPage', 'hasPreviousPage'],
			additionalProperties: false,
		});
	});

	test('derives bulk action paths, schemas, and error statuses from the oRPC contract', () => {
		const paths = [
			['/api/v1/jobs/actions/cancel', 'cancelJobs'],
			['/api/v1/jobs/actions/retry', 'retryJobs'],
			['/api/v1/jobs/actions/delete', 'deleteJobs'],
		] as const;

		for (const [path, operationId] of paths) {
			const operation = document.paths?.[path]?.post;

			expect(operation?.operationId).toBe(operationId);
			expect(operation?.requestBody).toMatchObject({
				required: true,
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/JobSelector' },
					},
				},
			});
			expect(operation?.responses?.['200']).toMatchObject({
				description: 'Successful response',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/BulkActionResult' },
					},
				},
			});
			for (const status of ['400', '403', '409', '500']) {
				expect(operation?.responses?.[status]).toMatchObject({
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ManagementError' },
						},
					},
				});
			}
		}
		expect(document.components?.schemas?.['JobSelector']).toMatchObject({
			type: 'object',
			properties: {
				name: { type: 'string' },
				status: {
					anyOf: [
						{
							enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
							type: 'string',
						},
						{
							type: 'array',
							minItems: 1,
							items: {
								enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
								type: 'string',
							},
						},
					],
				},
				olderThan: { type: 'string', format: 'date-time' },
				newerThan: { type: 'string', format: 'date-time' },
			},
			additionalProperties: false,
		});
		expect(document.components?.schemas?.['BulkActionResult']).toMatchObject({
			type: 'object',
			properties: {
				count: { type: 'integer' },
			},
			required: ['count', 'errors'],
			additionalProperties: false,
		});
		expect(document.components?.schemas?.['ManagementError']).toMatchObject({
			type: 'object',
			required: ['error'],
			additionalProperties: false,
		});
	});

	test('derives single Job action paths, schemas, and error statuses from the oRPC contract', () => {
		const jobResponseRoutes = [
			['/api/v1/jobs/{id}/actions/cancel', 'cancelJob'],
			['/api/v1/jobs/{id}/actions/retry', 'retryJob'],
			['/api/v1/jobs/{id}/actions/reschedule', 'rescheduleJob'],
		] as const;

		for (const [path, operationId] of jobResponseRoutes) {
			const operation = document.paths?.[path]?.post;

			expect(operation?.operationId).toBe(operationId);
			expect(operation?.parameters).toEqual([
				expect.objectContaining({
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				}),
			]);
			expect(operation?.responses?.['200']).toMatchObject({
				description: 'Successful response',
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/Job' },
					},
				},
			});
			for (const status of ['400', '403', '404', '409', '500']) {
				expect(operation?.responses?.[status]).toMatchObject({
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ManagementError' },
						},
					},
				});
			}
		}
		expect(document.paths?.['/api/v1/jobs/{id}']?.delete?.parameters).toEqual([
			expect.objectContaining({
				name: 'id',
				in: 'path',
				required: true,
				schema: { type: 'string' },
			}),
		]);
		expect(
			document.paths?.['/api/v1/jobs/{id}/actions/reschedule']?.post?.requestBody,
		).toMatchObject({
			required: true,
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/RescheduleJobRequest' },
				},
			},
		});
		expect(document.paths?.['/api/v1/jobs/{id}']?.delete?.operationId).toBe('deleteJob');
		const deleteResponses = document.paths?.['/api/v1/jobs/{id}']?.delete?.responses;

		expect(deleteResponses?.['200']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/DeleteJob' },
				},
			},
		});
		for (const status of ['400', '403', '404', '409', '500']) {
			expect(deleteResponses?.[status]).toMatchObject({
				content: {
					'application/json': {
						schema: { $ref: '#/components/schemas/ManagementError' },
					},
				},
			});
		}
		expect(document.components?.schemas?.['RescheduleJobRequest']).toMatchObject({
			type: 'object',
			required: ['nextRunAt'],
			additionalProperties: false,
		});
		expect(document.components?.schemas?.['DeleteJob']).toMatchObject({
			type: 'object',
			required: ['deleted'],
			additionalProperties: false,
		});
	});
});
