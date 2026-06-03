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
import type { CSSProperties, ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	formatDashboardDate,
	formatPayloadForDisplay,
	getJobAttemptCount,
	getOperatorTimeZoneLabel,
	isEmptyPayload,
	isStructuredPayload,
	type JobDetailState,
} from '@/lib/job-detail';
import { cn } from '@/lib/utils';

type JobDetailViewProps = {
	readonly job: JobDto;
	readonly onCopyJobId: () => void;
	readonly onCopyPayload: () => void;
	readonly onCopyShareableUrl: () => void;
};

type MetadataItem = readonly [label: string, value: string];

type JobStatusMeta = {
	readonly badgeVariant: 'danger' | 'default' | 'outline' | 'success' | 'warning';
	readonly icon: LucideIcon;
	readonly label: string;
};

function JobDetailView({
	job,
	onCopyJobId,
	onCopyPayload,
	onCopyShareableUrl,
}: JobDetailViewProps): ReactElement {
	const statusMeta = getJobStatusMeta(job.status);
	const StatusIcon = statusMeta.icon;
	const operatorTimeZone = getOperatorTimeZoneLabel();
	const lifecycleItems = getLifecycleMetadataItems(job);
	const schedulingItems = getSchedulingMetadataItems(job);

	return (
		<section className="grid gap-6">
			<header className="grid gap-4 rounded-xl border border-border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
				<div className="grid min-w-0 gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<Badge variant={statusMeta.badgeVariant} className="h-7 gap-1.5 px-2.5 text-[0.78rem]">
							<StatusIcon className="size-3.5" />
							<span>{statusMeta.label}</span>
						</Badge>
						<span className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
							Job detail
						</span>
					</div>
					<div className="grid gap-2">
						<h1 className="text-2xl font-semibold text-balance">{job.name}</h1>
						<p className="break-all font-mono text-xs text-muted-foreground">{job.id}</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2 lg:justify-end">
					<Button type="button" variant="outline" size="sm" onClick={onCopyJobId}>
						<Copy />
						<span>Copy job ID</span>
					</Button>
					<Button type="button" variant="outline" size="sm" onClick={onCopyPayload}>
						<Copy />
						<span>Copy payload</span>
					</Button>
					<Button type="button" variant="outline" size="sm" onClick={onCopyShareableUrl}>
						<Copy />
						<span>Copy shareable URL</span>
					</Button>
				</div>
			</header>

			<section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<SummaryTile label="Attempts" value={String(getJobAttemptCount(job.failCount))} />
				<SummaryTile label="Failed attempts" value={String(job.failCount)} />
				<SummaryTile label="Next run" value={formatDashboardDate(job.nextRunAt)} />
				<SummaryTile
					label="Schedule"
					value={job.repeatInterval ?? 'One-time job'}
					className="font-mono text-xs"
				/>
			</section>

			<div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
				<div className="grid gap-6">
					<section className="grid gap-4 rounded-xl border border-border bg-card p-5">
						<div className="grid gap-1">
							<h2 className="text-sm font-semibold">Payload</h2>
							<p className="max-w-prose text-sm text-muted-foreground">
								Read-only Management serialization output. No Dashboard redaction is applied here.
							</p>
						</div>
						{renderPayload(job.payload)}
					</section>

					{job.failureReason ? (
						<section className="grid gap-3 rounded-xl border border-destructive/25 bg-destructive/8 p-5">
							<div className="flex items-center gap-2 text-sm font-semibold text-destructive">
								<AlertTriangle className="size-4" />
								<span>Failure reason</span>
							</div>
							<p className="text-sm text-foreground">{job.failureReason}</p>
						</section>
					) : null}
				</div>

				<aside className="grid gap-6">
					<section className="grid gap-4 rounded-xl border border-border bg-card p-5">
						<div className="grid gap-1">
							<h2 className="text-sm font-semibold">Lifecycle</h2>
							<p className="text-sm text-muted-foreground">
								Timestamps render in operator local time: {operatorTimeZone}.
							</p>
						</div>
						<MetadataList items={lifecycleItems} />
					</section>

					<section className="grid gap-4 rounded-xl border border-border bg-card p-5">
						<div className="grid gap-1">
							<h2 className="text-sm font-semibold">Scheduling</h2>
							<p className="text-sm text-muted-foreground">
								Operational identifiers and scheduler metadata for this persisted Job.
							</p>
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
				<p className="text-[0.72rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
					Job detail
				</p>
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
				No payload value was provided by the Management serialization output.
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
	readonly value: string;
	readonly className?: string;
}): ReactElement {
	return (
		<div className="min-w-0 rounded-xl border border-border bg-card px-4 py-4">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<p className={cn('mt-2 break-words text-sm font-semibold text-foreground', className)}>
				{value}
			</p>
		</div>
	);
}

function MetadataList({ items }: { readonly items: readonly MetadataItem[] }): ReactElement {
	return (
		<dl className="divide-y divide-border/70 rounded-lg border border-border bg-background/45">
			{items.map(([label, value]) => (
				<div key={label} className="grid min-w-0 gap-1 px-3 py-3">
					<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
					<dd className="break-words font-mono text-xs text-foreground">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function getLifecycleMetadataItems(job: JobDto): readonly MetadataItem[] {
	return [
		['Created', formatDashboardDate(job.createdAt)],
		['Updated', formatDashboardDate(job.updatedAt)],
		['Locked', formatDashboardDate(job.lockedAt)],
		['Last heartbeat', formatDashboardDate(job.lastHeartbeat)],
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
				badgeVariant: 'warning',
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
				badgeVariant: 'default',
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
