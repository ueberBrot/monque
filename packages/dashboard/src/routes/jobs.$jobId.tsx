import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { JobDetailStateView, JobDetailView } from '@/components/job-detail-view';
import { QueryFreshness } from '@/components/query-freshness';
import { Button } from '@/components/ui/button';
import { JobActionDialog, type JobActionDialogState } from '@/features/jobs/job-action-dialog';
import { JobActionFeedbackPanel } from '@/features/jobs/job-action-feedback-panel';
import { JobActionHelp } from '@/features/jobs/job-action-help';
import { jobActionMutationOptions } from '@/features/jobs/job-action-mutation';
import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getJobActionAvailability,
	JOB_ACTION_DEFINITIONS,
	JOB_ACTION_ORDER,
	type JobActionRequest,
	prepareSingleJobAction,
} from '@/features/jobs/job-actions';
import { parseJobsRouteSearch } from '@/features/jobs/job-list-search';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';
import { mapJobDetailError } from '@/lib/job-detail';

export const Route = createFileRoute('/jobs/$jobId')({
	component: JobDetailRoute,
	validateSearch: z.object({
		queueView: z.string().optional(),
		queueCursor: z.string().optional(),
		queueLimit: z.coerce.number().int().min(1).max(100).optional(),
	}).parse,
});

function JobDetailRoute() {
	const { jobId } = Route.useParams();
	return <JobDetail key={jobId} jobId={jobId} />;
}

function JobDetail({ jobId }: { readonly jobId: string }) {
	const { managementApi, queryClient, runtimeConfig } = Route.useRouteContext();
	const search = Route.useSearch();
	const backLink = search.queueView
		? {
				to: '/queue-views/$name' as const,
				params: { name: search.queueView },
				search: { cursor: search.queueCursor, limit: search.queueLimit },
			}
		: { to: '/jobs' as const, search: parseJobsRouteSearch(search) };
	const navigate = Route.useNavigate();
	const router = useRouter();
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const jobQuery = useQuery({
		...managementApi.orpc.job.queryOptions({ input: { params: { id: jobId } } }),
		refetchInterval,
	});
	const capabilitiesInterval = useDocumentVisiblePollingInterval(
		runtimeConfig.pollingIntervalMs,
		6,
	);
	const capabilitiesQuery = useQuery({
		...managementApi.orpc.capabilities.queryOptions(),
		refetchInterval: capabilitiesInterval,
	});

	const mutation = useMutation({
		...jobActionMutationOptions(managementApi, queryClient),
		onMutate: () => router.state.location,
		onSuccess: async ({ action }, _input, origin) => {
			const success = getActionSuccessFeedback(action);
			toast.success(success.title, { description: success.description });
			if (action !== 'delete' || router.state.location !== origin) return;
			await navigate({ ...backLink, replace: true });
		},
	});

	if (jobQuery.isPending) {
		return <JobDetailPending />;
	}

	if (jobQuery.isError) {
		return <JobDetailStateView state={mapJobDetailError(jobQuery.error)} />;
	}

	const job = jobQuery.data;
	const feedback = mutation.error ? getActionErrorFeedback(mutation.error) : null;

	return (
		<section className="grid min-w-0 gap-4">
			<Link {...backLink} className="w-fit text-sm text-muted-foreground hover:text-primary">
				← Back to {search.queueView || 'jobs'}
			</Link>
			{feedback ? (
				<JobActionFeedbackPanel
					feedback={feedback}
					onDismiss={() => mutation.reset()}
					className="rounded-xl border border-border px-5 py-4"
				/>
			) : null}
			<QueryFreshness
				updatedAt={jobQuery.dataUpdatedAt}
				fetching={jobQuery.isFetching}
				paused={jobQuery.fetchStatus === 'paused'}
				pollingIntervalMs={runtimeConfig.pollingIntervalMs}
			/>
			<JobDetailView
				job={job}
				actions={
					<JobDetailActions
						job={job}
						busy={mutation.isPending}
						capabilities={capabilitiesQuery.isError ? undefined : capabilitiesQuery.data}
						onRunAction={(input) => {
							mutation.mutate({ ...input, jobIds: [jobId] });
						}}
					/>
				}
			/>
		</section>
	);
}

function JobDetailActions({
	busy,
	capabilities,
	job,
	onRunAction,
}: {
	readonly busy: boolean;
	readonly capabilities: CapabilitiesDto | undefined;
	readonly job: JobDto;
	readonly onRunAction: (input: JobActionRequest) => void;
}) {
	const actions = JOB_ACTION_ORDER.map((action) => ({
		action,
		label: JOB_ACTION_DEFINITIONS[action].label,
		...getJobActionAvailability(job, capabilities, action),
	}));

	const [state, setState] = useState<JobActionDialogState | null>(null);
	return (
		<>
			{actions.map(({ action, label, disabled, reason }) => (
				<Button
					key={action}
					variant={action === 'delete' ? 'destructive' : 'outline'}
					size="sm"
					onClick={() => {
						const prepared = prepareSingleJobAction(action, job);
						if (prepared.type === 'confirm') setState(prepared.state);
						else onRunAction(prepared.input);
					}}
					disabled={disabled || busy}
					title={reason ?? undefined}
				>
					{action === 'delete' ? `${label} job` : label}
				</Button>
			))}
			<JobActionHelp actions={actions} />
			<JobActionDialog
				state={state}
				busy={busy}
				onClose={() => setState(null)}
				onConfirm={(input) => {
					onRunAction(input);
					setState(null);
				}}
			/>
		</>
	);
}

function JobDetailPending() {
	return (
		<section className="grid gap-3 rounded-xl border border-border bg-card p-6">
			<div className="h-5 w-32 rounded-md bg-muted" />
			<div className="h-8 w-56 rounded-md bg-muted" />
			<div className="h-4 w-72 rounded-md bg-muted" />
		</section>
	);
}
