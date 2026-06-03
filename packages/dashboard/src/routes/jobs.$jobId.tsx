import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { useDashboardShellRouteActions } from '@/components/dashboard-shell';
import { JobDetailStateView, JobDetailView } from '@/components/job-detail-view';
import { Button } from '@/components/ui/button';
import { JobActionFeedbackPanel } from '@/features/jobs/job-action-feedback-panel';
import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getJobActionAvailability,
	type JobActionFeedback,
	type JobActionKey,
	runJobAction,
} from '@/features/jobs/job-actions';
import { mapJobDetailError, serializePayloadForClipboard } from '@/lib/job-detail';
import type { DashboardManagementApi } from '@/management-client';

export const Route = createFileRoute('/jobs/$jobId')({
	component: JobDetailRoute,
});

type JobDetailActionInput = {
	readonly action: JobActionKey;
	readonly nextRunAt?: string;
};

function JobDetailRoute() {
	const { managementApi, queryClient } = Route.useRouteContext();
	const { jobId } = Route.useParams();
	const [detailState, setDetailState] = useState<JobDetailLoadState>({
		status: 'pending',
	});
	const capabilitiesQuery = useQuery(managementApi.orpc.capabilities.queryOptions());

	useEffect(() => {
		let active = true;

		setDetailState({ status: 'pending' });
		void loadJobDetail(managementApi, jobId).then((state) => {
			if (!active) {
				return;
			}

			setDetailState(state);
		});

		return () => {
			active = false;
		};
	}, [jobId, managementApi]);

	const shellActions = useMemo(
		() => ({
			refresh: () => {
				setDetailState({ status: 'pending' });
				void loadJobDetail(managementApi, jobId).then((state) => {
					setDetailState(state);
				});
			},
			viewLabel: 'Job detail',
		}),
		[jobId, managementApi],
	);

	useDashboardShellRouteActions(shellActions);

	const mutation = useMutation({
		mutationFn: async (input: JobDetailActionInput) => {
			return runJobAction(
				managementApi,
				input.nextRunAt
					? {
							action: input.action,
							jobId,
							nextRunAt: input.nextRunAt,
						}
					: {
							action: input.action,
							jobId,
						},
			);
		},
		onSettled: async () => {
			await queryClient.invalidateQueries();
			setDetailState({ status: 'pending' });
			setDetailState(await loadJobDetail(managementApi, jobId));
		},
	});

	if (detailState.status === 'pending') {
		return <JobDetailPending />;
	}

	if (detailState.status === 'error') {
		return <JobDetailStateView state={mapJobDetailError(detailState.error)} />;
	}

	const job = detailState.job;
	const feedback = getFeedback(mutation.data, mutation.error);

	return (
		<section className="grid gap-4">
			{feedback ? (
				<JobActionFeedbackPanel
					feedback={feedback}
					className="rounded-xl border border-border px-5 py-4"
				/>
			) : null}
			<JobDetailView
				job={job}
				actions={
					<JobDetailActions
						job={job}
						busy={mutation.isPending}
						capabilities={capabilitiesQuery.data}
						onRunAction={(input) => {
							void mutation.mutateAsync(input);
						}}
					/>
				}
				onCopyJobId={() => copyToClipboard(job.id)}
				onCopyPayload={() => copyToClipboard(serializePayloadForClipboard(job.payload))}
				onCopyShareableUrl={() => copyToClipboard(window.location.href)}
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
	readonly onRunAction: (input: JobDetailActionInput) => void;
}) {
	const cancelAvailability = getJobActionAvailability(job, capabilities, 'cancel');
	const retryAvailability = getJobActionAvailability(job, capabilities, 'retry');
	const rescheduleAvailability = getJobActionAvailability(job, capabilities, 'reschedule');
	const deleteAvailability = getJobActionAvailability(job, capabilities, 'delete');

	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => onRunAction({ action: 'cancel' })}
				disabled={cancelAvailability.disabled || busy}
				title={cancelAvailability.reason ?? undefined}
			>
				Cancel
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => onRunAction({ action: 'retry' })}
				disabled={retryAvailability.disabled || busy}
				title={retryAvailability.reason ?? undefined}
			>
				Retry
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => {
					const nextRunAt = window.prompt(
						'Enter a new run time in ISO 8601 format.',
						job.nextRunAt,
					);

					if (!nextRunAt || Number.isNaN(new Date(nextRunAt).getTime())) {
						return;
					}

					onRunAction({
						action: 'reschedule',
						nextRunAt: new Date(nextRunAt).toISOString(),
					});
				}}
				disabled={rescheduleAvailability.disabled || busy}
				title={rescheduleAvailability.reason ?? undefined}
			>
				Reschedule
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => {
					if (!window.confirm('Delete is permanent. Confirm deletion for this job.')) {
						return;
					}

					onRunAction({ action: 'delete' });
				}}
				disabled={deleteAvailability.disabled || busy}
				title={deleteAvailability.reason ?? undefined}
			>
				Delete job
			</Button>
		</>
	);
}

function getFeedback(action: JobActionKey | undefined, error: unknown): JobActionFeedback | null {
	if (error) {
		return getActionErrorFeedback(error);
	}

	if (!action) {
		return null;
	}

	return getActionSuccessFeedback(action);
}

async function loadJobDetail(
	managementApi: DashboardManagementApi,
	jobId: string,
): Promise<JobDetailLoadState> {
	try {
		const job = await managementApi.client.job({
			params: {
				id: jobId,
			},
		});

		return {
			status: 'success',
			job,
		};
	} catch (error) {
		return {
			status: 'error',
			error,
		};
	}
}

type JobDetailLoadState =
	| {
			readonly status: 'pending';
	  }
	| {
			readonly error: unknown;
			readonly status: 'error';
	  }
	| {
			readonly job: JobDto;
			readonly status: 'success';
	  };

function copyToClipboard(value: string): void {
	void navigator.clipboard.writeText(value);
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
