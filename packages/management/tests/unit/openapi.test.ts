import { describe, expect, test } from 'vitest';

import { getManagementOpenApiDocument, MANAGEMENT_ROUTE_MAP } from '@/index';

describe('Management OpenAPI contract', () => {
	test('derives paths and schemas from the Management Route Map', () => {
		const document = getManagementOpenApiDocument();

		expect(document.openapi).toBe('3.1.0');
		expect(Object.keys(document.paths ?? {})).toEqual(
			MANAGEMENT_ROUTE_MAP.map((route) => route.path),
		);
		expect(document.paths?.['/api/v1/health']?.get?.operationId).toBe('getSchedulerHealth');
		expect(document.paths?.['/api/v1/capabilities']?.get?.operationId).toBe('getCapabilities');
		expect(document.components?.schemas?.['SchedulerHealth']).toMatchObject({
			type: 'object',
			required: ['status', 'scheduler'],
		});
		expect(document.components?.schemas?.['Capabilities']).toMatchObject({
			type: 'object',
			required: ['readOnly', 'actions'],
		});
	});
});
