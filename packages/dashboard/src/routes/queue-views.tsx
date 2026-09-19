import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router';

import { QueryFreshness, RefreshButton } from '@/components/query-freshness';
import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';
import { getQueryErrorMessage, isUnauthorizedQueryError } from '@/management-errors';

import {
	QueueViewsEmptyState,
	QueueViewsErrorState,
	QueueViewsLoadingState,
	QueueViewsOverview,
	QueueViewsUnauthorizedState,
} from './-queue-views.shared.js';

export const Route = createFileRoute('/queue-views')({
	component: QueueViewsRoute,
});

function QueueViewsRoute() {
	const matchRoute = useMatchRoute();
	return matchRoute({ to: '/queue-views/$name' }) ? <Outlet /> : <QueueViewsListRoute />;
}

function QueueViewsListRoute() {
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs, 3);
	const queueViewsQuery = useQuery({
		...managementApi.orpc.queueViews.queryOptions(),
		refetchInterval,
	});

	if (queueViewsQuery.isPending) {
		return <QueueViewsLoadingState />;
	}

	if (queueViewsQuery.isError) {
		if (isUnauthorizedQueryError(queueViewsQuery.error)) {
			return (
				<QueueViewsUnauthorizedState
					message={getQueryErrorMessage(queueViewsQuery.error, 'Sign in to inspect Queue Views.')}
				/>
			);
		}

		return (
			<QueueViewsErrorState
				heading="Queue Views failed to load"
				message={getQueryErrorMessage(
					queueViewsQuery.error,
					'Refresh the route or confirm the Management API is reachable.',
				)}
				onRetry={() => {
					void queueViewsQuery.refetch();
				}}
			/>
		);
	}

	if (queueViewsQuery.data.queueViews.length === 0) {
		return <QueueViewsEmptyState />;
	}

	return (
		<QueueViewsOverview
			queueViews={queueViewsQuery.data.queueViews}
			refresh={
				<div className="flex flex-wrap items-center gap-3">
					<QueryFreshness
						updatedAt={queueViewsQuery.dataUpdatedAt}
						fetching={queueViewsQuery.isFetching}
						paused={queueViewsQuery.fetchStatus === 'paused'}
						pollingIntervalMs={runtimeConfig.pollingIntervalMs}
					/>
					<RefreshButton
						onRefresh={() => void queueViewsQuery.refetch()}
						fetching={queueViewsQuery.isFetching}
					/>
				</div>
			}
		/>
	);
}
