// @vitest-environment jsdom

import type { JobDto } from '@monque/management/contract';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';
import { DashboardProviders } from '@/providers';
import { createDashboardQueryClient } from '@/query-client';
import { getRouter } from '@/router';
import { parseDashboardRuntimeConfig } from '@/runtime-config';

describe('Job detail route', () => {
	afterEach(() => {
		cleanup();
	});

	it('shows job detail metadata, payload, and copy controls', async () => {
		const payload = {
			attempt: 3,
			nested: {
				token: 'visible-management-token',
			},
			recipient: 'person@example.test',
		};
		const job = createJobDetail({
			failCount: 2,
			failureReason: 'SMTP rejected recipient domain.',
			payload,
			repeatInterval: '*/15 * * * *',
			status: 'failed',
		});
		const clipboardWriteText = installClipboardSpy();

		renderJobDetailRoute({
			fetch: createJobDetailFetch(job),
			jobId: job.id,
		});

		expect(await screen.findByRole('heading', { name: job.name })).toBeTruthy();
		expect(screen.getByText('SMTP rejected recipient domain.')).toBeTruthy();
		expect(screen.getByText(job.id)).toBeTruthy();
		expect(screen.getByText('Payload')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Copy job ID' }));
		fireEvent.click(screen.getByRole('button', { name: 'Copy payload' }));
		fireEvent.click(screen.getByRole('button', { name: 'Copy shareable URL' }));

		await waitFor(() => {
			expect(clipboardWriteText).toHaveBeenCalledWith(job.id);
		});
		await waitFor(() => {
			expect(clipboardWriteText).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
		});
		await waitFor(() => {
			expect(clipboardWriteText).toHaveBeenCalledWith(window.location.href);
		});

		expect(screen.getByRole('button', { name: 'Copy job ID' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Copy shareable URL' })).toBeTruthy();
	});

	it('shows an explicit empty payload state', async () => {
		const job = createJobDetail({
			id: 'job-empty-payload',
			payload: {},
		});

		renderJobDetailRoute({
			fetch: createJobDetailFetch(job),
			jobId: job.id,
		});

		expect(await screen.findByRole('heading', { name: job.name })).toBeTruthy();
		expect(
			screen.getByText('No payload value was provided by the Management serialization output.'),
		).toBeTruthy();
	});

	it.each([
		[
			'unauthorized',
			createOrpcErrorResponse('UNAUTHORIZED', 401, 'Sign in to inspect this Job detail.'),
			'Sign in required',
		],
		[
			'forbidden',
			createOrpcErrorResponse(
				'FORBIDDEN',
				403,
				'Your current Management session cannot read this Job detail.',
			),
			'Job detail is forbidden',
		],
		['not-found', createOrpcErrorResponse('NOT_FOUND', 404, 'Job not found'), 'Job not found'],
		[
			'error',
			createOrpcErrorResponse(
				'INTERNAL_SERVER_ERROR',
				500,
				'The Management API could not load this Job detail.',
			),
			'Job detail could not be loaded',
		],
	] satisfies ReadonlyArray<
		readonly [string, Response, string]
	>)('maps typed %s states for operators', async (_name, response, heading) => {
		renderJobDetailRoute({
			fetch: createStaticFetch(response),
			jobId: 'job-error-state',
		});

		expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
	});

	it('confirms single delete, refetches detail, and shows not found after deletion', async () => {
		const job = createJobDetail({
			id: 'job-delete-me',
		});
		const fetchState = createJobDetailActionFetch(job);
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

		renderJobDetailRoute({
			fetch: fetchState.fetch,
			jobId: job.id,
		});

		expect(await screen.findByRole('heading', { name: job.name })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Delete job' }));

		expect(await screen.findByRole('heading', { name: 'Job not found' })).toBeTruthy();
		expect(confirmSpy).toHaveBeenCalledWith('Delete is permanent. Confirm deletion for this job.');
		expect(fetchState.deleteCount).toBe(1);
		expect(fetchState.detailRequestCount).toBeGreaterThanOrEqual(2);
	});
});

function renderJobDetailRoute(options: {
	readonly fetch: typeof fetch;
	readonly jobId: string;
}): void {
	Object.defineProperty(window, 'scrollTo', {
		configurable: true,
		value: vi.fn(),
	});
	window.history.pushState({}, '', `/jobs/${options.jobId}`);

	const runtimeConfig = parseDashboardRuntimeConfig({
		apiBaseUrl: '/',
		basePath: '/',
		pollingIntervalMs: 10_000,
	});
	const managementApi = createDashboardManagementApi({
		apiBaseUrl: runtimeConfig.apiBaseUrl,
		fetch: options.fetch,
		origin: window.location.origin,
	});
	const queryClient = createDashboardQueryClient();
	const router = getRouter({ managementApi, queryClient, runtimeConfig });

	render(<DashboardProviders queryClient={queryClient} router={router} />);
}

function installClipboardSpy(): ReturnType<typeof vi.fn> {
	const clipboardWriteText = vi.fn(async () => undefined);

	Object.defineProperty(window.navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: clipboardWriteText,
		},
	});

	return clipboardWriteText;
}

function createJobDetailFetch(job: JobDto): typeof fetch {
	return async (input) => {
		const request = input instanceof Request ? input : new Request(input);
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
			return createJsonResponse({
				readOnly: false,
				actions: {
					read: true,
					cancel: true,
					cancelBulk: true,
					retry: true,
					retryBulk: true,
					reschedule: true,
					delete: true,
					deleteBulk: true,
				},
			});
		}

		if (request.method === 'GET' && url.pathname === `/api/v1/jobs/${job.id}`) {
			return createJsonResponse(job);
		}

		return createJsonResponse(
			{
				code: 'NOT_FOUND',
				data: {
					error: 'Route not found',
				},
				defined: false,
				message: 'Route not found',
				status: 404,
			},
			404,
		);
	};
}

function createStaticFetch(response: Response): typeof fetch {
	return async () => response.clone();
}

function createOrpcErrorResponse(code: string, status: number, message: string): Response {
	return createJsonResponse(
		{
			code,
			data: {
				error: message,
			},
			defined: false,
			message,
			status,
		},
		status,
	);
}

function createJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json',
		},
	});
}

