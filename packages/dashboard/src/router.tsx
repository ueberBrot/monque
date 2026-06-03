import { createRouter as createTanStackRouter, type RouterHistory } from '@tanstack/react-router';

import type { DashboardRouterContext } from './router-context.js';
import { routeTree } from './routeTree.gen';

function getRouter(
	context: DashboardRouterContext,
	options?: {
		readonly history?: RouterHistory;
	},
) {
	const router = createTanStackRouter({
		routeTree,
		basepath: context.runtimeConfig.basePath,
		context,
		...(options?.history ? { history: options.history } : {}),
		scrollRestoration: true,
		defaultPreload: 'intent',
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}

export { getRouter };
