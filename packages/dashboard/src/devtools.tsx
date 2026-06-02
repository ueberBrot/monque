import { TanStackDevtools } from '@tanstack/react-devtools';
import { formDevtoolsPlugin } from '@tanstack/react-form-devtools';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';

import type { getRouter } from './router.js';

type DashboardDevtoolsProps = {
	readonly queryClient: QueryClient;
	readonly router: ReturnType<typeof getRouter>;
};

function DashboardDevtools({ queryClient, router }: DashboardDevtoolsProps) {
	return [
		<TanStackDevtools
			key="tanstack-devtools"
			config={{
				hideUntilHover: true,
				panelLocation: 'bottom',
				position: 'bottom-right',
			}}
			eventBusConfig={{
				connectToServerBus: true,
			}}
			plugins={[
				formDevtoolsPlugin(),
				{
					id: 'tanstack-query',
					name: 'TanStack Query',
					render: <ReactQueryDevtoolsPanel client={queryClient} />,
				},
				{
					id: 'tanstack-router',
					name: 'TanStack Router',
					render: <TanStackRouterDevtoolsPanel router={router} />,
				},
			]}
		/>,
	];
}

export { DashboardDevtools };
