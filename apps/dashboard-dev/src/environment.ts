import { z } from 'zod';

import { dashboardDevScenarioIds } from './mock/scenario-catalog.js';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27018/?directConnection=true';
const DEFAULT_DATABASE_NAME = 'monque_dashboard_dev';

const DashboardDevEnvironmentSchema = z.strictObject({
	mode: z.enum(['mock', 'live', 'db']).default('mock'),
	scenarioId: z.enum(dashboardDevScenarioIds).default('pending-jobs'),
});

type DashboardDevEnvironment = z.infer<typeof DashboardDevEnvironmentSchema>;

const DashboardDevServerEnvironmentSchema = z
	.strictObject({
		environment: DashboardDevEnvironmentSchema,
		liveApiBaseUrl: z.url({ protocol: /^https?$/ }).optional(),
		mongoUri: z.string().min(1).default(DEFAULT_MONGO_URI),
		databaseName: z.string().min(1).default(DEFAULT_DATABASE_NAME),
	})
	.superRefine((config, context) => {
		if (config.environment.mode === 'live' && !config.liveApiBaseUrl) {
			context.addIssue({
				code: 'custom',
				path: ['liveApiBaseUrl'],
				message:
					'MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL is required when MONQUE_DASHBOARD_DEV_MODE=live.',
			});
		}
	});

function readDashboardDevServerEnvironment(
	env: Readonly<Record<string, string | undefined>>,
): z.infer<typeof DashboardDevServerEnvironmentSchema> {
	return DashboardDevServerEnvironmentSchema.parse({
		environment: {
			mode: env['MONQUE_DASHBOARD_DEV_MODE'],
			scenarioId: env['MONQUE_DASHBOARD_DEV_SCENARIO'],
		},
		liveApiBaseUrl: env['MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL'] || undefined,
		mongoUri: env['MONQUE_DASHBOARD_DEV_MONGO_URI'] || undefined,
		databaseName: env['MONQUE_DASHBOARD_DEV_DATABASE_NAME'] || undefined,
	});
}

export {
	type DashboardDevEnvironment,
	DashboardDevEnvironmentSchema,
	DEFAULT_DATABASE_NAME,
	DEFAULT_MONGO_URI,
	readDashboardDevServerEnvironment,
};
