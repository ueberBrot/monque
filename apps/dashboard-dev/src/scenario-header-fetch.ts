import type { DashboardDevScenarioId } from "./mock/scenario-catalog.js";

const createScenarioHeaderFetch =
  (scenarioId: DashboardDevScenarioId): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    request.headers.set("x-monque-dev-scenario", scenarioId);
    return await Promise.resolve(globalThis.fetch(request));
  };
export { createScenarioHeaderFetch };
