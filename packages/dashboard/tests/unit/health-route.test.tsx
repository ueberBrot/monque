// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';
import { DashboardProviders } from '@/providers';
import { createDashboardQueryClient } from '@/query-client';
import { getRouter } from '@/router';
import type { DashboardRuntimeConfig } from '@/runtime-config';

import { createMockManagementFetch } from '../../../../apps/dashboard-dev/src/mock/management-server.js';
import type { DashboardDevScenarioId } from '../../../../apps/dashboard-dev/src/mock/scenario-catalog.js';

const runtimeConfig: DashboardRuntimeConfig = {
	apiBaseUrl: '/',
	basePath: '/',
	pollingIntervalMs: 15_000,
};

describe('Health route', () => {
	beforeEach(() => {
		window.history.replaceState({}, '', '/health');
		Object.defineProperty(window, 'scrollTo', {
			configurable: true,
			value: () => {},
		});
	});

	it('shows scheduler health and Management capabilities', async () => {
		renderHealthRoute('pending-jobs');

		expect(await screen.findByRole('heading', { name: 'Health' })).toBeTruthy();
		expect(await screen.findByText('Scheduler healthy')).toBeTruthy();
		expect(await screen.findByText('Management API reachable')).toBeTruthy();
		expect(await screen.findByText('8 of 8 available')).toBeTruthy();
		expect(await screen.findByText('Cancel job')).toBeTruthy();
	});

	it('shows a distinct unauthorized state without a Dashboard login screen', async () => {
		renderHealthRoute('unauthorized');

		expect(await screen.findByText('Authentication required')).toBeTruthy();
		expect(await screen.findByText('Sign in to inspect the dashboard scenario.')).toBeTruthy();
		expect(screen.queryByText('Dashboard login')).toBeNull();
	});

	it('shows a distinct forbidden state when the operator lacks access', async () => {
		renderHealthRoute('forbidden');

		expect(await screen.findByText('Access denied')).toBeTruthy();
		expect(
			await screen.findByText('You do not have access to this dashboard scenario.'),
		).toBeTruthy();
	});

	it('shows capability-disabled actions for a read-only Management surface', async () => {
		renderHealthRoute('read-only');

		expect(await screen.findByText('Read-only Management surface')).toBeTruthy();
		expect(await screen.findByText('1 of 8 available')).toBeTruthy();
		expect((await screen.findAllByText('Disabled by Management read-only mode.')).length).toBe(7);
		expect((await screen.findAllByText('Retry selected jobs')).length).toBeGreaterThan(0);
	});

	it('maps generic Management API failures to an operator-facing error state', async () => {
		renderHealthRoute('api-error');

		expect(await screen.findByText('Dashboard data unavailable')).toBeTruthy();
		expect(
			await screen.findByText('Management API unavailable for the current dashboard scenario.'),
		).toBeTruthy();
	});
});

function renderHealthRoute(scenarioId: DashboardDevScenarioId) {
	const managementApi = createDashboardManagementApi({
		apiBaseUrl: runtimeConfig.apiBaseUrl,
		fetch: createMockManagementFetch({ scenarioId }),
		origin: 'https://dashboard.example',
	});
	const queryClient = createDashboardQueryClient();
	const router = getRouter({
		managementApi,
		queryClient,
		runtimeConfig,
	});

	render(<DashboardProviders queryClient={queryClient} router={router} />);
}
