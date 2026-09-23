import type { ReactElement } from 'react';

import { DashboardState } from '@/components/dashboard-state';
import { Button } from '@/components/ui/button';

import { createDashboardManagementApi } from './management-client.js';
import { DashboardProviders } from './providers.js';
import { createDashboardQueryClient } from './query-client.js';
import { getRouter } from './router.js';
import { parseDashboardRuntimeConfig } from './runtime-config.js';

function createDashboardContent(config: unknown): ReactElement {
	try {
		const runtimeConfig = parseDashboardRuntimeConfig(config);
		const managementApi = createDashboardManagementApi(runtimeConfig);
		const queryClient = createDashboardQueryClient();
		const router = getRouter({ managementApi, queryClient, runtimeConfig });
		return <DashboardProviders queryClient={queryClient} router={router} />;
	} catch {
		return (
			<main className="mx-auto max-w-2xl p-6">
				<DashboardState
					title="Dashboard configuration error"
					description="The dashboard could not start. Ask your host application administrator to check its dashboard configuration, then reload this page."
					tone="danger"
				>
					<Button type="button" variant="outline" onClick={() => window.location.reload()}>
						Reload page
					</Button>
				</DashboardState>
			</main>
		);
	}
}

export { createDashboardContent };
