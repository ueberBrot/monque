import { QueryClient } from "@tanstack/react-query";

const createDashboardQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: {
        networkMode: "always",
        retry: false,
      },
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 1000,
      },
    },
  });
export { createDashboardQueryClient };
