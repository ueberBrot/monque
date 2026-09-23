import { QueryClient } from '@tanstack/react-query';

function createDashboardQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			mutations: {
				networkMode: 'always',
				retry: false,
			},
			queries: {
				refetchOnWindowFocus: false,
				retry: false,
				staleTime: 1_000,
			},
		},
	});
}

export { createDashboardQueryClient };
