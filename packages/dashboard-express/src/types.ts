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
	 * This should point at the Management adapter mount, for example `/ops`.
	 * Contract paths such as `/api/v1/jobs` are appended by the dashboard client.
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
