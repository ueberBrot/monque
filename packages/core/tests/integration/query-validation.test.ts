import { cleanupTestDb, getTestDb, uniqueCollectionName } from '@test-utils/test-utils';
import type { Db, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InvalidJobQueryError, type JobCursorFilter, type JobSelector, Monque } from '@/index';

describe('Public query input validation', () => {
	let db: Db;
	let monque: Monque;

	beforeAll(async () => {
		db = await getTestDb('query-validation');
		monque = new Monque(db, { collectionName: uniqueCollectionName('query_validation') });
		await monque.initialize();
	});

	beforeEach(async () => {
		await monque.deleteJobs({});
		await monque.enqueue('alpha', {});
		await monque.enqueue('beta', {});
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	it('rejects an empty name without broadening deletion to other Job Names', async () => {
		await expect(monque.deleteJobs({ name: '' })).rejects.toThrow(InvalidJobQueryError);
		expect((await monque.getJobs()).map((job) => job.name).sort()).toEqual(['alpha', 'beta']);
		expect(await monque.deleteJobs({ name: 'alpha' })).toEqual({ count: 1, errors: [] });
		expect((await monque.getJobs()).map((job) => job.name)).toEqual(['beta']);
	});

	it('rejects operator-valued selectors across reads, statistics, and bulk mutations', async () => {
		const filter = JSON.parse('{"name":{"$ne":null}}') as JobSelector;
		await expect(monque.getJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.getJobsWithCursor({ filter })).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.getJobSummariesWithCursor({ filter })).rejects.toThrow(
			InvalidJobQueryError,
		);
		await expect(monque.getQueueStats(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.getQueueViewSummaries(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.cancelJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.retryJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.deleteJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		expect((await monque.getJobs()).map((job) => job.status)).toEqual(['pending', 'pending']);
	});

	it.each([
		{ status: { $ne: 'processing' } },
		{ status: [{ $regex: '.*' }] },
		{ status: null },
		{ status: '' },
		{ status: ['pending', null] },
		{ olderThan: null },
		{ olderThan: { $gt: '' } },
		{ newerThan: new Date(Number.NaN) },
	])('rejects invalid status or date selectors %j without changing jobs', async (input) => {
		// Deliberately cross the TypeScript boundary, as a JavaScript/JSON caller can.
		const filter = input as unknown as JobSelector;
		await expect(monque.getJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.cancelJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.retryJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.deleteJobs(filter)).rejects.toThrow(InvalidJobQueryError);
		expect((await monque.getJobs()).map((job) => job.status)).toEqual(['pending', 'pending']);
	});

	it('preserves exact names, status arrays, date bounds, and intentional empty selectors', async () => {
		expect(await monque.getJobs({ name: 'alpha', status: ['pending', 'failed'] })).toHaveLength(1);
		expect(await monque.getJobs({ status: [] })).toHaveLength(0);
		expect(await monque.deleteJobs({ status: [] })).toEqual({ count: 0, errors: [] });
		expect(
			await monque.cancelJobs({ name: 'alpha', olderThan: new Date(Date.now() + 1000) }),
		).toEqual({ count: 1, errors: [] });
		expect(await monque.getJobs({ name: 'beta', status: 'pending' })).toHaveLength(1);
		expect(await monque.deleteJobs({})).toEqual({ count: 2, errors: [] });
	});

	it.each([
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1001,
		Number.MAX_SAFE_INTEGER,
		null,
		'10',
	])('rejects unsafe page size %s for every listing API', async (input) => {
		const options = { limit: input as number };
		await expect(monque.getJobs(options)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.getJobsWithCursor(options)).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.getJobSummariesWithCursor(options)).rejects.toThrow(InvalidJobQueryError);
	});

	it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid skip %s',
		async (skip) => {
			await expect(monque.getJobs({ skip })).rejects.toThrow(InvalidJobQueryError);
		},
	);

	it('preserves pagination defaults and supports the maximum bounded page size', async () => {
		await Promise.all(Array.from({ length: 103 }, () => monque.enqueue('alpha', {})));
		expect(await monque.getJobs()).toHaveLength(100);
		expect((await monque.getJobsWithCursor()).jobs).toHaveLength(50);
		expect(await monque.getJobs({ limit: 1000 })).toHaveLength(105);
		expect((await monque.getJobsWithCursor({ limit: 1000 })).jobs).toHaveLength(105);
		expect((await monque.getJobSummariesWithCursor({ limit: 1000 })).jobs).toHaveLength(105);
		expect(await monque.getJobs({ limit: 1, skip: 104 })).toHaveLength(1);
	});

	it.each([null, false, 0, '', []])(
		'rejects a malformed filter %j instead of reading all jobs',
		async (input) => {
			const filter = input as unknown as JobSelector;
			await expect(monque.getJobs(filter)).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.getJobsWithCursor({ filter })).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.getJobSummariesWithCursor({ filter })).rejects.toThrow(
				InvalidJobQueryError,
			);
			await expect(monque.getQueueStats(filter)).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.getQueueViewSummaries(filter)).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.deleteJobs(filter)).rejects.toThrow(InvalidJobQueryError);
			expect(await monque.getJobs()).toHaveLength(2);
		},
	);

	it('does not interpret an operator object as a single-job ID', async () => {
		const input = JSON.parse('{"$ne":null}') as ObjectId;
		expect(await monque.getJob(input)).toBeNull();
		const job = await monque.enqueue('gamma', {});
		expect((await monque.getJob(job._id))?._id).toEqual(job._id);
		expect((await monque.getJob(job._id.toHexString()))?._id).toEqual(job._id);
	});

	it.each(['', null, 0, [], /alpha/])(
		'rejects an invalid name %j even with cached statistics',
		async (input) => {
			await monque.getQueueStats();
			await monque.getQueueViewSummaries();
			const filter = { name: input } as unknown as JobSelector;
			await expect(monque.getJobs(filter)).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.getJobsWithCursor({ filter })).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.getQueueStats(filter)).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.getQueueViewSummaries(filter)).rejects.toThrow(InvalidJobQueryError);
			await expect(monque.deleteJobs(filter)).rejects.toThrow(InvalidJobQueryError);
			expect(await monque.getJobs()).toHaveLength(2);
		},
	);

	it.each([
		{ createdAtFrom: null },
		{ createdAtTo: '2026-01-01' },
		{ updatedAtFrom: { $ne: null } },
		{ updatedAtTo: new Date(Number.NaN) },
		{ nextRunAtFrom: 0 },
		{ nextRunAtTo: [] },
	])('rejects invalid cursor date ranges %j', async (input) => {
		const filter = input as unknown as JobCursorFilter;
		await expect(monque.getJobsWithCursor({ filter })).rejects.toThrow(InvalidJobQueryError);
		await expect(monque.getJobSummariesWithCursor({ filter })).rejects.toThrow(
			InvalidJobQueryError,
		);
	});
});
