import type {
	JobCursorPageDto,
	JobDto,
	QueueStatsDto,
	QueueViewSummaryDto,
} from '@monque/management/contract';
import { Link } from '@tanstack/react-router';
import { Activity, CircleAlert, CircleCheckBig, Clock3, RefreshCw, ServerCog } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { ButtonLink } from '@/components/button-link';
import { JobStatusBadge } from '@/components/job-status-badge';
import { JobTimestamp } from '@/components/job-timestamp';
import { RefreshButton } from '@/components/query-freshness';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { parseJobsRouteSearch } from '@/features/jobs/job-list-search';
import { getOperatorTimeZoneLabel } from '@/lib/dates';
import { getJobRunLabel } from '@/lib/job-detail';
import { cn } from '@/lib/utils';

const OVERVIEW_STATS = [
	{ key: 'pending', label: 'Pending' },
	{ key: 'processing', label: 'Processing' },
	{ key: 'failed', label: 'Failed' },
	{ key: 'total', label: 'Total' },
] as const;

const queueViewSkeletonKeys = ['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4'] as const;

function QueueViewsStatePanel({
	children,
	description,
	title,
}: {
	readonly children?: ReactNode;
	readonly description: string;
	readonly title: string;
}): ReactElement {
	return (
		<section className="grid min-w-0 gap-4">
			<div className="grid gap-2">
				<h1 className="text-2xl font-semibold text-balance">{title}</h1>
				<p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
			</div>
			{children}
		</section>
	);
}

function QueueViewsLoadingState(): ReactElement {
	return (
		<QueueViewsStatePanel
			title="Queue Views"
			description="Loading Queue Views from the Management API."
		>
			<div className="grid gap-3">
				{queueViewSkeletonKeys.map((key) => (
					<div key={key} className="grid gap-3 min-w-0">
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-full max-w-2xl" />
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
							<Skeleton className="h-14" />
							<Skeleton className="h-14" />
							<Skeleton className="h-14" />
							<Skeleton className="h-14" />
						</div>
					</div>
				))}
			</div>
		</QueueViewsStatePanel>
	);
}

function QueueViewsEmptyState(): ReactElement {
	return (
		<QueueViewsStatePanel
			title="Queue Views"
			description="No Queue Views are available yet. Persisted jobs and registered workers will appear here."
		/>
	);
}

function QueueViewsUnauthorizedState({
	heading = 'Queue Views requires sign-in',
	message,
}: {
	readonly heading?: string;
	readonly message: string;
}): ReactElement {
	return (
		<section className="grid gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-6">
			<Badge variant="warning" className="w-fit">
				<CircleAlert className="size-3.5" />
				Unauthorized
			</Badge>
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">{heading}</h1>
				<p className="max-w-2xl text-sm text-muted-foreground">{message}</p>
			</div>
		</section>
	);
}

function QueueViewsErrorState({
	heading,
	message,
	onRetry,
}: {
	readonly heading: string;
	readonly message: string;
	readonly onRetry: () => void;
}): ReactElement {
	return (
		<section className="grid gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-6">
			<Badge variant="danger" className="w-fit">
				<CircleAlert className="size-3.5" />
				Request failed
			</Badge>
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">{heading}</h1>
				<p className="max-w-2xl text-sm text-muted-foreground">{message}</p>
			</div>
			<div>
				<Button type="button" variant="outline" onClick={onRetry}>
					<RefreshCw className="size-4" />
					Retry
				</Button>
			</div>
		</section>
	);
}

