import { createMockManagementFetch } from "@dashboard-dev/mock/management-server";
import type { DashboardDevScenarioId } from "@dashboard-dev/mock/scenario-catalog";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { createDashboardManagementApi } from "@/management-client";
import { DashboardProviders } from "@/providers";
import { createDashboardQueryClient } from "@/query-client";
import { getRouter } from "@/router";

const createDashboardHarness = (
  pathname: string,
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly scenarioId?: DashboardDevScenarioId;
    readonly pollingIntervalMs?: number;
    readonly origin?: string;
    readonly history?: "browser" | "memory";
  } = {},
) => {
  if (options.history !== "memory") {
    window.history.replaceState({}, "", pathname);
  }
  const runtimeConfig: Parameters<typeof getRouter>[0]["runtimeConfig"] = {
    apiBaseUrl: "/",
    basePath: "/",
  };
  if (options.pollingIntervalMs !== undefined) {
    runtimeConfig.pollingIntervalMs = options.pollingIntervalMs;
  }
  const managementApi = createDashboardManagementApi({
    apiBaseUrl: runtimeConfig.apiBaseUrl,
    fetch:
      options.fetch ??
      createMockManagementFetch({ scenarioId: options.scenarioId ?? "pending-jobs" }),
    origin: options.origin ?? "https://dashboard.test",
  });
  const queryClient = createDashboardQueryClient();
  const router = getRouter(
    { managementApi, queryClient, runtimeConfig },
    options.history === "memory"
      ? { history: createMemoryHistory({ initialEntries: [pathname] }) }
      : undefined,
  );
  return {
    router,
    render: () => render(<DashboardProviders queryClient={queryClient} router={router} />),
  };
};
export { createDashboardHarness };
