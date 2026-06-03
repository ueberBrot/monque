import type { Request, Response } from 'express';

type DashboardExpressApiBaseUrlResolverContext = {
	readonly req: Request;
	readonly res: Response;
};

type DashboardExpressApiBaseUrlResolver = (
	context: DashboardExpressApiBaseUrlResolverContext,
) => Promise<string> | string;

type DashboardExpressApiBaseUrlValue = DashboardExpressApiBaseUrlResolver | string;

type DashboardExpressRouterOptions = {
	/**
	 * Management API base URL exposed to the Dashboard runtime config.
	 *
	 * This should point at the mounted Management API root, for example `/ops/api/v1`.
	 */
	readonly apiBaseUrl: DashboardExpressApiBaseUrlValue;
	/**
	 * Optional polling interval injected into the Dashboard runtime config.
	 */
	readonly pollingIntervalMs?: number;
};

export type {
	DashboardExpressApiBaseUrlResolver,
	DashboardExpressApiBaseUrlResolverContext,
	DashboardExpressApiBaseUrlValue,
	DashboardExpressRouterOptions,
};
