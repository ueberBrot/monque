import type { JobDto } from '@monque/management/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { JobDetailStateView, JobDetailView } from '@/components/job-detail-view';
import { Button } from '@/components/ui/button';
import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getJobActionAvailability,
	type JobActionFeedback,
	type JobActionKey,
} from '@/features/jobs/job-actions';
import { mapJobDetailError, serializePayloadForClipboard } from '@/lib/job-detail';

export const Route = createFileRoute('/jobs/$jobId')({
	component: JobDetailRoute,
});

function JobDetailRoute() {
	const { managementApi, queryClient } = Route.useRouteContext();
	const { jobId } = Route.useParams();
	const [detailState, setDetailState] = useState<JobDetailLoadState>({
		status: 'pending',
	});
	const capabilitiesQuery = useQuery({
		queryKey: ['capabilities'],
		queryFn: () => managementApi.client.capabilities(),
	});

	useEffect(() => {
		let active = true;

		setDetailState({ status: 'pending' });
		void managementApi.client
			.job({
				params: {
					id: jobId,
				},
			})
			.then((job) => {
				if (!active) {
					return;
				}

				setDetailState({
					status: 'success',
					job,
				});
			})
			.catch((error: unknown) => {
				if (!active) {
					return;
				}

				setDetailState({
					status: 'error',
					error,
				});
			});

		return () => {
			active = false;
		};
	}, [jobId, managementApi]);

	const mutation = useMutation({
		mutationFn: async (input: { readonly action: JobActionKey; readonly nextRunAt?: string }) => {
			switch (input.action) {
				case 'cancel':
					await managementApi.client.cancelJob({ params: { id: jobId } });
					break;
				case 'retry':
					await managementApi.client.retryJob({ params: { id: jobId } });
					break;
				case 'reschedule':
					await managementApi.client.rescheduleJob({
						params: { id: jobId },
						body: {
							nextRunAt: input.nextRunAt ?? new Date().toISOString(),
						},
					});
					break;
				case 'delete':
					await managementApi.client.deleteJob({ params: { id: jobId } });
					break;
			}

			return input.action;
		},
		onSettled: async () => {
			await queryClient.invalidateQueries();
			setDetailState({ status: 'pending' });
			try {
				const job = await managementApi.client.job({
					params: {
						id: jobId,
					},
				});

				setDetailState({
					status: 'success',
					job,
				});
			} catch (error) {
				setDetailState({
					status: 'error',
					error,
				});
			}
		},
	});

	if (detailState.status === 'pending') {
		return <JobDetailPending />;
	}

	if (detailState.status === 'error') {
		return <JobDetailStateView state={mapJobDetailError(detailState.error)} />;
	}

	const job = detailState.job;
	const cancelAvailability = getJobActionAvailability(job, capabilitiesQuery.data, 'cancel');
	const retryAvailability = getJobActionAvailability(job, capabilitiesQuery.data, 'retry');
	const rescheduleAvailability = getJobActionAvailability(
		job,
		capabilitiesQuery.data,
		'reschedule',
	);
	const deleteAvailability = getJobActionAvailability(job, capabilitiesQuery.data, 'delete');
	const feedback = getFeedback(mutation.data, mutation.error);

	return (
		<section className="grid gap-4">
			{feedback ? (
				<section className="rounded-xl border border-border bg-card px-5 py-4 text-sm">
					<p className="font-medium">{feedback.title}</p>
					<p className="text-muted-foreground">{feedback.description}</p>
				</section>
			) : null}
			<JobDetailView
				job={job}
				actions={
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								void mutation.mutateAsync({ action: 'cancel' });
							}}
							disabled={cancelAvailability.disabled || mutation.isPending}
							title={cancelAvailability.reason ?? undefined}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								void mutation.mutateAsync({ action: 'retry' });
							}}
							disabled={retryAvailability.disabled || mutation.isPending}
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

								void mutation.mutateAsync({
									action: 'reschedule',
									nextRunAt: new Date(nextRunAt).toISOString(),
								});
							}}
							disabled={rescheduleAvailability.disabled || mutation.isPending}
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

								void mutation.mutateAsync({ action: 'delete' });
							}}
							disabled={deleteAvailability.disabled || mutation.isPending}
							title={deleteAvailability.reason ?? undefined}
						>
							Delete job
						</Button>
					</>
				}
				onCopyJobId={() => copyToClipboard(job.id)}
				onCopyPayload={() => copyToClipboard(serializePayloadForClipboard(job.payload))}
				onCopyShareableUrl={() => copyToClipboard(window.location.href)}
			/>
		</section>
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
