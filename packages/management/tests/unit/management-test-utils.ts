import type {
	BulkOperationResult,
	CursorOptions,
	QueueStats,
	QueueViewSummary,
} from '@monque/core';

import type { ManagementMonque } from '@/surface';

interface CreateManagementMonqueOptions {
	mutations?: boolean;
}

export function createManagementMonque(
	overrides: Partial<ManagementMonque> = {},
	options: CreateManagementMonqueOptions = {},
): ManagementMonque {
	const monque: ManagementMonque = {
		isHealthy: () => true,
		getQueueViewSummaries: async (): Promise<QueueViewSummary[]> => [],
		getJobsWithCursor: async (_options?: CursorOptions) => ({
			jobs: [],
			cursor: null,
			hasNextPage: false,
			hasPreviousPage: false,
		}),
		getJob: async (_id) => null,
		getQueueStats: async (_filter?: { name?: string }): Promise<QueueStats> => ({
			pending: 0,
			processing: 0,
			completed: 0,
			failed: 0,
			cancelled: 0,
			total: 0,
		}),
		...overrides,
	};

	if (options.mutations) {
		monque.cancelJob = async () => null;
		monque.retryJob = async () => null;
		monque.rescheduleJob = async () => null;
		monque.deleteJob = async () => false;
		monque.cancelJobs = async (): Promise<BulkOperationResult> => ({ count: 0, errors: [] });
		monque.retryJobs = async (): Promise<BulkOperationResult> => ({ count: 0, errors: [] });
		monque.deleteJobs = async (): Promise<BulkOperationResult> => ({ count: 0, errors: [] });
	}

	return monque;
}
