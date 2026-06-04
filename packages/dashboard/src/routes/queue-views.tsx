import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';

import { useDocumentVisiblePollingInterval } from '@/lib/document-visibility';

import {
	getQueryErrorMessage,
	isUnauthorizedQueryError,
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
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const location = useLocation();
	const refetchInterval = useDocumentVisiblePollingInterval(runtimeConfig.pollingIntervalMs);
	const queueViewsQuery = useQuery({
		...managementApi.orpc.queueViews.queryOptions(),
		refetchInterval,
	});

	if (location.pathname !== '/queue-views') {
		return <Outlet />;
	}

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

	return <QueueViewsOverview queueViews={queueViewsQuery.data.queueViews} />;
}
