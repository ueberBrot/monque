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
});
