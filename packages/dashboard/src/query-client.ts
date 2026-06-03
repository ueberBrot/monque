import { QueryClient } from '@tanstack/react-query';

function createDashboardQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: false,
				retry: false,
				staleTime: 1_000,
			},
		},
	});
}

export { createDashboardQueryClient };
