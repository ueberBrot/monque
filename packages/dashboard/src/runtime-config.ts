import { z } from 'zod';

const DashboardRuntimeConfigSchema = z.strictObject({
	apiBaseUrl: z.string().refine(isApiBaseUrl, {
		message: 'apiBaseUrl must be an HTTP(S) URL or a relative API path.',
	}),
	basePath: z.string().refine(isMountPath, {
		message: 'basePath must be a mount path without a query, fragment, or dot segments.',
	}),
	pollingIntervalMs: z.number().int().positive().optional(),
});

type DashboardRuntimeConfig = z.infer<typeof DashboardRuntimeConfigSchema>;

declare global {
	interface Window {
		__MONQUE_DASHBOARD_CONFIG__?: unknown;
	}
}

function isApiBaseUrl(value: string): boolean {
	if (!value.trim() || value !== value.trim() || /[\\\r\n\t]/.test(value)) return false;
	try {
		const url = new URL(value, 'https://dashboard.invalid');
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function isMountPath(value: string): boolean {
	return (
		value.trim().length > 0 &&
		value === value.trim() &&
		!value.startsWith('//') &&
		!/[?#\\\r\n\t]/.test(value) &&
		!value.includes('://') &&
		!value.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))
	);
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

export { type DashboardRuntimeConfig, DashboardRuntimeConfigSchema, parseDashboardRuntimeConfig };
