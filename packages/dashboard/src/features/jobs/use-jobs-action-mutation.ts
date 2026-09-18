import { type QueryClient, useMutation } from '@tanstack/react-query';
import type { RowSelectionState } from '@tanstack/react-table';
import { toast } from 'sonner';

import type { DashboardManagementApi } from '@/management-client';

import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	type JobActionFeedback,
	type RunJobActionsInput,
	runJobActions,
} from './job-actions.js';

function useJobsActionMutation({
	managementApi,
	queryClient,
	setFeedback,
	setRowSelection,
}: {
	readonly managementApi: DashboardManagementApi;
	readonly queryClient: QueryClient;
	readonly setFeedback: (feedback: JobActionFeedback | null) => void;
	readonly setRowSelection: (selection: RowSelectionState) => void;
}) {
	return useMutation({
		mutationFn: (input: RunJobActionsInput) => runJobActions(managementApi, input),
		onSuccess: async ({ action, count, failed, firstError }) => {
			const errorFeedback = getActionErrorFeedback(firstError);
			if (failed.length) {
				setFeedback({
					...errorFeedback,
					description: `${count} succeeded, ${failed.length} failed. ${errorFeedback.description}`,
				});
			} else {
				setFeedback(null);
				const success = getActionSuccessFeedback(action, count);
				toast.success(success.title, { description: success.description });
			}
			setRowSelection(Object.fromEntries(failed.map((id) => [id, true])));
			await queryClient.invalidateQueries();
		},
		onError: async (error) => {
			setFeedback(getActionErrorFeedback(error));
			await queryClient.invalidateQueries();
		},
	});
}

export { useJobsActionMutation };
