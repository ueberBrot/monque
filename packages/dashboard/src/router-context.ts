import type { QueryClient } from '@tanstack/react-query';

import type { DashboardManagementApi } from './management-client.js';
import type { DashboardRuntimeConfig } from './runtime-config.js';

type DashboardRouterContext = {
	readonly managementApi: DashboardManagementApi;
	readonly queryClient: QueryClient;
	readonly runtimeConfig: DashboardRuntimeConfig;
};

export type { DashboardRouterContext };
