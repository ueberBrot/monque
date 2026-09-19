import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { createDashboardManagementApi } from '@/management-client';
import { DashboardProviders } from '@/providers';
import { createDashboardQueryClient } from '@/query-client';
import { getRouter } from '@/router';

import type { DashboardDevEnvironment } from './environment.js';
import { type DashboardDevScenarioId, isDashboardDevScenarioId } from './mock/scenario-catalog.js';
import { createDashboardRuntimeConfig, dashboardDevScenarioOptions } from './runtime-config.js';
import { createScenarioHeaderFetch } from './scenario-header-fetch.js';

const LOCAL_STORAGE_SCENARIO_KEY = 'monque-dashboard-dev-scenario';

type DashboardDevManagementApiOptions = Parameters<typeof createDashboardManagementApi>[0];

function DashboardDevShellApp({
	environment,
}: {
	readonly environment: DashboardDevEnvironment;
}): ReactElement {
	const [scenarioId, setScenarioId] = useState<DashboardDevScenarioId>(() =>
		getStoredScenarioId(environment.scenarioId),
	);

	useEffect(() => {
		window.localStorage.setItem(LOCAL_STORAGE_SCENARIO_KEY, scenarioId);
	}, [scenarioId]);

	return (
		<>
			<DashboardDevOverlay
				environment={environment}
				scenarioId={scenarioId}
				onScenarioChange={setScenarioId}
			/>
			<DashboardDevRuntime
				key={`${environment.mode}:${scenarioId}`}
				environment={environment}
				scenarioId={scenarioId}
			/>
		</>
	);
}

function DashboardDevRuntime({
	environment,
	scenarioId,
}: {
	readonly environment: DashboardDevEnvironment;
	readonly scenarioId: DashboardDevScenarioId;
}): ReactElement {
	const [{ router, queryClient }] = useState(() => {
		const runtimeConfig = createDashboardRuntimeConfig(environment);
		const managementApi = createDashboardManagementApi(
			createDashboardDevManagementApiOptions(environment, scenarioId, runtimeConfig.apiBaseUrl),
		);
		const queryClient = createDashboardQueryClient();
		const router = getRouter({ managementApi, queryClient, runtimeConfig });
		return { router, queryClient };
	});

	return <DashboardProviders queryClient={queryClient} router={router} />;
}

function DashboardDevOverlay({
	environment,
	scenarioId,
	onScenarioChange,
}: {
	readonly environment: DashboardDevEnvironment;
	readonly scenarioId: DashboardDevScenarioId;
	readonly onScenarioChange: (scenarioId: DashboardDevScenarioId) => void;
}): ReactElement {
	return (
		<Collapsible
			data-testid="dashboard-dev-shell"
			className="max-h-[40dvh] shrink-0 overflow-y-auto border-b border-border bg-muted/50 px-4 py-2 text-xs"
		>
			<CollapsibleTrigger
				render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
			>
				Development ·{' '}
				{environment.mode === 'db'
					? 'Local MongoDB'
					: environment.mode === 'live'
						? 'Live Management API'
						: 'Mock Management API'}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="flex flex-wrap items-center gap-3 py-3">
					{environment.mode === 'mock' ? (
						<>
							<label htmlFor="dev-scenario" className="flex items-center gap-2">
								Scenario
								<Select
									value={scenarioId}
									onValueChange={(value) => {
										if (isDashboardDevScenarioId(value)) onScenarioChange(value);
									}}
								>
									<SelectTrigger id="dev-scenario" aria-label="Scenario" className="w-48">
										<SelectValue>
											{
												dashboardDevScenarioOptions.find((scenario) => scenario.id === scenarioId)
													?.label
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										{dashboardDevScenarioOptions.map((scenario) => (
											<SelectItem key={scenario.id} value={scenario.id}>
												{scenario.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</label>
							<span className="text-muted-foreground">
								Changes last until the development server restarts.
							</span>
						</>
					) : (
						<span className="text-muted-foreground">
							{environment.mode === 'db'
								? 'Local MongoDB with running workers. Demo jobs arrive every 15 seconds; views refresh every second.'
								: 'Requests use the configured Management API proxy.'}
						</span>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function createDashboardDevManagementApiOptions(
	environment: DashboardDevEnvironment,
	scenarioId: DashboardDevScenarioId,
	apiBaseUrl: string,
): DashboardDevManagementApiOptions {
	const baseOptions = {
		apiBaseUrl,
		origin: window.location.origin,
	};

	if (environment.mode === 'mock') {
		return {
			...baseOptions,
			fetch: createScenarioHeaderFetch(scenarioId),
		};
	}

	return baseOptions;
}

function getStoredScenarioId(defaultScenarioId: DashboardDevScenarioId): DashboardDevScenarioId {
	if (typeof window === 'undefined') {
		return defaultScenarioId;
	}

	const storedScenarioId = window.localStorage.getItem(LOCAL_STORAGE_SCENARIO_KEY);

	return isDashboardDevScenarioId(storedScenarioId) ? storedScenarioId : defaultScenarioId;
}

export { DashboardDevShellApp };
