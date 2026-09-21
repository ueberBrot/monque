import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { QueryFreshness } from '@/components/query-freshness';
import { parseJobsRouteSearch } from '@/features/jobs/job-list-search';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';

import {
	QueueViewDetailHeader,
	QueueViewDetailLoadingState,
	QueueViewJobsTable,
	QueueViewsErrorState,
} from './-queue-views.shared.js';

const DEFAULT_QUEUE_VIEW_JOBS_LIMIT = 50;

const QueueViewDetailSearchSchema = z.strictObject({
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const Route = createFileRoute('/queue-views/$name')({
	validateSearch: (search) => QueueViewDetailSearchSchema.parse(search),
	component: QueueViewDetailRoute,
	pendingComponent: QueueViewDetailLoadingState,
});

function QueueViewDetailRoute() {
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const { name } = Route.useParams();
	const search = Route.useSearch();
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const statsInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs, 3);
	const queueViewsQuery = useQuery({
		...managementApi.orpc.queueViews.queryOptions({ input: { name } }),
		refetchInterval: statsInterval,
	});
	const jobsQuery = useQuery({
		...managementApi.orpc.jobs.queryOptions({
			input: {
				view: 'summary',
				cursor: search.cursor,
				limit: String(search.limit ?? DEFAULT_QUEUE_VIEW_JOBS_LIMIT),
				name,
			},
		}),
		refetchInterval,
	});
	const refetchQueueViewDetail = useCallback((): void => {
		void Promise.all([queueViewsQuery.refetch(), jobsQuery.refetch()]);
	}, [jobsQuery.refetch, queueViewsQuery.refetch]);

	if (queueViewsQuery.isPending || jobsQuery.isPending) {
		return <QueueViewDetailLoadingState />;
	}

	const firstError = queueViewsQuery.error ?? jobsQuery.error;

	if (firstError) {
		return (
			<QueueViewsErrorState
				heading={`${name} failed to load`}
				error={firstError}
				fetching={queueViewsQuery.isFetching || jobsQuery.isFetching}
				onRetry={refetchQueueViewDetail}
			/>
		);
	}

	const queueViews = queueViewsQuery.data?.queueViews;
	const jobsPage = jobsQuery.data;

	if (!queueViews || !jobsPage) {
		return <QueueViewDetailLoadingState />;
	}

	const queueView = queueViews.find((candidate) => candidate.name === name);
	const stats = queueView?.stats ?? {
		pending: 0,
		processing: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		total: 0,
	};

	return (
		<div className="grid gap-4">
			<QueueViewDetailHeader name={name} queueView={queueView} stats={stats} />
			<Link
				to="/jobs"
				search={parseJobsRouteSearch({ name })}
				className="w-fit text-sm font-medium text-primary underline underline-offset-4"
			>
				Filter and manage jobs
			</Link>
			<QueueViewJobsTable
				search={search}
				freshness={
					<QueryFreshness
						updatedAt={Math.min(jobsQuery.dataUpdatedAt, queueViewsQuery.dataUpdatedAt)}
						fetching={jobsQuery.isFetching || queueViewsQuery.isFetching}
						paused={jobsQuery.fetchStatus === 'paused' || queueViewsQuery.fetchStatus === 'paused'}
						pollingIntervalMs={runtimeConfig.pollingIntervalMs}
					/>
				}
				name={name}
				jobsPage={jobsPage}
				onRefresh={refetchQueueViewDetail}
			/>
		</div>
	);
}
