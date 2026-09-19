// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/management-client', () => ({ createDashboardManagementApi: () => ({}) }));
vi.mock('@/query-client', () => ({ createDashboardQueryClient: () => ({}) }));
vi.mock('@/router', () => ({ getRouter: () => ({}) }));
vi.mock('@/providers', () => ({ DashboardProviders: () => null }));

import { DashboardDevShellApp } from '../../src/dev-shell-app.js';

afterEach(() => {
	cleanup();
	localStorage.clear();
});

it.each([null, 'invalid-scenario'])(
	'uses the supplied default scenario when the saved preference is %s',
	(stored) => {
		if (stored) localStorage.setItem('monque-dashboard-dev-scenario', stored);
		render(
			createElement(DashboardDevShellApp, {
				environment: { mode: 'mock', scenarioId: 'failed-jobs' },
			}),
		);
		expect(localStorage.getItem('monque-dashboard-dev-scenario')).toBe('failed-jobs');
	},
);

it('preserves a valid saved scenario over the supplied default', () => {
	localStorage.setItem('monque-dashboard-dev-scenario', 'empty-state');
	render(
		createElement(DashboardDevShellApp, {
			environment: { mode: 'mock', scenarioId: 'failed-jobs' },
		}),
	);
	expect(localStorage.getItem('monque-dashboard-dev-scenario')).toBe('empty-state');
});
