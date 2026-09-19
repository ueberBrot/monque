import type { DashboardDevScenarioId } from './mock/scenario-catalog.js';

function createScenarioHeaderFetch(scenarioId: DashboardDevScenarioId): typeof fetch {
	return (input, init) => {
		const request = new Request(input, init);
		request.headers.set('x-monque-dev-scenario', scenarioId);
		return globalThis.fetch(request);
	};
}

export { createScenarioHeaderFetch };
