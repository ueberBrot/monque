import ReactDOM from 'react-dom/client';

import { createDashboardManagementApi } from './management-client.js';
import { DashboardProviders } from './providers.js';
import { createDashboardQueryClient } from './query-client.js';
import { getRouter } from './router.js';
import { readDashboardRuntimeConfig } from './runtime-config.js';

const runtimeConfig = readDashboardRuntimeConfig();
const managementApi = createDashboardManagementApi(runtimeConfig);
const queryClient = createDashboardQueryClient();
const router = getRouter({ managementApi, queryClient, runtimeConfig });
const rootElement = document.getElementById('app');

if (!rootElement) {
	throw new Error('Missing #app root element.');
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(<DashboardProviders queryClient={queryClient} router={router} />);
}
