import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { createDashboardManagementApi } from '@/management-client';
import { DashboardProviders } from '@/providers';
import { createDashboardQueryClient } from '@/query-client';
import { getRouter } from '@/router';

import { type DashboardDevScenarioId, isDashboardDevScenarioId } from './mock/scenario-catalog.js';
import {
	createDashboardRuntimeConfig,
	type DashboardDevEnvironment,
	dashboardDevScenarioOptions,
	getDefaultScenarioId,
} from './runtime-config.js';
import { createScenarioHeaderFetch } from './scenario-header-fetch.js';

const LOCAL_STORAGE_SCENARIO_KEY = 'monque-dashboard-dev-scenario';

type DashboardDevManagementApiOptions = Parameters<typeof createDashboardManagementApi>[0];

function DashboardDevShellApp({
	environment,
}: {
	readonly environment: DashboardDevEnvironment;
}): ReactElement {
	const [scenarioId, setScenarioId] = useState<DashboardDevScenarioId>(() => getStoredScenarioId());

	useEffect(() => {
		window.localStorage.setItem(LOCAL_STORAGE_SCENARIO_KEY, scenarioId);
	}, [scenarioId]);

	return (
		<>
			<DashboardDevRuntime
				key={`${environment.mode}:${scenarioId}`}
				environment={environment}
				scenarioId={scenarioId}
			/>
			<DashboardDevOverlay
				environment={environment}
				scenarioId={scenarioId}
				onScenarioChange={setScenarioId}
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
	const runtimeConfig = createDashboardRuntimeConfig(environment);
	const managementApi = createDashboardManagementApi(
		createDashboardDevManagementApiOptions(environment, scenarioId, runtimeConfig.apiBaseUrl),
	);
	const queryClient = createDashboardQueryClient();
	const router = getRouter({ managementApi, queryClient, runtimeConfig });

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
	const [summary, setSummary] = useState<{
		queueViewCount: number;
		jobCount: number;
		error: string | null;
	}>({
		queueViewCount: 0,
		jobCount: 0,
		error: null,
	});

	useEffect(() => {
		const runtimeConfig = createDashboardRuntimeConfig(environment);
		const managementApi = createDashboardManagementApi(
			createDashboardDevManagementApiOptions(environment, scenarioId, runtimeConfig.apiBaseUrl),
		);

		let cancelled = false;

		void Promise.all([managementApi.client.queueViews(), managementApi.client.jobs({ limit: '5' })])
			.then(([queueViews, jobs]) => {
				if (cancelled) {
					return;
				}

				setSummary({
					queueViewCount: queueViews.queueViews.length,
					jobCount: jobs.jobs.length,
					error: null,
				});
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}

				const message = error instanceof Error ? error.message : String(error);
				setSummary({
					queueViewCount: 0,
					jobCount: 0,
					error: message,
				});
			});

		return () => {
			cancelled = true;
		};
	}, [environment, scenarioId]);

	const handleScenarioChange = (value: string): void => {
		if (isDashboardDevScenarioId(value)) {
			onScenarioChange(value);
		}
	};

	return (
		<section
			data-testid="dashboard-dev-shell"
			style={{
				position: 'fixed',
				right: '1rem',
				bottom: '1rem',
				zIndex: 60,
				width: 'min(22rem, calc(100vw - 2rem))',
				borderRadius: '8px',
				border: '1px solid #2a3639',
				background: '#090c0d',
				boxShadow: '0 8px 12px rgba(0, 0, 0, 0.36)',
				color: '#e3ebeb',
			}}
		>
			<div style={{ padding: '0.9rem 1rem', display: 'grid', gap: '0.75rem' }}>
				<div style={{ display: 'grid', gap: '0.2rem' }}>
					<p
						style={{
							margin: 0,
							fontSize: '0.72rem',
							letterSpacing: 0,
							textTransform: 'uppercase',
							color: '#a8b5b5',
						}}
					>
						Dev shell
					</p>
					<p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
						{environment.mode === 'mock' ? 'Mock Management API' : 'Live Management API'}
					</p>
				</div>
				<label style={{ display: 'grid', gap: '0.35rem' }}>
					<span style={{ fontSize: '0.8rem', color: '#a8b5b5' }}>Scenario</span>
					<select
						aria-label="Scenario"
						value={scenarioId}
						onChange={(event) => handleScenarioChange(event.target.value)}
						style={{
							borderRadius: '8px',
							border: '1px solid #2a3639',
							padding: '0.55rem 0.7rem',
							background: '#161d20',
							color: '#e3ebeb',
						}}
						disabled={environment.mode !== 'mock'}
					>
						{dashboardDevScenarioOptions.map((scenario) => (
							<option key={scenario.id} value={scenario.id}>
								{scenario.label}
							</option>
						))}
					</select>
				</label>
				<div
					data-testid="scenario-summary"
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
						gap: '0.6rem',
					}}
				>
					<SummaryValue label="Queue Views" value={String(summary.queueViewCount)} />
					<SummaryValue label="Listed Jobs" value={String(summary.jobCount)} />
				</div>
				<p style={{ margin: 0, fontSize: '0.8rem', color: summary.error ? '#fda4af' : '#a8b5b5' }}>
					{summary.error ?? 'Summary calls run through the dashboard oRPC OpenAPI client path.'}
				</p>
			</div>
		</section>
	);
}

function SummaryValue({
	label,
	value,
}: {
	readonly label: string;
	readonly value: string;
}): ReactElement {
	return (
		<div
			style={{
				borderRadius: '8px',
				border: '1px solid #2a3639',
				background: '#111719',
				padding: '0.65rem 0.75rem',
			}}
		>
			<p style={{ margin: 0, fontSize: '0.76rem', color: '#a8b5b5' }}>{label}</p>
			<p style={{ margin: '0.2rem 0 0', fontSize: '1.05rem', fontWeight: 600 }}>{value}</p>
		</div>
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

function getStoredScenarioId(): DashboardDevScenarioId {
	if (typeof window === 'undefined') {
		return getDefaultScenarioId();
	}

	const storedScenarioId = window.localStorage.getItem(LOCAL_STORAGE_SCENARIO_KEY);

	return isDashboardDevScenarioId(storedScenarioId) ? storedScenarioId : getDefaultScenarioId();
}

export { DashboardDevShellApp };
