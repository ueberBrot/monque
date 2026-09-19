import type { JobListQueryDto } from '@monque/management/contract';
import { expect, it } from 'vitest';

import { createDashboardManagementApi } from '@/management-client';

import { createMockManagementFetch } from '../../src/mock/management-server.js';

function createApi() {
	return createDashboardManagementApi({
		apiBaseUrl: '/',
		origin: 'https://dashboard.test',
		fetch: createMockManagementFetch(),
	}).client;
}

const sorts = ['identifier', 'createdAt', 'updatedAt', 'nextRunAt'] as const;
const directions = ['asc', 'desc'] as const;

it.each(sorts.flatMap((sortBy) => directions.map((sortDirection) => ({ sortBy, sortDirection }))))(
	'preserves pagination after preceding Jobs and the anchor are deleted ($sortBy $sortDirection)',
	async (sort) => {
		const api = createApi();
		const all = await api.jobs({ ...sort, limit: '100' });
		const first = await api.jobs({ ...sort, limit: '3' });
		if (!first.cursor) throw new Error('Expected a second page');
		await Promise.all(first.jobs.map((job) => api.deleteJob({ params: { id: job.id } })));
		const second = await api.jobs({ ...sort, limit: '100', cursor: first.cursor });
		expect(second.jobs.map((job) => job.id)).toEqual(all.jobs.slice(3).map((job) => job.id));
		expect(second.hasPreviousPage).toBe(true);
		expect(second.hasNextPage).toBe(false);
		expect(second.cursor).not.toBeNull();
	},
);

it.each(directions)(
	'uses Job IDs to break tied dates when paginating %s',
	async (sortDirection) => {
		const api = createApi();
		const pending = await api.jobs({ status: 'pending', limit: '100' });
		await Promise.all(
			pending.jobs.map((job) =>
				api.rescheduleJob({
					params: { id: job.id },
					body: { nextRunAt: '2035-01-01T00:00:00.000Z' },
				}),
			),
		);
		const query = {
			status: 'pending',
			sortBy: 'nextRunAt',
			sortDirection,
		} satisfies JobListQueryDto;
		const all = await api.jobs({ ...query, limit: '100' });
		const first = await api.jobs({ ...query, limit: '3' });
		if (!first.cursor) throw new Error('Expected a second page');
		await Promise.all(first.jobs.map((job) => api.deleteJob({ params: { id: job.id } })));
		const second = await api.jobs({ ...query, limit: '100', cursor: first.cursor });
		expect(second.jobs.map((job) => job.id)).toEqual(all.jobs.slice(3).map((job) => job.id));
	},
);

it.each([
	'garbage',
	Buffer.from('{}').toString('base64url'),
	Buffer.from('{"offset":3}').toString('base64url'),
])('rejects malformed cursors instead of returning the first page: %s', async (cursor) => {
	await expect(createApi().jobs({ cursor })).rejects.toMatchObject({
		code: 'BAD_REQUEST',
		status: 400,
	});
});

it.each([{ sortBy: 'nextRunAt' }, { sortDirection: 'asc' }] satisfies JobListQueryDto[])(
	'rejects cursors from a different sort: %j',
	async (sort) => {
		const api = createApi();
		const first = await api.jobs({ limit: '3' });
		if (!first.cursor) throw new Error('Expected a second page');
		await expect(api.jobs({ ...sort, cursor: first.cursor })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			status: 400,
		});
	},
);

it.each(['single', 'selected'] as const)(
	'normalizes %s rescheduled timestamps before sorting and returning them',
	async (mode) => {
		const api = createApi();
		const pending = await api.jobs({ status: 'pending', limit: '100' });
		await Promise.all(
			pending.jobs.map((job, index) => {
				const nextRunAt = index % 2 ? '2035-01-01T00:00:00.001Z' : '2035-01-01T00:00:00Z';
				return mode === 'single'
					? api.rescheduleJob({ params: { id: job.id }, body: { nextRunAt } })
					: api.selectedJobActions({ action: 'reschedule', ids: [job.id], nextRunAt });
			}),
		);
		const page = await api.jobs({
			status: 'pending',
			sortBy: 'nextRunAt',
			sortDirection: 'asc',
			limit: '100',
		});
		const expected = [...page.jobs].sort(
			(left, right) =>
				Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt) || left.id.localeCompare(right.id),
		);
		expect(page.jobs).toEqual(expected);
		for (const job of page.jobs) expect(job.nextRunAt).toBe(new Date(job.nextRunAt).toISOString());
	},
);

it('rejects a structurally shaped cursor with an invalid date anchor', async () => {
	const cursor = Buffer.from(
		JSON.stringify({
			id: 'scenario-46001-0001',
			value: 'not-a-date',
			sortBy: 'createdAt',
			sortDirection: 'desc',
		}),
	).toString('base64url');
	await expect(createApi().jobs({ cursor })).rejects.toMatchObject({
		code: 'BAD_REQUEST',
		status: 400,
	});
});
