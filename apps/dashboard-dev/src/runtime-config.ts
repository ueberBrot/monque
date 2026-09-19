import { type DashboardRuntimeConfig, parseDashboardRuntimeConfig } from '@/runtime-config';

import type { DashboardDevEnvironment } from './environment.js';
import { getDashboardDevScenarioCatalog } from './mock/scenario-catalog.js';

function createDashboardRuntimeConfig(
	environment: DashboardDevEnvironment,
): DashboardRuntimeConfig {
	return parseDashboardRuntimeConfig({
		apiBaseUrl: '/',
		basePath: '/',
		pollingIntervalMs: environment.mode === 'db' ? 1_000 : 10_000,
	});
}

const dashboardDevScenarioOptions = getDashboardDevScenarioCatalog().map((scenario) => ({
	id: scenario.id,
	label: scenario.label,
	description: scenario.description,
}));

export { createDashboardRuntimeConfig, dashboardDevScenarioOptions };
