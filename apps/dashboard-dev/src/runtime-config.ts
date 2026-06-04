import { z } from 'zod';

import { type DashboardRuntimeConfig, parseDashboardRuntimeConfig } from '@/runtime-config';

import {
	type DashboardDevScenarioId,
	dashboardDevScenarioIds,
	getDashboardDevScenarioCatalog,
} from './mock/scenario-catalog.js';

const DashboardDevModeSchema = z.enum(['mock', 'live', 'db']);
const DashboardDevScenarioIdSchema = z.enum(dashboardDevScenarioIds);

const DashboardDevEnvironmentSchema = z
	.object({
		mode: DashboardDevModeSchema,
		scenarioId: DashboardDevScenarioIdSchema,
		liveApiBaseUrl: z.string().min(1).optional(),
	})
	.strict();

type DashboardDevEnvironment = z.infer<typeof DashboardDevEnvironmentSchema>;

function readDashboardDevEnvironment(
	env: ImportMetaEnv = import.meta.env,
): DashboardDevEnvironment {
	const parsed = DashboardDevEnvironmentSchema.parse({
		mode: env['MONQUE_DASHBOARD_DEV_MODE'] ?? 'mock',
		scenarioId: env['MONQUE_DASHBOARD_DEV_SCENARIO'] ?? 'pending-jobs',
		liveApiBaseUrl: env['MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL'] || undefined,
	});

	if (parsed.mode === 'live' && !parsed.liveApiBaseUrl) {
		throw new Error(
			'MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL is required when MONQUE_DASHBOARD_DEV_MODE=live.',
		);
	}

	return parsed;
}

function createDashboardRuntimeConfig(
	environment: DashboardDevEnvironment,
): DashboardRuntimeConfig {
	return parseDashboardRuntimeConfig({
		apiBaseUrl: environment.mode === 'live' ? environment.liveApiBaseUrl : '/',
		basePath: '/',
		pollingIntervalMs: 10_000,
	});
}

function getDefaultScenarioId(): DashboardDevScenarioId {
	return readDashboardDevEnvironment().scenarioId;
}

const dashboardDevScenarioOptions = getDashboardDevScenarioCatalog().map((scenario) => ({
	id: scenario.id,
	label: scenario.label,
	description: scenario.description,
}));

export {
	createDashboardRuntimeConfig,
	type DashboardDevEnvironment,
	dashboardDevScenarioOptions,
	getDefaultScenarioId,
	readDashboardDevEnvironment,
};
