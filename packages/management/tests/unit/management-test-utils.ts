import type {
	BulkOperationResult,
	CursorOptions,
	PersistedJob,
	QueueStats,
	QueueViewSummary,
} from '@monque/core';
import { ObjectId } from 'mongodb';
import { expect } from 'vitest';

import type { ManagementMonque, ManagementOpenApiContext, ManagementSurface } from '@/surface';

interface CreateManagementMonqueOptions {
	mutations?: boolean;
}

export function createManagementMonque(
	overrides: Partial<ManagementMonque> = {},
	options: CreateManagementMonqueOptions = {},
): ManagementMonque {
	const mutationStubs: Partial<ManagementMonque> = options.mutations
		? {
				cancelJob: async () => null,
				retryJob: async () => null,
				rescheduleJob: async () => null,
				deleteJob: async () => false,
				cancelJobs: async (): Promise<BulkOperationResult> => ({ count: 0, errors: [] }),
				retryJobs: async (): Promise<BulkOperationResult> => ({ count: 0, errors: [] }),
				deleteJobs: async (): Promise<BulkOperationResult> => ({ count: 0, errors: [] }),
			}
		: {};

	return {
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
		...mutationStubs,
		...overrides,
	};
}

export function createManagementJob(overrides: Partial<PersistedJob> = {}): PersistedJob {
	return {
		_id: new ObjectId(),
		name: 'send-email',
		data: { to: 'person@example.test' },
		status: 'pending',
		nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
		failCount: 0,
		createdAt: new Date('2025-12-31T23:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:01:00.000Z'),
		...overrides,
	};
}

export function getManagementJobById(job: PersistedJob): ManagementMonque['getJob'] {
	return async (id) => (id.equals(job._id) ? job : null);
}

export async function expectJsonResponse(
	response: Response,
	status: number,
	expectedBody: unknown,
): Promise<void> {
	expect(response.status).toBe(status);
	expect(await response.json()).toEqual(expectedBody);
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
		{
			context: options.context === undefined ? { managementContext: {} } : options.context,
		},
	);

	if (!result.matched) {
		throw new Error(`Expected oRPC OpenAPI handler to match ${path}`);
	}

	return result.response;
}
