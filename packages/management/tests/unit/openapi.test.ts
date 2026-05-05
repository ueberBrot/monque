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
		expect(document.paths?.['/api/v1/jobs']?.get?.operationId).toBe('listJobs');
		expect(document.paths?.['/api/v1/jobs']?.get?.parameters).toMatchObject([
			{ name: 'cursor', in: 'query' },
			{ name: 'limit', in: 'query' },
			{ name: 'name', in: 'query' },
			{ name: 'status', in: 'query', explode: true },
		]);
		expect(document.paths?.['/api/v1/jobs']?.get?.responses).toHaveProperty('400');
		expect(document.paths?.['/api/v1/jobs']?.get?.responses).toHaveProperty('403');
		expect(document.paths?.['/api/v1/jobs']?.get?.responses).toHaveProperty('500');
		expect(document.paths?.['/api/v1/queue-views']?.get?.responses).toHaveProperty('500');
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.operationId).toBe('getJob');
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.parameters).toMatchObject([
			{ name: 'id', in: 'path', required: true },
		]);
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.responses).toHaveProperty('404');
		expect(document.paths?.['/api/v1/jobs/{id}']?.get?.responses).toHaveProperty('500');
		expect(document.components?.schemas?.['SchedulerHealth']).toMatchObject({
			type: 'object',
			required: ['status', 'scheduler'],
		});
		expect(document.components?.schemas?.['Capabilities']).toMatchObject({
			type: 'object',
			required: ['readOnly', 'actions'],
		});
		expect(document.components?.schemas?.['Job']).toMatchObject({
			type: 'object',
			required: expect.arrayContaining(['id', 'payload', 'createdAt']),
		});
		expect(document.components?.schemas?.['QueueStats']).toMatchObject({
			type: 'object',
			required: expect.arrayContaining(['pending', 'total']),
		});
		expect(document.components?.schemas?.['JobCursorPage']).toHaveProperty(
			['properties', 'jobs', 'items', '$ref'],
			'#/components/schemas/Job',
		);
		expect(document.components?.schemas?.['QueueViewSummaryList']).toHaveProperty(
			['properties', 'queueViews', 'items', 'properties', 'stats', '$ref'],
			'#/components/schemas/QueueStats',
		);
	});
});
