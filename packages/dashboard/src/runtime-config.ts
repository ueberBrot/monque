import { z } from 'zod';

const DashboardRuntimeConfigSchema = z
	.object({
		apiBaseUrl: z.string().min(1),
		basePath: z.string().min(1),
		pollingIntervalMs: z.number().int().positive().optional(),
	})
	.strict();

type DashboardRuntimeConfig = z.infer<typeof DashboardRuntimeConfigSchema>;

declare global {
	interface Window {
		__MONQUE_DASHBOARD_CONFIG__?: unknown;
	}
}

function normalizeBasePath(basePath: string): string {
	if (basePath === '/') {
		return '/';
	}

	const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
	return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function parseDashboardRuntimeConfig(config: unknown): DashboardRuntimeConfig {
	const parsed = DashboardRuntimeConfigSchema.parse(config);

	return {
		...parsed,
		basePath: normalizeBasePath(parsed.basePath),
	};
}

function readDashboardRuntimeConfig(): DashboardRuntimeConfig {
	return parseDashboardRuntimeConfig(window.__MONQUE_DASHBOARD_CONFIG__);
}

export {
	type DashboardRuntimeConfig,
	DashboardRuntimeConfigSchema,
	parseDashboardRuntimeConfig,
	readDashboardRuntimeConfig,
};
