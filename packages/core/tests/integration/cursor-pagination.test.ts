import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { JobFactory } from '@tests/factories';
import { CursorDirection, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';
import { InvalidCursorError } from '@/shared';

async function createJobs(db: Db, collectionName: string, count: number, name = 'pagination-test') {
	const jobs = JobFactory.buildList(count, { name });
	const jobsWithIndex = jobs.map((job, i) => {
		const { _id, ...rest } = job;

		return { ...rest, data: { index: i } };
	});
	await db.collection(collectionName).insertMany(jobsWithIndex);
	return jobsWithIndex;
}

describe('Management APIs: Cursor Pagination', () => {
	let db: Db;
	let monque: Monque;
	const monqueInstances: Monque[] = [];
	const queueName = 'pagination-queue';

	beforeAll(async () => {
		db = await getTestDb('pagination-api');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
	});

	describe('getJobsWithCursor', () => {
		test('returns first page with cursor and hasNextPage', async () => {
			const collectionName = uniqueCollectionName('pagination_first');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create 11 jobs, request limit 5
			await createJobs(db, collectionName, 11, queueName);

			const result = await monque.getJobsWithCursor({ limit: 5 });

			expect(result.jobs).toHaveLength(5);
			expect(result.hasNextPage).toBe(true);
			expect(result.hasPreviousPage).toBe(false);
			expect(result.cursor).not.toBeNull();

			// Verify jobs are returned in order (oldest first by default / _id)
			expect(result.jobs[0]?.data).toEqual({ index: 0 });
			expect(result.jobs[4]?.data).toEqual({ index: 4 });
		});

		test('pagination continues correctly with cursor', async () => {
			const collectionName = uniqueCollectionName('pagination_next');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await createJobs(db, collectionName, 10, queueName);

			// Page 1
			const page1 = await monque.getJobsWithCursor({ limit: 3 });
			expect(page1.jobs).toHaveLength(3);
			expect(page1.jobs[0]?.data).toEqual({ index: 0 });
			expect(page1.cursor).not.toBeNull();

			if (!page1.cursor) throw new Error('Cursor should not be null');

			// Page 2
			const page2 = await monque.getJobsWithCursor({
				limit: 3,
				cursor: page1.cursor,
			});
			expect(page2.jobs).toHaveLength(3);
			expect(page2.jobs[0]?.data).toEqual({ index: 3 });
			expect(page2.hasNextPage).toBe(true);
			expect(page2.hasPreviousPage).toBe(true);
			expect(page2.cursor).not.toBeNull();

			if (!page2.cursor) throw new Error('Cursor should not be null');

			// Page 3
			const page3 = await monque.getJobsWithCursor({
				limit: 3,
				cursor: page2.cursor,
			});
			expect(page3.jobs).toHaveLength(3);
			expect(page3.jobs[0]?.data).toEqual({ index: 6 });
			expect(page3.cursor).not.toBeNull();

			if (!page3.cursor) throw new Error('Cursor should not be null');

			// Page 4 (last item)
			const page4 = await monque.getJobsWithCursor({
				limit: 3,
				cursor: page3.cursor,
			});
			expect(page4.jobs).toHaveLength(1);
			expect(page4.jobs[0]?.data).toEqual({ index: 9 });
			expect(page4.hasNextPage).toBe(false);
		});

		test('supports backward pagination', async () => {
			const collectionName = uniqueCollectionName('pagination_back');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await createJobs(db, collectionName, 10, queueName);

			const page1 = await monque.getJobsWithCursor({ limit: 3 });
			expect(page1.cursor).not.toBeNull();
			if (!page1.cursor) throw new Error('Cursor should not be null');

			const page2 = await monque.getJobsWithCursor({ limit: 3, cursor: page1.cursor });
			expect(page2.cursor).not.toBeNull();
			if (!page2.cursor) throw new Error('Cursor should not be null');

			// Now go backwards from page2's cursor
			const backResult = await monque.getJobsWithCursor({
				limit: 3,
				cursor: page2.cursor,
				direction: CursorDirection.BACKWARD,
			});

			expect(backResult.jobs).toHaveLength(3);
			// Check standard backward pagination result: items before the cursor in reverse order (so index 2, 3, 4)
			expect(backResult.jobs[0]?.data).toEqual({ index: 2 });
			expect(backResult.jobs[1]?.data).toEqual({ index: 3 });
			expect(backResult.jobs[2]?.data).toEqual({ index: 4 });

			expect(backResult.hasNextPage).toBe(true); // Can go forward
			expect(backResult.hasPreviousPage).toBe(true); // Can go backward (0, 1 exist)
		});

		test('filters by status works with pagination', async () => {
			const collectionName = uniqueCollectionName('pagination_filter');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingJobs = JobFactory.buildList(5, {
				name: queueName,
				status: JobStatus.PENDING,
			}).map((job, i) => {
				const { _id, ...rest } = job;

				return { ...rest, data: { i } };
			});

			const completedJobs = JobFactory.buildList(5, {
				name: queueName,
				status: JobStatus.COMPLETED,
			}).map((job, i) => {
				const { _id, ...rest } = job;

				return { ...rest, data: { i: i + 5 } };
			});

			await db.collection(collectionName).insertMany([...pendingJobs, ...completedJobs]);

			const result = await monque.getJobsWithCursor({
				filter: { status: JobStatus.COMPLETED },
				limit: 3,
			});

			expect(result.jobs).toHaveLength(3);
			expect(result.jobs.every((j) => j.status === JobStatus.COMPLETED)).toBe(true);
			expect(result.hasNextPage).toBe(true);
		});

		test('invalid cursor throws error', async () => {
			const collectionName = uniqueCollectionName('pagination_invalid');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await expect(monque.getJobsWithCursor({ cursor: 'invalid-base64' })).rejects.toThrow(
				InvalidCursorError,
			);
		});

		test('handles large dataset efficiently', async () => {
			const collectionName = uniqueCollectionName('pagination_large');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();
			// Insert 1000 docs directly
			const largeDocs = JobFactory.buildList(1000, {
				name: queueName,
				status: JobStatus.PENDING,
			}).map((job, i) => {
				const { _id, ...rest } = job;

				return { ...rest, data: { index: i } };
			});

			await db.collection(collectionName).insertMany(largeDocs);

			const start = performance.now();
			const result = await monque.getJobsWithCursor({ limit: 100 });
			const duration = performance.now() - start;

			expect(result.jobs).toHaveLength(100);
			expect(duration).toBeLessThan(500); // Should be very fast (usually < 50ms)
		});
	});
});
