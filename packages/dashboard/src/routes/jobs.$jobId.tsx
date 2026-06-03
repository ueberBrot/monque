import { safe } from '@orpc/client';
import { createFileRoute } from '@tanstack/react-router';

import { JobDetailStateView, JobDetailView } from '@/components/job-detail-view';
import { mapJobDetailError, serializePayloadForClipboard } from '@/lib/job-detail';

export const Route = createFileRoute('/jobs/$jobId')({
	component: JobDetailRoute,
	loader: ({ context, params }) =>
		safe(
			context.managementApi.client.job({
				params: {
					id: params.jobId,
				},
			}),
		),
	pendingComponent: JobDetailPending,
});

function JobDetailRoute() {
	const result = Route.useLoaderData();

	if (!result.isSuccess) {
		return <JobDetailStateView state={mapJobDetailError(result.error)} />;
	}

	const job = result.data;

	return (
		<JobDetailView
			job={job}
			onCopyJobId={() => copyToClipboard(job.id)}
			onCopyPayload={() => copyToClipboard(serializePayloadForClipboard(job.payload))}
			onCopyShareableUrl={() => copyToClipboard(window.location.href)}
		/>
	);
}

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