function QueueViewsOverview({
	refresh,
	queueViews,
}: {
	readonly queueViews: readonly QueueViewSummaryDto[];
	readonly refresh?: ReactNode;
}): ReactElement {
	return (
		<section className="grid min-w-0 gap-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold">Queue Views</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Jobs grouped by name. Open a view to investigate.
					</p>
				</div>
				<div className="grid gap-2 sm:justify-items-end">
					<span className="text-sm text-muted-foreground">{queueViews.length} job names</span>
					{refresh}
				</div>
			</div>
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				<div className="hidden grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(4rem,1fr))] gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
					<span>Job name</span>
					{OVERVIEW_STATS.map(({ key, label }) => (
						<span key={key} className="text-right">
							{label}
						</span>
					))}
				</div>
				{queueViews.map((view) => (
					<Link
						key={view.name}
						to="/queue-views/$name"
						params={{ name: view.name }}
						className="grid gap-4 border-b border-border px-5 py-3 transition-colors last:border-0 hover:bg-muted/50 md:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(4rem,1fr))] md:items-center"
					>
						<div className="min-w-0">
							<h2 className="break-all text-sm font-semibold">{view.name}</h2>
							<p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
								<ServerCog className="size-3.5" />
								{view.hasRegisteredWorker
									? `${view.worker?.activeCount ?? 0} active · Concurrency ${view.worker?.concurrency ?? 0}`
									: 'Historical only · No registered worker'}
							</p>
						</div>
						<div className="grid grid-cols-4 gap-3 md:contents">
							{OVERVIEW_STATS.map(({ key, label }) => (
								<div key={key} className="md:text-right">
									<span className="mb-1 block text-xs text-muted-foreground md:sr-only">
										{label}
									</span>
									<span
										className={cn(
											'text-sm tabular-nums',
											key === 'failed' && view.stats.failed > 0
												? 'font-semibold text-destructive'
												: 'text-foreground',
										)}
									>
										{view.stats[key]}
									</span>
								</div>
							))}
						</div>
					</Link>
				))}
			</div>
			<p className="text-xs text-muted-foreground">
				Includes registered workers and historical jobs.
			</p>
		</section>
	);
}

function QueueViewDetailHeader({
	name,
	queueView,
	stats,
}: {
	readonly name: string;
	readonly queueView: QueueViewSummaryDto | undefined;
	readonly stats: QueueStatsDto;
}): ReactElement {
	return (
		<section className="grid min-w-0 gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-2xl font-semibold">{name}</h1>
						<Badge variant="outline">Job Name</Badge>
						{queueView?.hasRegisteredWorker ? (
							<Badge variant="success">
								<ServerCog className="size-3.5" />
								Worker registered
							</Badge>
						) : null}
					</div>
					<p className="max-w-3xl text-sm text-muted-foreground">
						Jobs and worker activity for <span className="font-medium text-foreground">{name}</span>
						.
					</p>
				</div>
				<div className="grid gap-1 text-right text-sm text-muted-foreground">
					<span>Persisted jobs: {queueView?.hasPersistedJobs ? 'Yes' : 'No'}</span>
					{!queueView?.hasRegisteredWorker ? <span>No registered worker</span> : null}
				</div>
			</div>
			<QueueStatsGrid stats={stats} />
		</section>
	);
}

