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
import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getJobActionAvailability,
	type JobActionRequest,
	runJobAction,
} from '@/features/jobs/job-actions';
import { parseJobsRouteSearch } from '@/features/jobs/job-list-search';
import { toDateTimeLocalValue } from '@/lib/dates';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';
import { mapJobDetailError, serializePayloadForClipboard } from '@/lib/job-detail';

export const Route = createFileRoute('/jobs/$jobId')({
	component: JobDetailRoute,
	validateSearch: z.object({
		queueView: z.string().optional(),
		queueCursor: z.string().optional(),
		queueLimit: z.coerce.number().int().min(1).max(100).optional(),
	}).parse,
});

function JobDetailRoute() {
	const { managementApi, queryClient, runtimeConfig } = Route.useRouteContext();
	const { jobId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const router = useRouter();
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const jobQuery = useQuery({
		...managementApi.orpc.job.queryOptions({ input: { params: { id: jobId } } }),
		refetchInterval,
	});
	const capabilitiesQuery = useQuery(managementApi.orpc.capabilities.queryOptions());
	async function copy(value: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			toast.success('Copied to clipboard');
		} catch {
			toast.error('Copy failed', {
				description: 'Select and copy the value manually.',
				duration: Number.POSITIVE_INFINITY,
			});
		}
	}

	const mutation = useMutation({
		onMutate: () => router.state.location,
		mutationFn: async (input: JobActionRequest) => {
			return runJobAction(managementApi, { ...input, jobId });
		},
		onSuccess: async (action, _input, origin) => {
			const success = getActionSuccessFeedback(action);
			toast.success(success.title, { description: success.description });
			if (action !== 'delete' || router.state.location !== origin) return;
			if (search.queueView) {
				await navigate({
					to: '/queue-views/$name',
					params: { name: search.queueView },
					search: { cursor: search.queueCursor, limit: search.queueLimit },
					replace: true,
				});
			} else {
				await navigate({ to: '/jobs', search: parseJobsRouteSearch(search), replace: true });
			}
		},
		onSettled: async () => {
			await queryClient.invalidateQueries();
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
			{search.queueView ? (
				<Link
					to="/queue-views/$name"
					params={{ name: search.queueView }}
					search={{ cursor: search.queueCursor, limit: search.queueLimit }}
					className="w-fit text-sm text-muted-foreground hover:text-primary"
				>
					← Back to {search.queueView}
				</Link>
			) : (
				<Link
					to="/jobs"
					search={parseJobsRouteSearch(search)}
					className="w-fit text-sm text-muted-foreground hover:text-primary"
				>
					← Back to jobs
				</Link>
			)}
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
						capabilities={capabilitiesQuery.data}
						onRunAction={(input) => {
							mutation.mutate(input);
						}}
					/>
				}
				onCopyJobId={() => {
					void copy(job.id);
				}}
				onCopyPayload={() => {
					void copy(serializePayloadForClipboard(job.payload));
				}}
				onCopyShareableUrl={() => {
					void copy(window.location.href);
				}}
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
	const cancelAvailability = getJobActionAvailability(job, capabilities, 'cancel');
	const retryAvailability = getJobActionAvailability(job, capabilities, 'retry');
	const rescheduleAvailability = getJobActionAvailability(job, capabilities, 'reschedule');
	const deleteAvailability = getJobActionAvailability(job, capabilities, 'delete');

	const [state, setState] = useState<JobActionDialogState | null>(null);
	function open(action: 'delete' | 'reschedule'): void {
		setState({
			action,
			scope: 'single',
			jobIds: [job.id],
			jobName: job.name,
			nextRunAt: toDateTimeLocalValue(job.nextRunAt),
		});
	}
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={() => onRunAction({ action: 'cancel' })}
				disabled={cancelAvailability.disabled || busy}
				title={cancelAvailability.reason ?? undefined}
			>
				Cancel
			</Button>
			<Button
				variant="outline"
				size="sm"
				onClick={() => onRunAction({ action: 'retry' })}
				disabled={retryAvailability.disabled || busy}
				title={retryAvailability.reason ?? undefined}
			>
				Retry
			</Button>
			<Button
				variant="outline"
				size="sm"
				onClick={() => open('reschedule')}
				disabled={rescheduleAvailability.disabled || busy}
				title={rescheduleAvailability.reason ?? undefined}
			>
				Reschedule
			</Button>
			<Button
				variant="destructive"
				size="sm"
				onClick={() => open('delete')}
				disabled={deleteAvailability.disabled || busy}
				title={deleteAvailability.reason ?? undefined}
			>
				Delete job
			</Button>
			<JobActionHelp
				actions={[
					{ label: 'Cancel', reason: cancelAvailability.reason },
					{ label: 'Retry', reason: retryAvailability.reason },
					{ label: 'Reschedule', reason: rescheduleAvailability.reason },
					{ label: 'Delete', reason: deleteAvailability.reason },
				]}
			/>
			<JobActionDialog
				state={state}
				busy={busy}
				onClose={() => setState(null)}
				onNextRunAtChange={(nextRunAt) =>
					setState((current) => (current ? { ...current, nextRunAt } : null))
				}
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
