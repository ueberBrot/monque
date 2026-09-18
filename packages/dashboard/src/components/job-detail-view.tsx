import type { JobDto } from '@monque/management/contract';
import JsonView from '@uiw/react-json-view';
import {
	AlertTriangle,
	CalendarClock,
	CheckCircle2,
	CircleX,
	Clock3,
	Copy,
	type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { JobTimestamp } from '@/components/job-timestamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getOperatorTimeZoneLabel } from '@/lib/dates';
import {
	formatPayloadForDisplay,
	getJobAttemptCount,
	getJobRunLabel,
	isEmptyPayload,
	isStructuredPayload,
	type JobDetailState,
} from '@/lib/job-detail';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

type JobDetailViewProps = {
	readonly actions?: ReactElement;
	readonly job: JobDto;
	readonly onCopyJobId: () => void;
	readonly onCopyPayload: () => void;
	readonly onCopyShareableUrl: () => void;
};

type MetadataItem = readonly [label: string, value: ReactNode];

type JobStatusMeta = {
	readonly badgeVariant: 'danger' | 'info' | 'outline' | 'success';
	readonly icon: LucideIcon;
	readonly label: string;
};

function JobDetailView({
	actions,
	job,
	onCopyJobId,
	onCopyPayload,
	onCopyShareableUrl,
}: JobDetailViewProps): ReactElement {
	const statusMeta = getJobStatusMeta(job.status);
	const StatusIcon = statusMeta.icon;
	const operatorTimeZone = getOperatorTimeZoneLabel();
	const now = useNow();
	const lifecycleItems = getLifecycleMetadataItems(job, now);
	const schedulingItems = getSchedulingMetadataItems(job);

	return (
		<section className="grid min-w-0 gap-6">
			<header className="grid min-w-0 gap-4">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="break-all text-2xl font-semibold text-balance">{job.name}</h1>
					<Badge variant={statusMeta.badgeVariant} className="h-7 gap-1.5 px-2.5">
						<StatusIcon className="size-3.5" />
						{statusMeta.label}
					</Badge>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<p className="break-all font-mono text-xs text-muted-foreground">{job.id}</p>
					<Button type="button" variant="ghost" size="sm" onClick={onCopyJobId}>
						<Copy />
						Copy job ID
					</Button>
					<Button type="button" variant="ghost" size="sm" onClick={onCopyShareableUrl}>
						<Copy />
						Copy shareable URL
					</Button>
				</div>
				{job.failureReason ? (
					<section className="grid gap-2 rounded-xl border border-destructive/25 bg-destructive/8 p-4">
						<h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
							<AlertTriangle className="size-4" />
							{job.status === 'failed' ? 'Failure reason' : 'Last failure'}
						</h2>
						<p className="break-words text-sm">{job.failureReason}</p>
					</section>
				) : null}
				<div className="flex flex-wrap items-center gap-2">{actions}</div>
			</header>

			<section className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4 xl:grid-cols-4">
				<SummaryTile label="Attempts" value={String(getJobAttemptCount(job.failCount))} />
				<SummaryTile label="Failed attempts" value={String(job.failCount)} />
				<SummaryTile
					label={getJobRunLabel(job)}
					value={<JobTimestamp value={job.nextRunAt} now={now} />}
				/>
				<SummaryTile
					label="Schedule"
					value={job.repeatInterval ?? 'One-time job'}
					className="font-mono text-xs"
				/>
			</section>

			<div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
				<div className="grid min-w-0 gap-6">
					<section className="grid gap-4 rounded-xl border border-border bg-card p-5">
						<div className="grid gap-1">
							<div className="flex items-center justify-between gap-2">
								<h2 className="text-sm font-semibold">Payload</h2>
								<Button type="button" variant="ghost" size="sm" onClick={onCopyPayload}>
									<Copy />
									Copy payload
								</Button>
							</div>
							<p className="max-w-prose text-sm text-muted-foreground">Read-only job data.</p>
						</div>
						{renderPayload(job.payload)}
					</section>
				</div>

				<aside className="grid min-w-0 gap-6">
					<section className="grid gap-4 rounded-xl border border-border bg-card p-5">
						<div className="grid gap-1">
							<h2 className="text-sm font-semibold">Lifecycle</h2>
							<p className="text-sm text-muted-foreground">Local time: {operatorTimeZone}.</p>
						</div>
						<MetadataList items={lifecycleItems} />
					</section>

					<section className="grid gap-4 rounded-xl border border-border bg-card p-5">
						<div className="grid gap-1">
							<h2 className="text-sm font-semibold">Scheduling</h2>
							<p className="text-sm text-muted-foreground">Identifiers and recurring schedule.</p>
						</div>
						<MetadataList items={schedulingItems} />
					</section>
				</aside>
			</div>
		</section>
	);
}

function JobDetailStateView({ state }: { readonly state: JobDetailState }): ReactElement {
	const toneClassName = getJobDetailStateToneClassName(state.code);

	return (
		<section className={cn('grid gap-3 rounded-xl border p-6', toneClassName)}>
			<div className="grid gap-2">
				<h1 className="text-xl font-semibold">{state.title}</h1>
			</div>
			<p className="max-w-prose text-sm text-muted-foreground">{state.description}</p>
		</section>
	);
}

function renderPayload(payload: unknown): ReactElement {
	if (isEmptyPayload(payload)) {
		return (
			<div className="rounded-lg border border-dashed border-border bg-background/60 px-4 py-6 text-sm text-muted-foreground">
				This job has no payload.
			</div>
		);
	}

	if (isStructuredPayload(payload)) {
		return (
			<div className="max-w-full overflow-x-auto rounded-lg border border-border bg-background/70 p-3">
				<JsonView
					value={payload}
					displayDataTypes={false}
					enableClipboard={false}
					style={jsonViewTheme}
				/>
			</div>
		);
	}

	return (
		<pre className="overflow-x-auto rounded-lg border border-border bg-background/70 p-3 font-mono text-xs text-foreground">
			{formatPayloadForDisplay(payload)}
		</pre>
	);
}

function SummaryTile({
	label,
	value,
	className,
}: {
	readonly label: string;
	readonly value: ReactNode;
	readonly className?: string;
}): ReactElement {
	return (
		<div className="min-w-0">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<div className={cn('mt-1 break-words text-sm font-semibold text-foreground', className)}>
				{value}
			</div>
		</div>
	);
}

function MetadataList({ items }: { readonly items: readonly MetadataItem[] }): ReactElement {
	return (
		<dl className="divide-y divide-border/70">
			{items.map(([label, value]) => (
				<div key={label} className="grid min-w-0 gap-1 py-3 first:pt-0 last:pb-0">
					<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
					<dd className="break-words font-mono text-xs text-foreground">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function getLifecycleMetadataItems(job: JobDto, now: Date): readonly MetadataItem[] {
	return [
		['Created', <JobTimestamp key="createdAt" value={job.createdAt} now={now} />],
		['Updated', <JobTimestamp key="updatedAt" value={job.updatedAt} now={now} />],
		['Locked', <JobTimestamp key="lockedAt" value={job.lockedAt} now={now} />],
		['Last heartbeat', <JobTimestamp key="lastHeartbeat" value={job.lastHeartbeat} now={now} />],
		['Heartbeat interval', job.heartbeatInterval ? `${job.heartbeatInterval} ms` : 'Not set'],
	];
}

function getSchedulingMetadataItems(job: JobDto): readonly MetadataItem[] {
	return [
		['Claimed by', job.claimedBy ?? 'Unclaimed'],
		['Repeat interval', job.repeatInterval ?? 'One-time job'],
		['Unique key', job.uniqueKey ?? 'Not set'],
	];
}

function getJobDetailStateToneClassName(code: JobDetailState['code']): string {
	if (code === 'error') {
		return 'border-destructive/25 bg-destructive/8 text-foreground';
	}

	return 'border-border bg-card text-foreground';
}

function getJobStatusMeta(status: JobDto['status']): JobStatusMeta {
	switch (status) {
		case 'completed':
			return {
				badgeVariant: 'success',
				icon: CheckCircle2,
				label: 'Completed',
			};
		case 'failed':
			return {
				badgeVariant: 'danger',
				icon: AlertTriangle,
				label: 'Failed',
			};
		case 'processing':
			return {
				badgeVariant: 'info',
				icon: Clock3,
				label: 'Processing',
			};
		case 'cancelled':
			return {
				badgeVariant: 'outline',
				icon: CircleX,
				label: 'Cancelled',
			};
		default:
			return {
				badgeVariant: 'outline',
				icon: CalendarClock,
				label: 'Pending',
			};
	}
}

const jsonViewTheme = {
	'--w-rjv-add-color': 'var(--foreground)',
	'--w-rjv-arrow-color': 'var(--muted-foreground)',
	'--w-rjv-background-color': 'transparent',
	'--w-rjv-color': 'var(--foreground)',
	'--w-rjv-curlybraces-color': 'var(--muted-foreground)',
	'--w-rjv-font-family': 'var(--font-mono)',
	'--w-rjv-info-color': 'var(--muted-foreground)',
	'--w-rjv-line-color': 'var(--border)',
	'--w-rjv-type-boolean-color': 'var(--foreground)',
	'--w-rjv-type-date-color': 'var(--foreground)',
	'--w-rjv-type-float-color': 'var(--foreground)',
	'--w-rjv-type-int-color': 'var(--foreground)',
	'--w-rjv-type-null-color': 'var(--muted-foreground)',
	'--w-rjv-type-string-color': 'var(--foreground)',
	'--w-rjv-type-url-color': 'var(--foreground)',
	'--w-rjv-update-color': 'var(--foreground)',
} as CSSProperties;

export { JobDetailStateView, JobDetailView };
