import { parseDashboardRuntimeConfig } from "@/runtime-config";
import type { DashboardRuntimeConfig } from "@/runtime-config";

import type { DashboardDevEnvironment } from "./environment.js";
import { getDashboardDevScenarioCatalog } from "./mock/scenario-catalog.js";

const createDashboardRuntimeConfig = (
  environment: DashboardDevEnvironment,
): DashboardRuntimeConfig =>
  parseDashboardRuntimeConfig({
    apiBaseUrl: "/",
    basePath: "/",
    pollingIntervalMs: environment.mode === "db" ? 1000 : 10_000,
  });
const dashboardDevScenarioOptions = getDashboardDevScenarioCatalog().map((scenario) => ({
  id: scenario.id,
  label: scenario.label,
  description: scenario.description,
}));
export { createDashboardRuntimeConfig, dashboardDevScenarioOptions };
