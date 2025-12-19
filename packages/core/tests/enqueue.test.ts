/**
 * Tests for the enqueue() method of the Monque scheduler.
 *
 * These tests verify:
 * - Basic job enqueueing functionality
 * - runAt option for delayed jobs
 * - Correct Job document structure returned
 * - Data integrity (payload preserved correctly)
 *
 * @see {@link ../src/monque.ts}
 */

import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TEST_CONSTANTS } from '@tests/setup/constants.js';
import { Monque } from '@/monque.js';
import { JobStatus } from '@/types.js';

import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from './setup/test-utils.js';

describe('enqueue()', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('enqueue');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);

		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('basic enqueueing', () => {
		it('should enqueue a job with name and data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, TEST_CONSTANTS.JOB_DATA);

			expect(job).toBeDefined();
			expect(job._id).toBeDefined();
			expect(job.name).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(job.data).toEqual(TEST_CONSTANTS.JOB_DATA);
		});

		it('should set status to pending', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 123 });

			expect(job.status).toBe(JobStatus.PENDING);
		});

		it('should set failCount to 0', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});

			expect(job.failCount).toBe(0);
		});

		it('should set createdAt and updatedAt timestamps', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const beforeEnqueue = new Date();
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			const afterEnqueue = new Date();

			expect(job.createdAt).toBeInstanceOf(Date);
			expect(job.updatedAt).toBeInstanceOf(Date);
			expect(job.createdAt.getTime()).toBeGreaterThanOrEqual(beforeEnqueue.getTime());
			expect(job.createdAt.getTime()).toBeLessThanOrEqual(afterEnqueue.getTime());
		});

		it('should set nextRunAt to now by default', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const beforeEnqueue = new Date();
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			const afterEnqueue = new Date();

			expect(job.nextRunAt).toBeInstanceOf(Date);
			expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeEnqueue.getTime());
			expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterEnqueue.getTime());
		});
	});

	describe('runAt option', () => {
		it('should schedule job for future execution with runAt', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const futureDate = new Date(Date.now() + 60000); // 1 minute in future
			const job = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ task: 'later' },
				{ runAt: futureDate },
			);

			expect(job.nextRunAt.getTime()).toBe(futureDate.getTime());
		});

		it('should accept runAt in the past', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pastDate = new Date(Date.now() - 60000); // 1 minute in past
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { runAt: pastDate });

			expect(job.nextRunAt.getTime()).toBe(pastDate.getTime());
		});
	});

	describe('data integrity', () => {
		it('should preserve string data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { message: 'Hello, World!' };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve numeric data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { count: 42, price: 19.99 };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve nested object data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = {
				user: {
					id: '123',
					profile: {
						name: 'John',
						email: 'john@example.com',
					},
				},
				settings: {
					enabled: true,
					options: ['a', 'b', 'c'],
				},
			};
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve array data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { items: [1, 2, 3, 4, 5] };
			const job = await monque.enqueue('array-job', data);

			expect(job.data).toEqual(data);
		});

		it('should preserve null values in data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { value: null, other: 'present' };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve boolean values in data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { active: true, deleted: false };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});
	});

	describe('return value', () => {
		it('should return Job with all required fields', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });

			// Required fields
			expect(job._id).toBeDefined();
			expect(job.name).toBeDefined();
			expect(job.data).toBeDefined();
			expect(job.status).toBeDefined();
			expect(job.nextRunAt).toBeDefined();
			expect(job.failCount).toBeDefined();
			expect(job.createdAt).toBeDefined();
			expect(job.updatedAt).toBeDefined();
		});

		it('should not include optional fields when not set', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});

			// Optional fields should not be set
			expect(job.uniqueKey).toBeUndefined();
			expect(job.repeatInterval).toBeUndefined();
			expect(job.failReason).toBeUndefined();
		});

		it('should include uniqueKey when provided', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { uniqueKey: 'test-key-123' });

			expect(job.uniqueKey).toBe('test-key-123');
		});
	});

	describe('persistence', () => {
		it('should persist job to MongoDB collection', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { stored: true });

			// Verify job exists in collection
			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc).not.toBeNull();
			expect(doc?.['name']).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(doc?.['data']).toEqual({ stored: true });
		});

		it('should allow enqueueing multiple jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job1 = await monque.enqueue('job-1', { index: 1 });
			const job2 = await monque.enqueue('job-2', { index: 2 });
			const job3 = await monque.enqueue('job-3', { index: 3 });

			expect(job1._id).not.toEqual(job2._id);
			expect(job2._id).not.toEqual(job3._id);

			const collection = db.collection(collectionName);
			const count = await collection.countDocuments();
			expect(count).toBe(3);
		});
	});

	describe('error handling', () => {
		it('should throw if not initialized', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			// Do NOT call initialize()

			await expect(monque.enqueue('test', {})).rejects.toThrow('not initialized');
		});
	});
});

