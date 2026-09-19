import { type QueryClient, useMutation } from '@tanstack/react-query';
import type { RowSelectionState } from '@tanstack/react-table';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';

import type { DashboardManagementApi } from '@/management-client';

import { jobActionMutationOptions } from './job-action-mutation.js';
import {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	type JobActionFeedback,
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
	readonly setRowSelection: Dispatch<SetStateAction<RowSelectionState>>;
}) {
	return useMutation({
		...jobActionMutationOptions(managementApi, queryClient),
		onSuccess: ({ action, count, failed, firstError }, input) => {
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
			setRowSelection((selection) => {
				const nextSelection = { ...selection };
				const failedIds = new Set(failed);
				for (const id of input.jobIds) {
					if (!failedIds.has(id)) delete nextSelection[id];
				}
				return nextSelection;
			});
		},
		onError: (error) => {
			setFeedback(getActionErrorFeedback(error));
		},
	});
}

export { useJobsActionMutation };
