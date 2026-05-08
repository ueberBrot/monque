import type {
	BulkOperationResult,
	CursorOptions,
	QueueStats,
	QueueViewSummary,
} from '@monque/core';

import type { ManagementMonque, ManagementOpenApiContext, ManagementSurface } from '@/surface';

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

export async function handleManagementGet(
	surface: ManagementSurface,
	path: string,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	return handleManagementRequest(surface, path, { method: 'GET', context });
}

export async function handleManagementPost(
	surface: ManagementSurface,
	path: string,
	body?: unknown,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	return handleManagementRequest(surface, path, { method: 'POST', body, context });
}

export async function handleManagementDelete(
	surface: ManagementSurface,
	path: string,
	context?: ManagementOpenApiContext,
): Promise<Response> {
	return handleManagementRequest(surface, path, { method: 'DELETE', context });
}

async function handleManagementRequest(
	surface: ManagementSurface,
	path: string,
	options: {
		method: string;
		body?: unknown;
		context?: ManagementOpenApiContext | undefined;
	},
): Promise<Response> {
	const init: RequestInit = { method: options.method };

	if (options.body !== undefined) {
		init.headers = { 'content-type': 'application/json' };
		init.body = JSON.stringify(options.body);
	}

	const result = await surface.openApiHandler.handle(
		new Request(`https://management.example${path}`, init),
		options.context === undefined ? {} : { context: options.context },
	);

	if (!result.matched) {
		throw new Error(`Expected oRPC OpenAPI handler to match ${path}`);
	}

	return result.response;
}
