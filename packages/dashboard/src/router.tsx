import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";

import {
  DashboardRouteError,
  DashboardRouteNotFound,
  DashboardRoutePending,
} from "./components/route-feedback.js";
import type { DashboardRouterContext } from "./router-context.js";
import { routeTree } from "./routeTree.gen";

interface RouterHistoryOptions {
  history?: RouterHistory;
}
const getRouter = (
  context: DashboardRouterContext,
  options?: {
    readonly history?: RouterHistory;
  },
) => {
  const historyOptions: RouterHistoryOptions = {};
  if (options?.history !== undefined) {
    historyOptions.history = options.history;
  }
  const router = createTanStackRouter({
    routeTree,
    defaultErrorComponent: DashboardRouteError,
    defaultPendingComponent: DashboardRoutePending,
    defaultNotFoundComponent: DashboardRouteNotFound,
    basepath: context.runtimeConfig.basePath,
    context,
    ...historyOptions,
    scrollRestoration: true,
    scrollToTopSelectors: ["#main-content"],
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
  return router;
};
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
export { getRouter };
