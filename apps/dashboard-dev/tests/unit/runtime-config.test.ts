import { describe, expect, it } from 'vitest';

import {
	DashboardDevEnvironmentSchema,
	readDashboardDevServerEnvironment,
} from '../../src/environment.js';
import { createDashboardRuntimeConfig } from '../../src/runtime-config.js';

describe('dashboard dev configuration', () => {
	it('starts without environment overrides using the documented defaults', () => {
		const config = readDashboardDevServerEnvironment({});
		expect(config).toEqual({
			environment: { mode: 'mock', scenarioId: 'pending-jobs' },
			mongoUri: 'mongodb://127.0.0.1:27018/?directConnection=true',
			databaseName: 'monque_dashboard_dev',
			liveApiBaseUrl: undefined,
		});
		expect(createDashboardRuntimeConfig(config.environment)).toEqual({
			apiBaseUrl: '/',
			basePath: '/',
			pollingIntervalMs: 10_000,
		});
	});

	it('preserves MongoDB overrides and the default scenario while exposing only browser settings', () => {
		const config = readDashboardDevServerEnvironment({
			MONQUE_DASHBOARD_DEV_MODE: 'db',
			MONQUE_DASHBOARD_DEV_SCENARIO: 'failed-jobs',
			MONQUE_DASHBOARD_DEV_MONGO_URI: 'mongodb://operator:secret@localhost:27018',
			MONQUE_DASHBOARD_DEV_DATABASE_NAME: 'custom_dashboard',
		});
		expect(config.mongoUri).toBe('mongodb://operator:secret@localhost:27018');
		expect(config.databaseName).toBe('custom_dashboard');
		expect(config.environment).toEqual({ mode: 'db', scenarioId: 'failed-jobs' });
		expect(createDashboardRuntimeConfig(config.environment)).toEqual({
			apiBaseUrl: '/',
			basePath: '/',
			pollingIntervalMs: 1_000,
		});
	});

	it.each(['http://localhost:3000/ops', 'https://example.com/internal/queue'])(
		'keeps the live proxy mount %s on the server',
		(liveApiBaseUrl) => {
			const config = readDashboardDevServerEnvironment({
				MONQUE_DASHBOARD_DEV_MODE: 'live',
				MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL: liveApiBaseUrl,
			});
			expect(config.liveApiBaseUrl).toBe(liveApiBaseUrl);
			expect(config.environment).toEqual({ mode: 'live', scenarioId: 'pending-jobs' });
			expect(DashboardDevEnvironmentSchema.parse(config.environment)).toEqual(config.environment);
			expect(createDashboardRuntimeConfig(config.environment).apiBaseUrl).toBe('/');
		},
	);

	it.each([undefined, ''])(
		'rejects live mode without a target (%s) at configuration time',
		(url) => {
			expect(() =>
				readDashboardDevServerEnvironment({
					MONQUE_DASHBOARD_DEV_MODE: 'live',
					MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL: url,
				}),
			).toThrow('MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL is required');
		},
	);

	it.each(['not-a-url', '/ops', 'ftp://example.com/ops', 'file:///tmp/ops'])(
		'rejects an invalid live proxy target: %s',
		(url) => {
			expect(() =>
				readDashboardDevServerEnvironment({
					MONQUE_DASHBOARD_DEV_MODE: 'live',
					MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL: url,
				}),
			).toThrow();
		},
	);

	it.each([{ MONQUE_DASHBOARD_DEV_MODE: 'typo' }, { MONQUE_DASHBOARD_DEV_SCENARIO: 'typo' }])(
		'rejects invalid mode or scenario before starting a development adapter',
		(env) => {
			expect(() => readDashboardDevServerEnvironment(env)).toThrow();
		},
	);
});
