import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { JobFactory, JobFactoryHelpers } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Management APIs: Queue Statistics', () => {
	let db: Db;
	let monque: Monque;
	const monqueInstances: Monque[] = [];
	const queueName = 'statistics-test-queue';

	beforeAll(async () => {
		db = await getTestDb('statistics-api');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
	});

	describe('getQueueStats', () => {
		test('returns zero counts for empty queue', async () => {
			const collectionName = uniqueCollectionName('stats_empty');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const stats = await monque.getQueueStats();

			expect(stats.pending).toBe(0);
			expect(stats.processing).toBe(0);
			expect(stats.completed).toBe(0);
			expect(stats.failed).toBe(0);
			expect(stats.cancelled).toBe(0);
			expect(stats.total).toBe(0);
			expect(stats.avgProcessingDurationMs).toBeUndefined();
		});

		test('returns correct counts for mixed status jobs', async () => {
			const collectionName = uniqueCollectionName('stats_mixed');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create jobs in various statuses
			await monque.enqueue(queueName, { task: 1 }); // pending
			await monque.enqueue(queueName, { task: 2 }); // pending
			await monque.enqueue(queueName, { task: 3 }); // pending

			// Insert jobs directly into DB for other statuses
			const processingDoc = JobFactoryHelpers.processing({
				name: queueName,
				data: { task: 4 },
			});
			await db.collection(collectionName).insertOne(processingDoc);

			const completedDocs = [
				JobFactoryHelpers.completed({ name: queueName, data: { task: 5 } }),
				JobFactoryHelpers.completed({ name: queueName, data: { task: 6 } }),
			];
			await db.collection(collectionName).insertMany(completedDocs);

			const failedDocs = [JobFactoryHelpers.failed({ name: queueName, data: { task: 7 } })];
			await db.collection(collectionName).insertMany(failedDocs);

			const cancelledDocs = [
				JobFactoryHelpers.cancelled({ name: queueName, data: { task: 8 } }),
				JobFactoryHelpers.cancelled({ name: queueName, data: { task: 9 } }),
			];
			await db.collection(collectionName).insertMany(cancelledDocs);

			const stats = await monque.getQueueStats();

			expect(stats.pending).toBe(3);
			expect(stats.processing).toBe(1);
			expect(stats.completed).toBe(2);
			expect(stats.failed).toBe(1);
			expect(stats.cancelled).toBe(2);
			expect(stats.total).toBe(9);
		});

		test('filters statistics by job name', async () => {
			const collectionName = uniqueCollectionName('stats_filter_name');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create jobs with different names
			await monque.enqueue('email-queue', { task: 1 });
			await monque.enqueue('email-queue', { task: 2 });
			await monque.enqueue('sms-queue', { task: 3 });

			const completedEmail = JobFactoryHelpers.completed({
				name: 'email-queue',
				data: { task: 4 },
			});
			await db.collection(collectionName).insertOne(completedEmail);

			const completedSms = JobFactoryHelpers.completed({
				name: 'sms-queue',
				data: { task: 5 },
			});
			await db.collection(collectionName).insertOne(completedSms);

			// Get stats for email-queue only
			const emailStats = await monque.getQueueStats({ name: 'email-queue' });

			expect(emailStats.pending).toBe(2);
			expect(emailStats.completed).toBe(1);
			expect(emailStats.total).toBe(3);

			// Get stats for sms-queue
			const smsStats = await monque.getQueueStats({ name: 'sms-queue' });

			expect(smsStats.pending).toBe(1);
			expect(smsStats.completed).toBe(1);
			expect(smsStats.total).toBe(2);
		});

		test('calculates average processing duration correctly', async () => {
			const collectionName = uniqueCollectionName('stats_avg_duration');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create completed jobs with known processing durations
			const now = new Date();

			// Job 1: 1000ms processing time
			const job1 = JobFactoryHelpers.completed({
				name: queueName,
				data: { task: 1 },
				lockedAt: new Date(now.getTime() - 1000),
				updatedAt: now,
			});

			// Job 2: 2000ms processing time
			const job2 = JobFactoryHelpers.completed({
				name: queueName,
				data: { task: 2 },
				lockedAt: new Date(now.getTime() - 2000),
				updatedAt: now,
			});

			// Job 3: 3000ms processing time
			const job3 = JobFactoryHelpers.completed({
				name: queueName,
				data: { task: 3 },
				lockedAt: new Date(now.getTime() - 3000),
				updatedAt: now,
			});

			await db.collection(collectionName).insertMany([job1, job2, job3]);

			const stats = await monque.getQueueStats();

			// Average of 1000, 2000, 3000 = 2000ms
			expect(stats.avgProcessingDurationMs).toBeDefined();
			expect(stats.avgProcessingDurationMs).toBe(2000);
			expect(stats.completed).toBe(3);
		});

		test('handles jobs without lockedAt in avg calculation', async () => {
			const collectionName = uniqueCollectionName('stats_no_locked');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = new Date();

			// Job with lockedAt
			const jobWithLockedAt = JobFactoryHelpers.completed({
				name: queueName,
				data: { task: 1 },
				lockedAt: new Date(now.getTime() - 1000),
				updatedAt: now,
			});

			// Job without lockedAt (simulates edge case)
			const jobWithoutLockedAt = {
				...JobFactoryHelpers.completed({
					name: queueName,
					data: { task: 2 },
				}),
				lockedAt: null,
			};

			await db.collection(collectionName).insertMany([jobWithLockedAt, jobWithoutLockedAt]);

			const stats = await monque.getQueueStats();

			// Should only count the job with lockedAt in average
			expect(stats.completed).toBe(2);
			// avgProcessingDurationMs should be based only on jobs with lockedAt
			expect(stats.avgProcessingDurationMs).toBeDefined();
			expect(stats.avgProcessingDurationMs).toBe(1000);
		});

		test('handles large dataset efficiently', async () => {
			const collectionName = uniqueCollectionName('stats_large');
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create 100K jobs - 20K per status using buildList
			const countPerStatus = 20_000;

			// Build job arrays using factory buildList
			const pendingJobs = JobFactory.buildList(countPerStatus, {
				name: queueName,
				status: JobStatus.PENDING,
			});
			const processingJobs = JobFactory.buildList(countPerStatus, {
				name: queueName,
				status: JobStatus.PROCESSING,
				lockedAt: new Date(),
				claimedBy: 'test-instance',
			});
			const completedJobs = JobFactory.buildList(countPerStatus, {
				name: queueName,
				status: JobStatus.COMPLETED,
			});
			const failedJobs = JobFactory.buildList(countPerStatus, {
				name: queueName,
				status: JobStatus.FAILED,
				failCount: 10,
			});
			const cancelledJobs = JobFactory.buildList(countPerStatus, {
				name: queueName,
				status: JobStatus.CANCELLED,
			});

			// Insert in batches of 10K to avoid memory issues
			const batchSize = 10_000;
			const allJobs = [
				...pendingJobs,
				...processingJobs,
				...completedJobs,
				...failedJobs,
				...cancelledJobs,
			];

			for (let i = 0; i < allJobs.length; i += batchSize) {
				const batch = allJobs.slice(i, i + batchSize);
				await db.collection(collectionName).insertMany(batch);
			}

			// Verify job count
			const count = await db.collection(collectionName).countDocuments();
			expect(count).toBe(100_000);

			// Measure performance
			const startTime = Date.now();
			const stats = await monque.getQueueStats();
			const duration = Date.now() - startTime;

			// Must complete within 5 seconds per spec
			expect(duration).toBeLessThan(5000);

			// Verify correct distribution (20K each)
			expect(stats.pending).toBe(20_000);
			expect(stats.processing).toBe(20_000);
			expect(stats.completed).toBe(20_000);
			expect(stats.failed).toBe(20_000);
			expect(stats.cancelled).toBe(20_000);
			expect(stats.total).toBe(100_000);
		}, 30000); // 30 second timeout for the test itself
	});
});
