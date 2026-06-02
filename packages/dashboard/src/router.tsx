import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import type { DashboardRouterContext } from './router-context.js';
import { routeTree } from './routeTree.gen';

function getRouter(context: DashboardRouterContext) {
	const router = createTanStackRouter({
		routeTree,
		basepath: context.runtimeConfig.basePath,
		context,
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
