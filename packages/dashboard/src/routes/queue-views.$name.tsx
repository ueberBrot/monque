import { useQueries, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { useDocumentVisible } from '@/lib/document-visibility';

import {
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	QueueViewDetailHeader,
	QueueViewJobsTable,
	QueueViewsErrorState,
	QueueViewsOverviewLoading,
	QueueViewsUnauthorizedState,
} from './-queue-views.shared.js';

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
	const isDocumentCurrentlyVisible = useDocumentVisible();
	const refetchInterval =
		runtimeConfig.pollingIntervalMs && isDocumentCurrentlyVisible
			? runtimeConfig.pollingIntervalMs
			: false;
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
				limit: String(search.limit ?? 50),
				name,
			},
		}),
		refetchInterval,
	});

	if (queueViewsQuery.isPending || statsQuery.isPending || jobsQuery.isPending) {
		return <QueueViewsOverviewLoading />;
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
				onRetry={() => {
					void Promise.all([queueViewsQuery.refetch(), statsQuery.refetch(), jobsQuery.refetch()]);
				}}
			/>
		);
	}

	const queueViews = queueViewsQuery.data?.queueViews;
	const stats = statsQuery.data;
	const jobsPage = jobsQuery.data;

	if (!queueViews || !stats || !jobsPage) {
		return <QueueViewsOverviewLoading />;
	}

	const queueView = queueViews.find((candidate) => candidate.name === name);

	return (
		<div className="grid gap-4">
			<QueueViewDetailHeader name={name} queueView={queueView} stats={stats} />
			<QueueViewJobsTable
				name={name}
				jobsPage={jobsPage}
				onRefresh={() => {
					void Promise.all([statsQuery.refetch(), jobsQuery.refetch(), queueViewsQuery.refetch()]);
				}}
				onResetCursor={() => {
					void navigate({
						to: '/queue-views/$name',
						params: { name },
						search: {
							limit: search.limit,
						},
					});
				}}
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
