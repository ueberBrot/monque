import { useQueries, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';

import {
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	QueueViewDetailHeader,
	QueueViewJobsTable,
	QueueViewsErrorState,
	QueueViewsLoadingState,
	QueueViewsUnauthorizedState,
} from './-queue-views.shared.js';

const DEFAULT_QUEUE_VIEW_JOBS_LIMIT = 50;

const QueueViewDetailSearchSchema = z
	.object({
		cursor: z.string().optional(),
		limit: z.coerce.number().int().min(1).max(100).optional(),
	})
	.strict();

export const Route = createFileRoute('/queue-views/$name')({
	validateSearch: (search) => QueueViewDetailSearchSchema.parse(search),
	component: QueueViewDetailRoute,
});

function QueueViewDetailRoute() {
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const { name } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const [queueViewsQuery, statsQuery] = useQueries({
		queries: [
			{
				...managementApi.orpc.queueViews.queryOptions(),
				refetchInterval,
			},
			{
				...managementApi.orpc.jobStats.queryOptions({
					input: { name },
				}),
				refetchInterval,
			},
		],
	});
	const jobsQuery = useQuery({
		...managementApi.orpc.jobs.queryOptions({
			input: {
				cursor: search.cursor,
				limit: String(search.limit ?? DEFAULT_QUEUE_VIEW_JOBS_LIMIT),
				name,
			},
		}),
		refetchInterval,
	});
	const refetchQueueViewDetail = useCallback((): void => {
		void Promise.all([queueViewsQuery.refetch(), statsQuery.refetch(), jobsQuery.refetch()]);
	}, [jobsQuery.refetch, queueViewsQuery.refetch, statsQuery.refetch]);
	const resetQueueViewPagination = useCallback((): void => {
		void navigate({
			to: '/queue-views/$name',
			params: { name },
			search: {
				limit: search.limit,
			},
		});
	}, [navigate, name, search.limit]);

	if (queueViewsQuery.isPending || statsQuery.isPending || jobsQuery.isPending) {
		return <QueueViewsLoadingState />;
	}

	const firstError = queueViewsQuery.error ?? statsQuery.error ?? jobsQuery.error;

	if (firstError) {
		if (isUnauthorizedQueryError(firstError)) {
			return (
				<QueueViewsUnauthorizedState
					heading={`${name} requires sign-in`}
					message={getQueryErrorMessage(firstError, 'Sign in to inspect this Queue View.')}
				/>
			);
		}

		return (
			<QueueViewsErrorState
				heading={`${name} failed to load`}
				message={getQueryErrorMessage(
					firstError,
					'Refresh the route or confirm the Management API is reachable.',
				)}
				onRetry={refetchQueueViewDetail}
			/>
		);
	}

	const queueViews = queueViewsQuery.data?.queueViews;
	const stats = statsQuery.data;
	const jobsPage = jobsQuery.data;

	if (!queueViews || !stats || !jobsPage) {
		return <QueueViewsLoadingState />;
	}

	const queueView = queueViews.find((candidate) => candidate.name === name);

	return (
		<div className="grid gap-4">
			<QueueViewDetailHeader name={name} queueView={queueView} stats={stats} />
			<QueueViewJobsTable
				name={name}
				jobsPage={jobsPage}
				onRefresh={refetchQueueViewDetail}
				onResetCursor={resetQueueViewPagination}
				onNextPage={(cursor) => {
					void navigate({
						to: '/queue-views/$name',
						params: { name },
						search: {
							cursor,
							limit: search.limit,
						},
					});
				}}
			/>
		</div>
	);
}