describe('now()', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('now');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	it('should enqueue a job for immediate processing', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const beforeNow = new Date();
		const job = await monque.now(TEST_CONSTANTS.JOB_NAME, { urgent: true });
		const afterNow = new Date();

		expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeNow.getTime());
		expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterNow.getTime());
	});

	it('should be equivalent to enqueue with runAt: new Date()', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const nowJob = await monque.now('now-job', { method: 'now' });
		const enqueueJob = await monque.enqueue(
			'enqueue-job',
			{ method: 'enqueue' },
			{ runAt: new Date() },
		);

		// Both should have similar structure
		expect(nowJob.status).toBe(enqueueJob.status);
		expect(nowJob.failCount).toBe(enqueueJob.failCount);

		// nextRunAt should be close (within 100ms)
		const timeDiff = Math.abs(nowJob.nextRunAt.getTime() - enqueueJob.nextRunAt.getTime());
		expect(timeDiff).toBeLessThan(100);
	});

	it('should preserve data payload', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const data = { email: 'test@example.com', subject: 'Hello' };
		const job = await monque.now(TEST_CONSTANTS.JOB_NAME, data);

		expect(job.data).toEqual(data);
	});

	it('should return a valid Job document', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const job = await monque.now(TEST_CONSTANTS.JOB_NAME, {});

		expect(job._id).toBeDefined();
		expect(job.name).toBe(TEST_CONSTANTS.JOB_NAME);
		expect(job.status).toBe(JobStatus.PENDING);
		expect(job.failCount).toBe(0);
	});
});

/**
 * Tests for uniqueKey deduplication behavior.
 *
 * These tests verify prevent Duplicate Jobs with Unique Keys:
 * - pending jobs block new jobs with same uniqueKey
 * - processing jobs block new jobs with same uniqueKey
 * - completed jobs allow new jobs with same uniqueKey
 * - failed jobs allow new jobs with same uniqueKey
 *
 * @see {@link ../src/monque.ts}
 */
