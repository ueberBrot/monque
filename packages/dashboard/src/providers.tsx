import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import { TooltipProvider } from '@/components/ui/tooltip';
import { DashboardDevtools } from '@/devtools';
import type { getRouter } from '@/router';

const shouldRenderDashboardDevtools = import.meta.env.MODE !== 'test';

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
				{shouldRenderDashboardDevtools ? (
					<DashboardDevtools queryClient={queryClient} router={router} />
				) : null}
			</TooltipProvider>
		</QueryClientProvider>
	);
}

export { DashboardProviders };
