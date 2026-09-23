import { useRouter, useRouterState } from '@tanstack/react-router';

import { ButtonLink } from '@/components/button-link';
import { DashboardState, RetryButton } from '@/components/dashboard-state';

function DashboardRoutePending() {
	return (
		<p role="status" className="text-sm text-muted-foreground">
			Loading dashboard route…
		</p>
	);
}

function DashboardRouteError() {
	const router = useRouter();
	const fetching = useRouterState({ select: (state) => state.isLoading });
	return (
		<DashboardState
			title="Dashboard route failed"
			description="This page could not be opened. Retry, or return to Queue Views to continue."
			tone="danger"
		>
			<RetryButton
				fetching={fetching}
				onRetry={() => {
					void router.invalidate();
				}}
			/>
			<ButtonLink to="/queue-views" variant="outline">
				Go to Queue Views
			</ButtonLink>
		</DashboardState>
	);
}

function DashboardRouteNotFound() {
	return (
		<DashboardState
			title="Route not found"
			description="This address does not match a dashboard page."
		>
			<ButtonLink to="/queue-views" variant="outline">
				Go to Queue Views
			</ButtonLink>
		</DashboardState>
	);
}

export { DashboardRouteError, DashboardRouteNotFound, DashboardRoutePending };
