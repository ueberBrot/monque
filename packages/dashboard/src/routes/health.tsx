import type { CapabilitiesDto, SchedulerHealthDto } from '@monque/management/contract';
import { useQueries } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';

import { listDashboardCapabilityStates } from '@/capabilities';
import { QueryFreshness } from '@/components/query-freshness';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';
import { cn } from '@/lib/utils';
import { type DashboardApiErrorState, resolveDashboardApiErrorState } from '@/management-errors';

export const Route = createFileRoute('/health')({
	component: HealthRoute,
});

const HEALTH_PANEL_CLASS_NAME = 'rounded-lg border border-border bg-card p-5';
const HEALTH_SECTION_LABEL_CLASS_NAME = 'text-sm font-medium text-muted-foreground';
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
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const [healthQuery, capabilitiesQuery] = useQueries({
		queries: [
			{ ...managementApi.orpc.health.queryOptions(), refetchInterval },
			{ ...managementApi.orpc.capabilities.queryOptions(), refetchInterval },
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
			freshness={
				<QueryFreshness
					updatedAt={Math.min(healthQuery.dataUpdatedAt, capabilitiesQuery.dataUpdatedAt)}
					fetching={healthQuery.isFetching || capabilitiesQuery.isFetching}
					paused={
						healthQuery.fetchStatus === 'paused' || capabilitiesQuery.fetchStatus === 'paused'
					}
					pollingIntervalMs={runtimeConfig.pollingIntervalMs}
				/>
			}
			fetching={healthQuery.isFetching || capabilitiesQuery.isFetching}
			onRefresh={() => {
				void healthQuery.refetch();
				void capabilitiesQuery.refetch();
			}}
			health={healthQuery.data}
			capabilities={capabilitiesQuery.data}
			pollingIntervalMs={runtimeConfig.pollingIntervalMs}
		/>
	);
}

function HealthRouteContent({
	freshness,
	fetching,
	onRefresh,
	health,
	capabilities,
	pollingIntervalMs,
}: {
	readonly onRefresh: () => void;
	readonly freshness: ReactNode;
	readonly fetching: boolean;
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
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-2xl font-semibold">Health</h1>
					<div className="flex flex-wrap items-center gap-3">
						{freshness}
						<Button variant="outline" onClick={onRefresh} aria-label="Refresh" aria-busy={fetching}>
							<RefreshCw className="size-4" />
							Refresh
						</Button>
					</div>
				</div>
				<p className="max-w-prose text-sm text-muted-foreground">
					Scheduler status and the actions available to you.
				</p>
			</div>
			<div className="grid gap-4">
				<div className="grid gap-4 lg:grid-cols-3">
					<HealthSummaryCard {...schedulerSummary} />
					<HealthSummaryCard
						title="Management API"
						heading="Management API reachable"
						description="Connected. Health and permissions are available."
						badgeLabel="Reachable"
						badgeVariant="success"
						icon={<RefreshCw className="size-4" />}
					/>
					<HealthSummaryCard {...managementModeSummary} />
				</div>
				<Collapsible className="rounded-lg border border-border bg-card px-5 py-3">
					<CollapsibleTrigger
						render={<Button variant="ghost" className="w-full justify-between" />}
					>
						Connection details{' '}
						<span className="text-xs text-muted-foreground">
							Auto-refresh: {formatPollingInterval(pollingIntervalMs)}
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<dl className="grid gap-3 py-3 text-sm sm:grid-cols-2">
							<HealthDefinition term="Auto-refresh">
								{formatPollingInterval(pollingIntervalMs)}
							</HealthDefinition>
							<HealthDefinition term="Access">
								Your host application manages sign-in and permissions.
							</HealthDefinition>
						</dl>
					</CollapsibleContent>
				</Collapsible>
			</div>
			<HealthPanel>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 className="mt-2 text-lg font-semibold">Action availability</h2>
						<p className="mt-2 max-w-prose text-sm text-muted-foreground">
							Permissions are set by your host application.
						</p>
					</div>
					<Badge variant={availableActionCount === capabilityStates.length ? 'success' : 'warning'}>
						{availableActionCount} of {capabilityStates.length} available
					</Badge>
				</div>
				<ul className="mt-5 grid gap-x-6 sm:grid-cols-2">
					{capabilityStates.map((capability) => (
						<li key={capability.action} className="border-t border-border py-3">
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium">{capability.label}</h3>
									{!capability.available ? (
										<p className="mt-2 text-sm text-muted-foreground">{capability.reason}</p>
									) : null}
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
			<div className="grid gap-4">
				<div className="grid gap-4 lg:grid-cols-3">
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
				<div
					className={cn(
						'rounded-full p-2',
						badgeVariant === 'danger'
							? 'bg-destructive/10 text-destructive'
							: badgeVariant === 'success'
								? 'bg-success/10 text-success'
								: 'bg-muted text-muted-foreground',
					)}
				>
					{icon}
				</div>
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
			heading: 'Read-only access',
			description: 'You can inspect jobs. Changes are disabled.',
			badgeLabel: 'Read only',
			badgeVariant: 'warning',
			icon: <Lock className="size-4" />,
		};
	}

	return {
		title: 'Mode',
		heading: 'Job actions enabled',
		description: 'Your permissions determine which job actions are available.',
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
		return 'Off';
	}

	const seconds = Math.round(pollingIntervalMs / 1_000);
	return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
