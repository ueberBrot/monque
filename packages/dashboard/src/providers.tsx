import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { getRouter } from "@/router";

const DashboardDevtools = lazy(async () => {
  const module = await import("@/devtools");
  return { default: module.DashboardDevtools };
});
const shouldRenderDashboardDevtools = import.meta.env.DEV && import.meta.env.MODE !== "test";
const DashboardProviders = ({
  queryClient,
  router,
}: {
  readonly queryClient: QueryClient;
  readonly router: ReturnType<typeof getRouter>;
}) => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <RouterProvider router={router} />
      {shouldRenderDashboardDevtools ? (
        <Suspense fallback={null}>
          <DashboardDevtools queryClient={queryClient} router={router} />
        </Suspense>
      ) : null}
    </TooltipProvider>
  </QueryClientProvider>
);
export { DashboardProviders };
