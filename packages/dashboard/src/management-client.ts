import { type ManagementContract, managementContract } from '@monque/management/contract';
import { createORPCClient, ORPCError } from '@orpc/client';
import { getMalformedResponseErrorCode } from '@orpc/client/standard';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import type { DashboardRuntimeConfig } from './runtime-config.js';

type DashboardManagementClient = JsonifiedClient<ContractRouterClient<ManagementContract>>;
type DashboardManagementORPC = ReturnType<
	typeof createTanstackQueryUtils<DashboardManagementClient>
>;

type DashboardManagementApi = {
	readonly client: DashboardManagementClient;
	readonly orpc: DashboardManagementORPC;
};

type CreateDashboardManagementClientOptions = Pick<DashboardRuntimeConfig, 'apiBaseUrl'> & {
	readonly fetch?: typeof fetch;
	readonly origin?: string;
};

function resolveDashboardManagementApiBaseUrl(
	apiBaseUrl: string,
	origin = window.location.origin,
): string {
	return new URL(apiBaseUrl, origin).toString();
}

function fetchWithBrowserCredentials(fetchImplementation: typeof fetch): typeof fetch {
	return (request, init) =>
		fetchImplementation(request, {
			...init,
			credentials: 'include',
		});
}

function createDashboardManagementClient(
	options: CreateDashboardManagementClientOptions,
): DashboardManagementClient {
	const link = new OpenAPILink(managementContract, {
		url: resolveDashboardManagementApiBaseUrl(options.apiBaseUrl, options.origin),
		fetch: fetchWithBrowserCredentials(options.fetch ?? globalThis.fetch.bind(globalThis)),
		customErrorResponseBodyDecoder: (body, response) => {
			if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
			if (typeof body.error !== 'string') return undefined;
			return new ORPCError(getMalformedResponseErrorCode(response.status), {
				status: response.status,
				message: body.error,
				data: body,
			});
		},
	});

	return createORPCClient<DashboardManagementClient>(link);
}

function createDashboardManagementApi(
	options: CreateDashboardManagementClientOptions,
): DashboardManagementApi {
	const client = createDashboardManagementClient(options);
	const orpc = createTanstackQueryUtils(client);

	return { client, orpc };
}

export { createDashboardManagementApi, type DashboardManagementApi };