function QueueViewJobsTable({
	search,
	freshness,
	jobsPage,
	name,
	onRefresh,
}: {
	readonly jobsPage: JobCursorPageDto;
	readonly freshness?: ReactNode;
	readonly search?: { readonly cursor?: string | undefined; readonly limit?: number | undefined };
	readonly name: string;
	readonly onRefresh: () => void;
}): ReactElement {
	const nextPageCursor = jobsPage.cursor;

	return (
		<section className="grid min-w-0 gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<h2 className="text-lg font-semibold">Filtered jobs</h2>
					<p className="text-sm text-muted-foreground">
						Showing jobs for <span className="font-medium text-foreground">{name}</span>. Times in{' '}
						{getOperatorTimeZoneLabel()}.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{freshness}
					<RefreshButton onRefresh={onRefresh} />
					{jobsPage.hasPreviousPage ? (
						<ButtonLink
							to="/queue-views/$name"
							params={{ name }}
							search={{ limit: search?.limit }}
							variant="outline"
						>
							Back to first page
						</ButtonLink>
					) : null}
				</div>
			</div>
			{jobsPage.jobs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
					No persisted jobs match this Queue View right now.
				</div>
			) : (
				<div className="min-w-0 overflow-x-auto">
					<Table className="min-w-[48rem] table-fixed">
						<TableHeader>
							<TableRow>
								<TableHead className="w-28">Status</TableHead>
								<TableHead className="w-56">Job ID</TableHead>
								<TableHead className="w-56">Next run</TableHead>
								<TableHead className="w-56">Updated</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{jobsPage.jobs.map((job) => (
								<QueueViewJobRow
									key={job.id}
									job={job}
									queueCursor={search?.cursor}
									queueLimit={search?.limit}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
				<p className="text-sm text-muted-foreground">
					{jobsPage.jobs.length} job{jobsPage.jobs.length === 1 ? '' : 's'} on this page
				</p>
				<div className="flex gap-2">
					{jobsPage.hasNextPage && nextPageCursor ? (
						<ButtonLink
							to="/queue-views/$name"
							params={{ name }}
							search={{ limit: search?.limit, cursor: nextPageCursor }}
							variant="outline"
						>
							Next page
						</ButtonLink>
					) : null}
				</div>
			</div>
		</section>
	);
}

function QueueViewJobRow({
	job,
	queueCursor,
	queueLimit,
}: {
	readonly job: JobDto;
	readonly queueCursor: string | undefined;
	readonly queueLimit: number | undefined;
}): ReactElement {
	return (
		<TableRow>
			<TableCell>
				<JobStatusBadge status={job.status} />
			</TableCell>
			<TableCell className="font-mono text-xs">
				<Link
					to="/jobs/$jobId"
					search={{
						...parseJobsRouteSearch({ name: job.name }),
						queueView: job.name,
						queueCursor,
						queueLimit,
					}}
					params={{ jobId: job.id }}
					className="underline decoration-border underline-offset-4 hover:text-primary"
				>
					{job.id}
				</Link>
			</TableCell>
			<TableCell className="text-sm text-muted-foreground">
				<span className="text-xs">{getJobRunLabel(job)}</span>
				<JobTimestamp value={job.nextRunAt} />
			</TableCell>
			<TableCell className="text-sm text-muted-foreground">
				<JobTimestamp value={job.updatedAt} />
			</TableCell>
		</TableRow>
	);
}

function QueueStatsGrid({ stats }: { readonly stats: QueueStatsDto }): ReactElement {
	return (
		<div className="grid grid-cols-3 gap-4 border-y border-border py-4 sm:grid-cols-6">
			<QueueStatCard icon={<Clock3 className="size-4" />} label="Pending" value={stats.pending} />
			<QueueStatCard
				icon={<Activity className="size-4 text-info" />}
				label="Processing"
				value={stats.processing}
			/>
			<QueueStatCard
				icon={<CircleCheckBig className="size-4 text-success" />}
				label="Completed"
				value={stats.completed}
			/>
			<QueueStatCard
				icon={<CircleAlert className="size-4 text-destructive" />}
				label="Failed"
				value={stats.failed}
				highlight={stats.failed > 0}
			/>
			<QueueStatCard label="Cancelled" value={stats.cancelled} />
			<QueueStatCard label="Total" value={stats.total} />
		</div>
	);
}

function QueueStatCard({
	highlight = false,
	icon,
	label,
	value,
}: {
	readonly icon?: ReactNode;
	readonly highlight?: boolean;
	readonly label: string;
	readonly value: number;
}): ReactElement {
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				{icon}
				<span>{label}</span>
			</div>
			<p className={cn('mt-1 text-lg font-semibold', highlight && 'text-destructive')}>{value}</p>
		</div>
	);
}

export {
	QueueViewDetailHeader,
	QueueViewJobsTable,
	QueueViewsEmptyState,
	QueueViewsErrorState,
	QueueViewsLoadingState,
	QueueViewsOverview,
	QueueViewsUnauthorizedState,
};
