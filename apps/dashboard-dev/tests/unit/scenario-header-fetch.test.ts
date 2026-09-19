import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';

import { createMockManagementFetch } from '../../src/mock/management-server.js';
import { createScenarioHeaderFetch } from '../../src/scenario-header-fetch.js';

afterEach(() => vi.unstubAllGlobals());

describe('scenario fetch adapter', () => {
	it('reschedules through the dashboard client without dropping its JSON content type', async () => {
		const mockFetch = createMockManagementFetch();
		const received: Request[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			received.push(request.clone());
			return mockFetch(request);
		});
		const api = createDashboardManagementApi({
			apiBaseUrl: '/',
			origin: 'https://dashboard-dev.example',
			fetch: createScenarioHeaderFetch('pending-jobs'),
		});
		const job = (await api.client.jobs({ status: 'pending', limit: '1' })).jobs[0];
		if (!job) throw new Error('Missing pending scenario job');
		const nextRunAt = '2035-10-01T12:30:00.000Z';
		await api.client.rescheduleJob({ params: { id: job.id }, body: { nextRunAt } });
		expect((await api.client.job({ params: { id: job.id } })).nextRunAt).toBe(nextRunAt);
		const mutation = received.find((request) => request.method === 'POST');
		expect(mutation?.headers.get('content-type')).toContain('application/json');
		expect(mutation?.headers.get('x-monque-dev-scenario')).toBe('pending-jobs');
		expect(mutation?.credentials).toBe('include');
		expect(await mutation?.json()).toEqual({ nextRunAt });
	});

	it('preserves request options and applies init overrides without changing input headers', async () => {
		const controller = new AbortController();
		const original = new Request('https://dashboard-dev.example/api/v1/jobs', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-original': 'preserved' },
			body: JSON.stringify({ nextRunAt: '2035-10-01T12:30:00Z' }),
			signal: controller.signal,
			credentials: 'include',
			cache: 'no-store',
			redirect: 'manual',
		});
		let received: Request | undefined;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			received = new Request(input, init);
			return new Response(null, { status: 204 });
		});
		await createScenarioHeaderFetch('pending-jobs')(original, {
			headers: { 'content-type': 'application/json', 'x-override': 'replacement' },
		});
		expect(original.headers.has('x-monque-dev-scenario')).toBe(false);
		expect(original.headers.get('x-original')).toBe('preserved');
		if (!received) throw new Error('Fetch did not receive a request');
		expect(received.headers.get('x-override')).toBe('replacement');
		expect(received.headers.has('x-original')).toBe(false);
		expect(received.headers.get('x-monque-dev-scenario')).toBe('pending-jobs');
		expect(received.method).toBe('POST');
		expect(received.url).toBe(original.url);
		expect(received.credentials).toBe('include');
		expect(received.cache).toBe('no-store');
		expect(received.redirect).toBe('manual');
		expect(await received.json()).toEqual({ nextRunAt: '2035-10-01T12:30:00Z' });
		controller.abort();
		expect(received.signal.aborted).toBe(true);
	});
});
