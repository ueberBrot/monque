import type {
	JobCursorPageDto,
	JobDto,
	QueueStatsDto,
	QueueViewSummaryDto,
} from '@monque/management/contract';
import { Link } from '@tanstack/react-router';
import { formatDistanceToNowStrict } from 'date-fns';
import { Activity, CircleAlert, CircleCheckBig, Clock3, RefreshCw, ServerCog } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

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
		<section className="grid gap-4 rounded-lg border border-border bg-card p-6">
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
					<div
						key={key}
						className="grid gap-3 rounded-lg border border-border bg-background/70 p-4"
					>
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
	queueViews,
}: {
	readonly queueViews: readonly QueueViewSummaryDto[];
}): ReactElement {
	return (
		<section className="grid gap-4">
			<div className="grid gap-2">
				<h1 className="text-2xl font-semibold text-balance">Queue Views</h1>
				<p className="max-w-3xl text-sm text-muted-foreground">
					Start from job-name groupings, then drill into one queue family for its live summary and
					filtered jobs.
				</p>
			</div>
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				<div className="grid gap-px bg-border">
					{queueViews.map((queueView) => (
						<Link
							key={queueView.name}
							to="/queue-views/$name"
							params={{ name: queueView.name }}
							className="grid gap-4 bg-card p-4 transition-colors hover:bg-muted/40"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="grid gap-2">
									<div className="flex flex-wrap items-center gap-2">
										<h2 className="text-base font-semibold">{queueView.name}</h2>
										{queueView.hasRegisteredWorker ? (
											<Badge variant="success">
												<ServerCog className="size-3.5" />
												Worker registered
											</Badge>
										) : (
											<Badge variant="outline">
												<Clock3 className="size-3.5" />
												Historical only
											</Badge>
										)}
									</div>
									<p className="text-sm text-muted-foreground">
										{getQueueViewDescription(queueView)}
									</p>
								</div>
								<span
									className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}
								>
									Open detail
								</span>
							</div>
							<QueueStatsGrid stats={queueView.stats} />
						</Link>
					))}
				</div>
			</div>
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
		<section className="grid gap-4 rounded-lg border border-border bg-card p-6">
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
						Queue View detail implies the Job Name filter from the route. The table below stays
						scoped to <span className="font-medium text-foreground">{name}</span>.
					</p>
				</div>
				<div className="grid gap-1 text-right text-sm text-muted-foreground">
					<span>Persisted jobs: {queueView?.hasPersistedJobs ? 'Yes' : 'No'}</span>
					<span>Registered worker: {queueView?.hasRegisteredWorker ? 'Yes' : 'No'}</span>
				</div>
			</div>
			<QueueStatsGrid stats={stats} />
		</section>
	);
}

