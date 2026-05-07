import { describe, expect, test } from 'vitest';

import { generateManagementOpenApiDocument } from '@/index';

describe('oRPC Management OpenAPI contract', () => {
	test('derives the health path and response schema from the oRPC contract', async () => {
		const document = await generateManagementOpenApiDocument();

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
			required: ['status', 'scheduler'],
			additionalProperties: false,
		});
	});

	test('derives the capabilities path and response schema from the oRPC contract', async () => {
		const document = await generateManagementOpenApiDocument();

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
			required: ['readOnly', 'actions'],
			additionalProperties: false,
		});
	});

	test('derives Queue View and Job stats paths from the oRPC contract', async () => {
		const document = await generateManagementOpenApiDocument();

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
});
