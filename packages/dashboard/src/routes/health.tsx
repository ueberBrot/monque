import type { CapabilitiesDto, SchedulerHealthDto } from '@monque/management/contract';
import { useQueries } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Lock, RefreshCcw, ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';

import { listDashboardCapabilityStates } from '@/capabilities';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { type DashboardApiErrorState, resolveDashboardApiErrorState } from '@/management-errors';

export const Route = createFileRoute('/health')({
	component: HealthRoute,
});

const HEALTH_PANEL_CLASS_NAME = 'rounded-lg border border-border bg-card p-5';
const HEALTH_SECTION_LABEL_CLASS_NAME =
	'text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase';
const SUMMARY_SKELETON_CARD_COUNT = 3;

type HealthSummaryCardProps = {
	readonly title: string;
	readonly heading: string;
	readonly description: string;
	readonly badgeLabel: string;
	readonly badgeVariant: 'danger' | 'outline' | 'success' | 'warning';
	readonly icon: ReactNode;
};

function HealthRoute() {
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const [healthQuery, capabilitiesQuery] = useQueries({
		queries: [
			managementApi.orpc.health.queryOptions(),
			managementApi.orpc.capabilities.queryOptions(),
		],
	});
	const error = healthQuery.error ?? capabilitiesQuery.error;

	if (error) {
		return <HealthRouteErrorState error={error} />;
	}

	if (healthQuery.isPending || capabilitiesQuery.isPending) {
		return <HealthRoutePendingState />;
	}

	if (!healthQuery.data || !capabilitiesQuery.data) {
		return <HealthRoutePendingState />;
	}

	return (
		<HealthRouteContent
			health={healthQuery.data}
			capabilities={capabilitiesQuery.data}
			pollingIntervalMs={runtimeConfig.pollingIntervalMs}
		/>
	);
}

function HealthRouteContent({
	health,
	capabilities,
	pollingIntervalMs,
}: {
	readonly health: SchedulerHealthDto;
	readonly capabilities: CapabilitiesDto;
	readonly pollingIntervalMs: number | undefined;
}) {
	const capabilityStates = listDashboardCapabilityStates(capabilities);
	const availableActionCount = capabilityStates.filter((capability) => capability.available).length;
	const schedulerSummary = getSchedulerSummary(health);
	const managementModeSummary = getManagementModeSummary(capabilities);

	return (
		<section className="grid gap-6">
			<div className="grid gap-2">
				<h1 className="text-2xl font-semibold">Health</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					Scheduler health, Management reachability, and capability state for the current operator
					session.
				</p>
			</div>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					<HealthSummaryCard {...schedulerSummary} />
					<HealthSummaryCard
						title="Management API"
						heading="Management API reachable"
						description="Health and capabilities were fetched from the typed Management contract."
						badgeLabel="Reachable"
						badgeVariant="success"
						icon={<RefreshCcw className="size-4" />}
					/>
					<HealthSummaryCard {...managementModeSummary} />
				</div>
				<HealthPanel>
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className={HEALTH_SECTION_LABEL_CLASS_NAME}>Runtime</p>
							<h2 className="mt-2 text-lg font-semibold">Client settings</h2>
						</div>
						<Badge variant="outline">Polling aware</Badge>
					</div>
					<dl className="mt-4 grid gap-3 text-sm">
						<HealthDefinition term="Polling interval">
							{formatPollingInterval(pollingIntervalMs)}
						</HealthDefinition>
						<HealthDefinition term="Auth model">
							Host-owned session auth, browser credentials included by default.
						</HealthDefinition>
						<HealthDefinition term="Login surface">No Dashboard login screen.</HealthDefinition>
					</dl>
				</HealthPanel>
			</div>
			<HealthPanel>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p className={HEALTH_SECTION_LABEL_CLASS_NAME}>Capabilities</p>
						<h2 className="mt-2 text-lg font-semibold">Action availability</h2>
						<p className="mt-2 max-w-prose text-sm text-muted-foreground">
							Downstream UI should read these capability states instead of hardcoding which actions
							exist.
						</p>
					</div>
					<Badge variant={availableActionCount === capabilityStates.length ? 'success' : 'warning'}>
						{availableActionCount} of {capabilityStates.length} available
					</Badge>
				</div>
				<ul className="mt-5 grid gap-3 sm:grid-cols-2">
					{capabilityStates.map((capability) => (
						<li
							key={capability.action}
							className="rounded-lg border border-border bg-background/80 p-4"
						>
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium">{capability.label}</h3>
									<p className="mt-2 text-sm text-muted-foreground">{capability.reason}</p>
								</div>
								<Badge variant={capability.available ? 'success' : 'outline'}>
									{capability.available ? 'Available' : 'Unavailable'}
								</Badge>
							</div>
						</li>
					))}
				</ul>
			</HealthPanel>
		</section>
	);
}

