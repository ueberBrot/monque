import type { DashboardDevScenarioId } from './mock/scenario-catalog.js';

function createScenarioHeaderFetch(scenarioId: DashboardDevScenarioId): typeof fetch {
	return (input, init) => {
		const headers = new Headers(init?.headers);
		headers.set('x-monque-dev-scenario', scenarioId);

		return globalThis.fetch(input, {
			...init,
			headers,
		});
	};
}

export { createScenarioHeaderFetch };
