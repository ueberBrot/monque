import type { JobDto } from '@monque/management/contract';
import JsonView from '@uiw/react-json-view';
import { AlertTriangle, ChevronDown, Copy } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from 'react';

import { JobStatusBadge } from '@/components/job-status-badge';
import { JobTimestamp } from '@/components/job-timestamp';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { getOperatorTimeZoneLabel } from '@/lib/dates';
import {
	formatPayloadForDisplay,
	getJobAttemptCount,
	getJobRunLabel,
	isEmptyPayload,
	isStructuredPayload,
	type JobDetailState,
	serializePayloadForClipboard,
} from '@/lib/job-detail';
import { cn } from '@/lib/utils';

type JobDetailViewProps = {
	readonly actions?: ReactElement;
	readonly job: JobDto;
};

type MetadataItem = readonly [label: string, value: ReactNode];
const MAX_INITIAL_PAYLOAD_ENTRIES = 100;

function JobDetailView({ actions, job }: JobDetailViewProps): ReactElement {
	const operatorTimeZone = getOperatorTimeZoneLabel();
	const lifecycleItems = getLifecycleMetadataItems(job);
	const schedulingItems = getSchedulingMetadataItems(job);

	return (
		<section className="grid min-w-0 gap-6">
			<header className="grid min-w-0 gap-4">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="break-all text-2xl font-semibold text-balance">{job.name}</h1>
					<JobStatusBadge status={job.status} withIcon />
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<p className="break-all font-mono text-xs text-muted-foreground">{job.id}</p>
					<CopyButton label="Copy job ID" getText={() => job.id} />
					<CopyButton label="Copy shareable URL" getText={() => window.location.href} />
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
				<SummaryTile label="Attempts since reset" value={String(getJobAttemptCount(job))} />
				<SummaryTile label="Failed attempts" value={String(job.failCount)} />
				<SummaryTile label={getJobRunLabel(job)} value={<JobTimestamp value={job.nextRunAt} />} />
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
								<CopyButton
									label="Copy payload"
									getText={() => serializePayloadForClipboard(job.payload)}
								/>
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

function CopyButton({
	label,
	getText,
}: {
	readonly label: string;
	readonly getText: () => string;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onClick={() => {
				void copyToClipboard(getText());
			}}
		>
			<Copy />
			{label}
		</Button>
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
					collapsed={Object.keys(payload).length > MAX_INITIAL_PAYLOAD_ENTRIES ? 0 : 1}
					components={jsonViewComponents}
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

function JsonExpandButton({
	'data-expand': expanded = false,
	className,
	...props
}: ComponentProps<'button'> & { readonly 'data-expand'?: boolean }) {
	return (
		<button
			{...props}
			type="button"
			aria-expanded={expanded}
			aria-label={expanded ? 'Collapse JSON value' : 'Expand JSON value'}
			className={cn('mr-1 rounded focus-visible:outline-2 focus-visible:outline-ring', className)}
		>
			<ChevronDown className="size-3" />
		</button>
	);
}

const jsonViewComponents = { arrow: <JsonExpandButton /> };

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

function getLifecycleMetadataItems(job: JobDto): readonly MetadataItem[] {
	return [
		['Created', <JobTimestamp key="createdAt" value={job.createdAt} />],
		['Updated', <JobTimestamp key="updatedAt" value={job.updatedAt} />],
		['Locked', <JobTimestamp key="lockedAt" value={job.lockedAt} />],
		['Last heartbeat', <JobTimestamp key="lastHeartbeat" value={job.lastHeartbeat} />],
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