function HealthRoutePendingState() {
	return (
		<section className="grid gap-6">
			<div className="grid gap-2">
				<Skeleton className="h-8 w-24" />
				<Skeleton className="h-4 w-[24rem] max-w-full" />
			</div>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{Array.from({ length: SUMMARY_SKELETON_CARD_COUNT }, (_, index) => (
						<HealthPanel key={String(index)}>
							<Skeleton className="h-4 w-20" />
							<Skeleton className="mt-4 h-6 w-40" />
							<Skeleton className="mt-3 h-4 w-full" />
						</HealthPanel>
					))}
				</div>
				<HealthPanel>
					<Skeleton className="h-4 w-20" />
					<Skeleton className="mt-4 h-5 w-36" />
					<Skeleton className="mt-4 h-4 w-full" />
					<Skeleton className="mt-2 h-4 w-3/4" />
				</HealthPanel>
			</div>
		</section>
	);
}

function HealthRouteErrorState({ error }: { readonly error: unknown }) {
	const state = resolveDashboardApiErrorState(error);
	const presentation = getErrorTonePresentation(state.tone);

	return (
		<section className={cn('rounded-lg border p-6', presentation.className)}>
			<div className="flex items-start gap-3">
				{presentation.icon}
				<div className="grid gap-2">
					<h1 className="text-lg font-semibold">{state.title}</h1>
					<p className="max-w-prose text-sm">{state.description}</p>
				</div>
			</div>
		</section>
	);
}

function HealthSummaryCard({
	title,
	heading,
	description,
	badgeLabel,
	badgeVariant,
	icon,
}: HealthSummaryCardProps) {
	return (
		<HealthPanel>
			<div className="flex items-center justify-between gap-3">
				<p className={HEALTH_SECTION_LABEL_CLASS_NAME}>{title}</p>
				<Badge variant={badgeVariant}>{badgeLabel}</Badge>
			</div>
			<div className="mt-4 flex items-start gap-3">
				<div className="rounded-full bg-primary/10 p-2 text-primary">{icon}</div>
				<div>
					<h2 className="text-base font-semibold">{heading}</h2>
					<p className="mt-2 text-sm text-muted-foreground">{description}</p>
				</div>
			</div>
		</HealthPanel>
	);
}

function HealthPanel({
	children,
	className,
}: {
	readonly children: ReactNode;
	readonly className?: string;
}) {
	return <section className={cn(HEALTH_PANEL_CLASS_NAME, className)}>{children}</section>;
}

function HealthDefinition({
	term,
	children,
}: {
	readonly term: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="grid gap-1">
			<dt className={HEALTH_SECTION_LABEL_CLASS_NAME}>{term}</dt>
			<dd className="text-sm">{children}</dd>
		</div>
	);
}

function getSchedulerSummary(health: SchedulerHealthDto): HealthSummaryCardProps {
	if (health.scheduler.healthy) {
		return {
			title: 'Scheduler',
			heading: 'Scheduler healthy',
			description: 'The scheduler reports healthy state.',
			badgeLabel: health.status === 'ok' ? 'Healthy' : 'Unavailable',
			badgeVariant: health.status === 'ok' ? 'success' : 'danger',
			icon: <CheckCircle2 className="size-4" />,
		};
	}

	return {
		title: 'Scheduler',
		heading: 'Scheduler unavailable',
		description: 'The scheduler reports an unavailable state.',
		badgeLabel: health.status === 'ok' ? 'Healthy' : 'Unavailable',
		badgeVariant: health.status === 'ok' ? 'success' : 'danger',
		icon: <AlertTriangle className="size-4" />,
	};
}

function getManagementModeSummary(capabilities: CapabilitiesDto): HealthSummaryCardProps {
	if (capabilities.readOnly) {
		return {
			title: 'Mode',
			heading: 'Read-only Management surface',
			description: 'Read routes remain available. Mutation actions stay visible but disabled.',
			badgeLabel: 'Read only',
			badgeVariant: 'warning',
			icon: <Lock className="size-4" />,
		};
	}

	return {
		title: 'Mode',
		heading: 'Writable Management surface',
		description: 'Read and supported mutation actions are available for this surface.',
		badgeLabel: 'Writable',
		badgeVariant: 'outline',
		icon: <Lock className="size-4" />,
	};
}

function getErrorTonePresentation(tone: DashboardApiErrorState['tone']): {
	readonly className: string;
	readonly icon: ReactNode;
} {
	switch (tone) {
		case 'warning':
			return {
				className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
				icon: <AlertTriangle className="mt-0.5 size-4 shrink-0" />,
			};
		case 'danger':
			return {
				className: 'border-destructive/30 bg-destructive/10 text-destructive',
				icon: <ShieldX className="mt-0.5 size-4 shrink-0" />,
			};
	}
}

function formatPollingInterval(pollingIntervalMs: number | undefined): string {
	if (typeof pollingIntervalMs !== 'number') {
		return 'Not configured';
	}

	return `${Math.round(pollingIntervalMs / 1_000)} seconds`;
}
