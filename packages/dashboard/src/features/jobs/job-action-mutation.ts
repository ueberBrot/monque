import { mutationOptions, type QueryClient, type QueryKey } from '@tanstack/react-query';

import type { DashboardManagementApi } from '@/management-client';
import { readManagementError } from '@/management-errors';

import { type RunJobActionsInput, runJobActions } from './job-actions.js';

export function jobActionMutationOptions(api: DashboardManagementApi, queryClient: QueryClient) {
	return mutationOptions({
		mutationFn: (input: RunJobActionsInput) => runJobActions(api, input),
		onSettled: async (result, error, input) => {
			for (const job of result?.jobs ?? []) {
				queryClient.setQueryData(api.orpc.job.queryKey({ input: { params: { id: job.id } } }), job);
			}
			await invalidateJobQueries(
				queryClient,
				api,
				input.jobIds,
				result?.authorizationChanged || readManagementError(error).status === 403,
			);
		},
	});
}

/** Refresh job-dependent views without refetching unrelated health or permissions. */
async function invalidateJobQueries(
	queryClient: QueryClient,
	api: DashboardManagementApi,
	ids: readonly string[],
	authorizationChanged = false,
): Promise<void> {
	const keys: QueryKey[] = [
		api.orpc.jobs.key(),
		api.orpc.jobStats.key(),
		api.orpc.queueViews.key(),
		...ids.map((id) => api.orpc.job.key({ input: { params: { id } } })),
	];
	if (authorizationChanged) keys.push(api.orpc.capabilities.key());
	await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
