import { describe, expect, it } from 'vitest';

import {
	createDashboardRuntimeConfig,
	readDashboardDevEnvironment,
} from '../../src/runtime-config.js';

describe('dashboard dev runtime config', () => {
	it('supports local db mode with same-origin API calls', () => {
		const environment = readDashboardDevEnvironment({
			MONQUE_DASHBOARD_DEV_MODE: 'db',
			MONQUE_DASHBOARD_DEV_SCENARIO: 'pending-jobs',
		} as unknown as ImportMetaEnv);

		expect(environment.mode).toBe('db');
		expect(createDashboardRuntimeConfig(environment)).toEqual({
			apiBaseUrl: '/',
			basePath: '/',
			pollingIntervalMs: 10_000,
		});
	});

	it('requires a live API URL in live mode', () => {
		expect(() =>
			readDashboardDevEnvironment({
				MONQUE_DASHBOARD_DEV_MODE: 'live',
				MONQUE_DASHBOARD_DEV_SCENARIO: 'pending-jobs',
			} as unknown as ImportMetaEnv),
		).toThrow('MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL is required');
	});
});
