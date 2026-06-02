import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import { TooltipProvider } from '@/components/ui/tooltip.js';
import { DashboardDevtools } from '@/devtools.js';
import type { getRouter } from '@/router.js';

function DashboardProviders({
	queryClient,
	router,
}: {
	readonly queryClient: QueryClient;
	readonly router: ReturnType<typeof getRouter>;
}) {
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
				<DashboardDevtools queryClient={queryClient} router={router} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

export { DashboardProviders };
