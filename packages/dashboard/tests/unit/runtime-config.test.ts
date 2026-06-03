import { describe, expect, it } from 'vitest';

import { DashboardRuntimeConfigSchema, parseDashboardRuntimeConfig } from '@/runtime-config.js';

describe('parseDashboardRuntimeConfig', () => {
	it('normalizes mount-aware base paths', () => {
		expect(
			parseDashboardRuntimeConfig({
				apiBaseUrl: '/api/management',
				basePath: 'dashboard/',
				pollingIntervalMs: 15_000,
			}),
		).toEqual({
			apiBaseUrl: '/api/management',
			basePath: '/dashboard',
			pollingIntervalMs: 15_000,
		});

		expect(
			parseDashboardRuntimeConfig({
				apiBaseUrl: '/api/management',
				basePath: '/',
			}),
		).toEqual({
			apiBaseUrl: '/api/management',
			basePath: '/',
		});
	});

	it('rejects unknown runtime config keys', () => {
		expect(() =>
			DashboardRuntimeConfigSchema.parse({
				apiBaseUrl: '/api/management',
				basePath: '/dashboard',
				unexpected: true,
			}),
		).toThrow();
	});
});
