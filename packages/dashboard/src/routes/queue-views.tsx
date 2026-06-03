import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { useDocumentVisible } from '@/lib/document-visibility';

import {
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	QueueViewsEmptyState,
	QueueViewsErrorState,
	QueueViewsOverview,
	QueueViewsOverviewLoading,
	QueueViewsUnauthorizedState,
} from './-queue-views.shared.js';

export const Route = createFileRoute('/queue-views')({
	component: QueueViewsRoute,
});

function QueueViewsRoute() {
	const { managementApi, runtimeConfig } = Route.useRouteContext();
	const isDocumentCurrentlyVisible = useDocumentVisible();
	const queueViewsQuery = useQuery({
		...managementApi.orpc.queueViews.queryOptions(),
		refetchInterval:
			runtimeConfig.pollingIntervalMs && isDocumentCurrentlyVisible
				? runtimeConfig.pollingIntervalMs
				: false,
	});

	if (queueViewsQuery.isPending) {
		return <QueueViewsOverviewLoading />;
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
