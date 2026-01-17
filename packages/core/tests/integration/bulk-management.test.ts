import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories';
import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Management APIs: Bulk Operations', () => {
	let db: Db;
	let monque: Monque;
	const monqueInstances: Monque[] = [];
	const queueName = 'bulk-management-test-queue';

	beforeAll(async () => {
		db = await getTestDb('bulk-management-api');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
	});

	describe('cancelJobs', () => {
		test('cancels all matching jobs by name and status', async () => {
			const collectionName = uniqueCollectionName('bulk_cancel_match');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create jobs to cancel
			await monque.enqueue(queueName, { task: 1 });
			await monque.enqueue(queueName, { task: 2 });
			await monque.enqueue(queueName, { task: 3 });
			// Create a job with different name that should NOT be cancelled
			await monque.enqueue('other-queue', { task: 4 });

			const result = await monque.cancelJobs({
				name: queueName,
				status: JobStatus.PENDING,
			});

			expect(result.count).toBe(3);
			expect(result.errors).toHaveLength(0);

			// Verify in DB
			const cancelledDocs = await db.collection(collectionName).find({ name: queueName }).toArray();
			const cancelled = cancelledDocs as unknown as Job[];
			expect(cancelled.every((job) => job.status === JobStatus.CANCELLED)).toBe(true);

			// Verify other queue job is still pending
			const otherDoc = await db.collection(collectionName).findOne({ name: 'other-queue' });
			const other = otherDoc as unknown as Job | null;
			expect(other?.status).toBe(JobStatus.PENDING);
		});

		test('skips processing jobs and includes them in errors', async () => {
			const collectionName = uniqueCollectionName('bulk_cancel_skip');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a pending job
			await monque.enqueue(queueName, { task: 1 });
			// Create a processing job (directly in DB)
			const processingDoc = JobFactoryHelpers.processing({
				name: queueName,
				data: { task: 2 },
			});
			await db.collection(collectionName).insertOne(processingDoc);

			const result = await monque.cancelJobs({
				name: queueName,
			});

			// Only the pending one should be cancelled
			expect(result.count).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error).toContain('processing');
		});

		test('returns count 0 for empty filter with no matches', async () => {
			const collectionName = uniqueCollectionName('bulk_cancel_empty');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const result = await monque.cancelJobs({
				name: 'non-existent-queue',
			});

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(0);
		});

		test('cancels jobs matching status array', async () => {
			const collectionName = uniqueCollectionName('bulk_cancel_array');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await monque.enqueue(queueName, { task: 1 });
			await monque.enqueue(queueName, { task: 2 });

			const result = await monque.cancelJobs({
				status: [JobStatus.PENDING],
			});

			expect(result.count).toBe(2);
			expect(result.errors).toHaveLength(0);
		});

		test('emits jobs:cancelled event with job IDs', async () => {
			const collectionName = uniqueCollectionName('bulk_cancel_event');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await monque.enqueue(queueName, { task: 1 });
			await monque.enqueue(queueName, { task: 2 });

			let emittedPayload: { jobIds: string[]; count: number } | undefined;
			monque.on('jobs:cancelled', (payload) => {
				emittedPayload = payload;
			});

			await monque.cancelJobs({ name: queueName });

			expect(emittedPayload).toBeDefined();
			expect(emittedPayload?.count).toBe(2);
			expect(emittedPayload?.jobIds).toHaveLength(2);
		});
	});

	describe('retryJobs', () => {
		test('retries all failed jobs matching filter', async () => {
			const collectionName = uniqueCollectionName('bulk_retry_failed');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create failed jobs directly in DB
			const failedDocs = [
				JobFactoryHelpers.failed({ name: queueName, data: { task: 1 } }),
				JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } }),
				JobFactoryHelpers.failed({ name: queueName, data: { task: 3 } }),
			];
			await db.collection(collectionName).insertMany(failedDocs);

			const result = await monque.retryJobs({
				status: JobStatus.FAILED,
			});

			expect(result.count).toBe(3);
			expect(result.errors).toHaveLength(0);

			// Verify in DB all are now pending
			const retriedDocs = await db.collection(collectionName).find({}).toArray();
			const retried = retriedDocs as unknown as Job[];
			expect(retried.every((job) => job.status === JobStatus.PENDING)).toBe(true);
			expect(retried.every((job) => job.failCount === 0)).toBe(true);
		});

		test('retries cancelled jobs as well', async () => {
			const collectionName = uniqueCollectionName('bulk_retry_cancelled');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create and cancel jobs
			await monque.enqueue(queueName, { task: 1 });
			await monque.enqueue(queueName, { task: 2 });
			await monque.cancelJobs({ name: queueName });

			const result = await monque.retryJobs({
				status: JobStatus.CANCELLED,
			});

			expect(result.count).toBe(2);
			expect(result.errors).toHaveLength(0);
		});

		test('skips pending and processing jobs', async () => {
			const collectionName = uniqueCollectionName('bulk_retry_skip');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create pending job
			await monque.enqueue(queueName, { task: 1 });
			// Create a failed job
			const failedDoc = JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } });
			await db.collection(collectionName).insertOne(failedDoc);

			// Try to retry by name (includes both pending and failed)
			const result = await monque.retryJobs({
				name: queueName,
			});

			// Only the failed job should be retried
			expect(result.count).toBe(1);
			expect(result.errors).toHaveLength(1);
		});

		test('emits jobs:retried event with job IDs', async () => {
			const collectionName = uniqueCollectionName('bulk_retry_event');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const failedDocs = [
				JobFactoryHelpers.failed({ name: queueName, data: { task: 1 } }),
				JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } }),
			];
			await db.collection(collectionName).insertMany(failedDocs);

			let emittedPayload: { jobIds: string[]; count: number } | undefined;
			monque.on('jobs:retried', (payload) => {
				emittedPayload = payload;
			});

			await monque.retryJobs({ status: JobStatus.FAILED });

			expect(emittedPayload).toBeDefined();
			expect(emittedPayload?.count).toBe(2);
			expect(emittedPayload?.jobIds).toHaveLength(2);
		});
	});

	describe('deleteJobs', () => {
		test('deletes jobs matching status and olderThan', async () => {
			const collectionName = uniqueCollectionName('bulk_delete_older');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create completed jobs with old createdAt
			const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
			const oldDocs = [
				JobFactoryHelpers.completed({ name: queueName, data: { task: 1 }, createdAt: oldDate }),
				JobFactoryHelpers.completed({ name: queueName, data: { task: 2 }, createdAt: oldDate }),
			];
			await db.collection(collectionName).insertMany(oldDocs);

			// Create a recent completed job that should NOT be deleted
			const recentDoc = JobFactoryHelpers.completed({
				name: queueName,
				data: { task: 3 },
				createdAt: new Date(),
			});
			await db.collection(collectionName).insertOne(recentDoc);

			const result = await monque.deleteJobs({
				status: JobStatus.COMPLETED,
				olderThan: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
			});

			expect(result.count).toBe(2);
			expect(result.errors).toHaveLength(0);

			// Verify only the recent job remains
			const remaining = await db.collection(collectionName).countDocuments();
			expect(remaining).toBe(1);
		});

		test('deletes jobs newer than specified date', async () => {
			const collectionName = uniqueCollectionName('bulk_delete_newer');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create an old completed job
			const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
			const oldDoc = JobFactoryHelpers.completed({
				name: queueName,
				data: { task: 1 },
				createdAt: oldDate,
			});
			await db.collection(collectionName).insertOne(oldDoc);

			// Create recent completed jobs
			const recentDocs = [
				JobFactoryHelpers.completed({ name: queueName, data: { task: 2 } }),
				JobFactoryHelpers.completed({ name: queueName, data: { task: 3 } }),
			];
			await db.collection(collectionName).insertMany(recentDocs);

			const result = await monque.deleteJobs({
				status: JobStatus.COMPLETED,
				newerThan: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
			});

			expect(result.count).toBe(2);
			expect(result.errors).toHaveLength(0);

			// Verify only the old job remains
			const remaining = await db.collection(collectionName).countDocuments();
			expect(remaining).toBe(1);
		});

		test('returns count 0 when no jobs match', async () => {
			const collectionName = uniqueCollectionName('bulk_delete_empty');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const result = await monque.deleteJobs({
				name: 'non-existent-queue',
			});

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(0);
		});

		test('can delete jobs in any status', async () => {
			const collectionName = uniqueCollectionName('bulk_delete_any');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create jobs in various statuses
			await monque.enqueue(queueName, { task: 1 }); // pending
			const failedDoc = JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } });
			await db.collection(collectionName).insertOne(failedDoc);
			const completedDoc = JobFactoryHelpers.completed({ name: queueName, data: { task: 3 } });
			await db.collection(collectionName).insertOne(completedDoc);

			const result = await monque.deleteJobs({
				name: queueName,
			});

			expect(result.count).toBe(3);
			expect(result.errors).toHaveLength(0);

			const remaining = await db.collection(collectionName).countDocuments();
			expect(remaining).toBe(0);
		});

		test('does not emit events for bulk delete', async () => {
			// Bulk delete is a batch operation, individual events would be too noisy
			const collectionName = uniqueCollectionName('bulk_delete_no_event');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await monque.enqueue(queueName, { task: 1 });
			await monque.enqueue(queueName, { task: 2 });

			let eventCount = 0;
			monque.on('job:deleted', () => {
				eventCount++;
			});

			await monque.deleteJobs({ name: queueName });

			// Individual job:deleted events should NOT be emitted for bulk delete
			expect(eventCount).toBe(0);
		});
	});
});