describe('uniqueKey deduplication', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('uniqueKey');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('pending job blocks new job with same uniqueKey', () => {
		it('should not create duplicate when pending job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create first job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);

			// Try to create duplicate with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should return the existing job (same _id)
			expect(job2._id?.toString()).toBe(job1._id?.toString());

			// Should only be one job in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(count).toBe(1);
		});

		it('should return the original job document when deduped', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create first job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', first: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Try to create duplicate with different data
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', second: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should return existing job with original data
			expect(job2.data).toEqual({ userId: '123', first: true });
			expect(job2._id?.toString()).toBe(job1._id?.toString());
		});
	});

	describe('processing job blocks new job with same uniqueKey', () => {
		it('should not create duplicate when processing job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);
			expect(job1._id).toBeDefined();

			// Manually update job status to processing (simulating worker pickup)
			const collection = db.collection(collectionName);
			await collection.updateOne(
				{ _id: job1._id },
				{ $set: { status: JobStatus.PROCESSING, lockedAt: new Date() } },
			);

			// Try to create another job with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should return the existing job (same _id)
			expect(job2._id?.toString()).toBe(job1._id?.toString());

			// Should only be one job in the collection
			const count = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(count).toBe(1);
		});
	});

	describe('completed job allows new job with same uniqueKey', () => {
		it('should create new job when completed job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);
			expect(job1._id).toBeDefined();

			// Manually update job status to completed
			const collection = db.collection(collectionName);
			await collection.updateOne(
				{ _id: job1._id },
				{ $set: { status: JobStatus.COMPLETED, lockedAt: null } },
			);

			// Create another job with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', retry: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should create a NEW job (different _id)
			expect(job2._id?.toString()).not.toBe(job1._id?.toString());
			expect(job2.status).toBe(JobStatus.PENDING);
			expect(job2.data).toEqual({ userId: '123', retry: true });

			// Should have two jobs in the collection (one completed, one pending)
			const totalCount = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(totalCount).toBe(2);

			const pendingCount = await collection.countDocuments({
				uniqueKey: 'sync-user-123',
				status: JobStatus.PENDING,
			});
			expect(pendingCount).toBe(1);
		});
	});

	describe('failed job allows new job with same uniqueKey', () => {
		it('should create new job when failed job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);
			expect(job1._id).toBeDefined();

			// Manually update job status to failed (permanent failure after max retries)
			const collection = db.collection(collectionName);
			await collection.updateOne(
				{ _id: job1._id },
				{
					$set: {
						status: JobStatus.FAILED,
						lockedAt: null,
						failCount: 10,
						failReason: 'Max retries exceeded',
					},
				},
			);

			// Create another job with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', retry: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should create a NEW job (different _id)
			expect(job2._id?.toString()).not.toBe(job1._id?.toString());
			expect(job2.status).toBe(JobStatus.PENDING);

			// Should have two jobs in the collection (one failed, one pending)
			const totalCount = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(totalCount).toBe(2);
		});
	});

	describe('concurrent enqueue with same uniqueKey', () => {
		it('should handle concurrent enqueue attempts atomically', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create 10 concurrent enqueue attempts with same uniqueKey
			const enqueuePromises = Array.from({ length: 10 }, (_, i) =>
				monque.enqueue(TEST_CONSTANTS.JOB_NAME, { attempt: i }, { uniqueKey: 'concurrent-test' }),
			);

			const results = await Promise.all(enqueuePromises);

			// All results should be defined
			expect(results.length).toBe(10);

			// Get first result and verify it exists
			const firstResult = results[0] as NonNullable<(typeof results)[0]>;
			expect(firstResult._id).toBeDefined();

			// All should return the same job (same _id)
			const firstId = firstResult._id.toString();
			expect(results.every((job) => job._id?.toString() === firstId)).toBe(true);

			// Should only be one job in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({ uniqueKey: 'concurrent-test' });
			expect(count).toBe(1);
		});
	});

	describe('different uniqueKeys create separate jobs', () => {
		it('should create separate jobs for different uniqueKeys', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '111' },
				{ uniqueKey: 'sync-user-111' },
			);
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '222' },
				{ uniqueKey: 'sync-user-222' },
			);
			const job3 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '333' },
				{ uniqueKey: 'sync-user-333' },
			);

			// All should have different _ids
			expect(job1._id?.toString()).not.toBe(job2._id?.toString());
			expect(job2._id?.toString()).not.toBe(job3._id?.toString());

			// Should have three jobs in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({});
			expect(count).toBe(3);
		});
	});

	describe('jobs without uniqueKey are not deduplicated', () => {
		it('should create multiple jobs when no uniqueKey is provided', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create multiple jobs without uniqueKey
			const job1 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: 'user@example.com' });
			const job2 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: 'user@example.com' });
			const job3 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: 'user@example.com' });

			// All should have different _ids
			expect(job1._id?.toString()).not.toBe(job2._id?.toString());
			expect(job2._id?.toString()).not.toBe(job3._id?.toString());

			// Should have three jobs in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({});
			expect(count).toBe(3);
		});
	});
});