function createJobDetail(overrides: Partial<JobDto> = {}): JobDto {
	return {
		id: 'job-123',
		name: 'send-email',
		status: 'pending',
		payload: {
			recipient: 'person@example.test',
		},
		nextRunAt: '2026-06-03T12:00:00.000Z',
		lockedAt: null,
		claimedBy: null,
		lastHeartbeat: null,
		heartbeatInterval: undefined,
		failCount: 0,
		failureReason: null,
		repeatInterval: undefined,
		uniqueKey: 'send-email:person@example.test',
		createdAt: '2026-06-03T11:45:00.000Z',
		updatedAt: '2026-06-03T11:55:00.000Z',
		...overrides,
	};
}

function createJobDetailActionFetch(job: JobDto): {
	readonly deleteCount: number;
	readonly detailRequestCount: number;
	readonly fetch: typeof fetch;
} {
	let deleted = false;
	let deleteCount = 0;
	let detailRequestCount = 0;

	return {
		get deleteCount() {
			return deleteCount;
		},
		get detailRequestCount() {
			return detailRequestCount;
		},
		fetch: async (input) => {
			const request = input instanceof Request ? input : new Request(input);
			const url = new URL(request.url);

			if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
				return createJsonResponse({
					readOnly: false,
					actions: {
						read: true,
						cancel: true,
						cancelBulk: true,
						retry: true,
						retryBulk: true,
						reschedule: true,
						delete: true,
						deleteBulk: true,
					},
				});
			}

			if (request.method === 'GET' && url.pathname === `/api/v1/jobs/${job.id}`) {
				detailRequestCount += 1;

				if (deleted) {
					return createOrpcErrorResponse('NOT_FOUND', 404, 'Job not found');
				}

				return createJsonResponse(job);
			}

			if (request.method === 'DELETE' && url.pathname === `/api/v1/jobs/${job.id}`) {
				deleteCount += 1;
				deleted = true;

				return createJsonResponse({ deleted: true });
			}

			return createOrpcErrorResponse('NOT_FOUND', 404, 'Route not found');
		},
	};
}