function QueueViewJobsTable({
	jobsPage,
	name,
	onNextPage,
	onResetCursor,
	onRefresh,
}: {
	readonly jobsPage: JobCursorPageDto;
	readonly name: string;
	readonly onNextPage: (cursor: string) => void;
	readonly onRefresh: () => void;
	readonly onResetCursor: () => void;
}): ReactElement {
	const nextPageCursor = jobsPage.cursor;

	return (
		<section className="grid gap-4 rounded-lg border border-border bg-card p-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<h2 className="text-lg font-semibold">Filtered jobs</h2>
					<p className="text-sm text-muted-foreground">
						Showing jobs for <span className="font-medium text-foreground">{name}</span>. The route
						implies the Job Name filter, so there is no duplicate editable name control here.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button type="button" variant="outline" onClick={onRefresh}>
						<RefreshCw className="size-4" />
						Refresh
					</Button>
					{jobsPage.hasPreviousPage ? (
						<Button type="button" variant="outline" onClick={onResetCursor}>
							Back to first page
						</Button>
					) : null}
				</div>
			</div>
			{jobsPage.jobs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
					No persisted jobs match this Queue View right now.
				</div>
			) : (
				<div className="min-w-0 overflow-x-auto">
					<Table className="min-w-[44rem]">
						<TableHeader>
							<TableRow>
								<TableHead>Status</TableHead>
								<TableHead>Job ID</TableHead>
								<TableHead>Next run</TableHead>
								<TableHead>Updated</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{jobsPage.jobs.map((job) => (
								<QueueViewJobRow key={job.id} job={job} />
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
					{nextPageCursor ? (
						<Button type="button" variant="outline" onClick={() => onNextPage(nextPageCursor)}>
							Next page
						</Button>
					) : null}
				</div>
			</div>
		</section>
	);
}

function QueueViewJobRow({ job }: { readonly job: JobDto }): ReactElement {
	return (
		<TableRow>
			<TableCell>
				<JobStatusBadge status={job.status} />
			</TableCell>
			<TableCell className="font-mono text-xs">{job.id}</TableCell>
			<TableCell className="text-sm text-muted-foreground">
				{formatDateTime(job.nextRunAt)}
			</TableCell>
			<TableCell className="text-sm text-muted-foreground">
				{formatDateTime(job.updatedAt)}
			</TableCell>
		</TableRow>
	);
}

function QueueStatsGrid({ stats }: { readonly stats: QueueStatsDto }): ReactElement {
	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
			<QueueStatCard icon={<Clock3 className="size-4" />} label="Pending" value={stats.pending} />
			<QueueStatCard
				icon={<Activity className="size-4" />}
				label="Processing"
				value={stats.processing}
			/>
			<QueueStatCard
				icon={<CircleCheckBig className="size-4" />}
				label="Completed"
				value={stats.completed}
			/>
			<QueueStatCard
				icon={<CircleAlert className="size-4" />}
				label="Failed"
				value={stats.failed}
			/>
			<QueueStatCard label="Cancelled" value={stats.cancelled} />
			<QueueStatCard label="Total" value={stats.total} />
		</div>
	);
}

function QueueStatCard({
	icon,
	label,
	value,
}: {
	readonly icon?: ReactNode;
	readonly label: string;
	readonly value: number;
}): ReactElement {
	return (
		<div className="rounded-lg border border-border bg-background/70 p-4">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				{icon}
				<span>{label}</span>
			</div>
			<p className="mt-3 text-2xl font-semibold">{value}</p>
		</div>
	);
}

function JobStatusBadge({ status }: { readonly status: JobDto['status'] }): ReactElement {
	switch (status) {
		case 'pending':
			return <Badge variant="outline">Pending</Badge>;
		case 'processing':
			return <Badge variant="warning">Processing</Badge>;
		case 'completed':
			return <Badge variant="success">Completed</Badge>;
		case 'failed':
			return <Badge variant="danger">Failed</Badge>;
		case 'cancelled':
			return <Badge variant="outline">Cancelled</Badge>;
	}
}

function getQueueViewDescription(queueView: QueueViewSummaryDto): string {
	const workerText = queueView.hasRegisteredWorker
		? `Concurrency ${queueView.worker?.concurrency ?? 0}, ${queueView.worker?.activeCount ?? 0} active workers.`
		: 'No registered worker on this scheduler.';

	return `${queueView.stats.total} tracked jobs. ${workerText}`;
}

function formatDateTime(value: string): string {
	const date = new Date(value);

	return `${date.toLocaleString('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC',
	})} (${formatDistanceToNowStrict(date, { addSuffix: true })})`;
}

function getQueryErrorMessage(error: unknown, fallback: string): string {
	const unauthorizedMessage = getUnauthorizedQueryErrorMessage(error);

	if (unauthorizedMessage) {
		return unauthorizedMessage;
	}

	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}

	return fallback;
}

function isUnauthorizedQueryError(error: unknown): boolean {
	return getRecordValue(error, 'status') === 401;
}

function getUnauthorizedQueryErrorMessage(error: unknown): string | undefined {
	if (!isUnauthorizedQueryError(error)) {
		return undefined;
	}

	const data = getRecordValue(error, 'data');
	const body = getRecordValue(data, 'body');
	const message = getRecordValue(body, 'error');

	if (typeof message === 'string' && message.length > 0) {
		return message;
	}

	return undefined;
}

function getRecordValue(value: unknown, key: string): unknown {
	if (!isRecord(value)) {
		return undefined;
	}

	return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export {
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	QueueViewDetailHeader,
	QueueViewJobsTable,
	QueueViewsEmptyState,
	QueueViewsErrorState,
	QueueViewsLoadingState,
	QueueViewsOverview,
	QueueViewsUnauthorizedState,
};
