/**
 * Tests for atomic job claiming using the claimedBy field.
 *
 * These tests verify:
 * - Jobs are claimed atomically using claimedBy field
 * - Only one scheduler instance can claim a job
 * - Concurrent claim attempts result in only one success
 * - claimedBy is set when job is acquired
 * - claimedBy is cleared when job completes or fails
 */

import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('atomic job claiming', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('atomic-claim');
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

	describe('claimedBy field behavior', () => {
		it('should set claimedBy to scheduler instance ID when acquiring a job', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'test-instance-123';
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				schedulerInstanceId: instanceId,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let processedJob: Job | null = null;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async (job) => {
				processedJob = job;
				// Hold the job to verify claimedBy while processing
				await new Promise((resolve) => setTimeout(resolve, 200));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });

			monque.start();

			// Wait for job to start processing
			await waitFor(async () => processedJob !== null, { timeout: 5000 });

			// Check claimedBy in database while job is processing
			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['status']).toBe(JobStatus.PROCESSING);
			expect(doc?.['claimedBy']).toBe(instanceId);
			expect(doc?.['lockedAt']).toBeInstanceOf(Date);
		});

		it('should clear claimedBy when job completes successfully', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'test-instance-456';
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				schedulerInstanceId: instanceId,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let completed = false;
			monque.on('job:complete', () => {
				completed = true;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				// Quick completion
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => completed, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc?.['status']).toBe(JobStatus.COMPLETED);
			expect(doc?.['claimedBy']).toBeUndefined();
		});

		it('should clear claimedBy when job fails permanently', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'test-instance-789';
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				schedulerInstanceId: instanceId,
				maxRetries: 1, // Fail immediately after first attempt
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let permanentlyFailed = false;
			monque.on('job:fail', ({ willRetry }) => {
				if (!willRetry) {
					permanentlyFailed = true;
				}
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Intentional failure');
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => permanentlyFailed, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc?.['status']).toBe(JobStatus.FAILED);
			expect(doc?.['claimedBy']).toBeUndefined();
		});

		it('should clear claimedBy when job fails but will retry', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'test-instance-retry';
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				schedulerInstanceId: instanceId,
				maxRetries: 3,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let failedWithRetry = false;
			monque.on('job:fail', ({ willRetry }) => {
				if (willRetry) {
					failedWithRetry = true;
				}
			});

			let attempts = 0;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error('First attempt fails');
				}
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => failedWithRetry, { timeout: 5000 });
			await monque.stop();

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc?.['status']).toBe(JobStatus.PENDING);
			expect(doc?.['claimedBy']).toBeUndefined();
			expect(doc?.['failCount']).toBe(1);
		});
	});

	describe('concurrent claim attempts', () => {
		it('should allow only one instance to claim a job when multiple attempt simultaneously', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			const instance1Id = 'instance-1';
			const instance2Id = 'instance-2';
			const instance3Id = 'instance-3';

			const monque1 = new Monque(db, {
				collectionName,
				pollInterval: 50,
				schedulerInstanceId: instance1Id,
				defaultConcurrency: 1,
			});
			const monque2 = new Monque(db, {
				collectionName,
				pollInterval: 50,
				schedulerInstanceId: instance2Id,
				defaultConcurrency: 1,
			});
			const monque3 = new Monque(db, {
				collectionName,
				pollInterval: 50,
				schedulerInstanceId: instance3Id,
				defaultConcurrency: 1,
			});

			monqueInstances.push(monque1, monque2, monque3);

			await monque1.initialize();
			await monque2.initialize();
			await monque3.initialize();

			const claimedBy = new Set<string>();
			const processedJobIds = new Set<string>();
			const duplicates: string[] = [];

			const createHandler = (instanceName: string) => async (job: Job<{ id: number }>) => {
				const jobId = job._id?.toString() ?? '';
				if (processedJobIds.has(jobId)) {
					duplicates.push(`${jobId} by ${instanceName}`);
				}
				processedJobIds.add(jobId);
				claimedBy.add(instanceName);
				await new Promise((resolve) => setTimeout(resolve, 50));
			};

			monque1.worker(TEST_CONSTANTS.JOB_NAME, createHandler('instance-1'));
			monque2.worker(TEST_CONSTANTS.JOB_NAME, createHandler('instance-2'));
			monque3.worker(TEST_CONSTANTS.JOB_NAME, createHandler('instance-3'));

			// Enqueue a single job
			await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 1 });

			// Start all instances simultaneously
			monque1.start();
			monque2.start();
			monque3.start();

			// Wait for job to be processed
			await waitFor(async () => processedJobIds.size === 1, { timeout: 5000 });

			// Verify no duplicates
			expect(duplicates).toHaveLength(0);
			// Exactly one instance should have claimed the job
			expect(claimedBy.size).toBe(1);
		});

		it('should distribute multiple jobs across instances without duplicates', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const jobCount = 20;

			const monque1 = new Monque(db, {
				collectionName,
				pollInterval: 30,
				schedulerInstanceId: 'dist-instance-1',
				defaultConcurrency: 3,
			});
			const monque2 = new Monque(db, {
				collectionName,
				pollInterval: 30,
				schedulerInstanceId: 'dist-instance-2',
				defaultConcurrency: 3,
			});

			monqueInstances.push(monque1, monque2);

			await monque1.initialize();
			await monque2.initialize();

			const processedJobs = new Set<number>();
			const duplicateJobs = new Set<number>();
			const instance1Jobs: number[] = [];
			const instance2Jobs: number[] = [];

			const handler1 = async (job: Job<{ id: number }>) => {
				const id = job.data.id;
				if (processedJobs.has(id)) {
					duplicateJobs.add(id);
				}
				processedJobs.add(id);
				instance1Jobs.push(id);
				await new Promise((resolve) => setTimeout(resolve, 20));
			};

			const handler2 = async (job: Job<{ id: number }>) => {
				const id = job.data.id;
				if (processedJobs.has(id)) {
					duplicateJobs.add(id);
				}
				processedJobs.add(id);
				instance2Jobs.push(id);
				await new Promise((resolve) => setTimeout(resolve, 20));
			};

			monque1.worker(TEST_CONSTANTS.JOB_NAME, handler1);
			monque2.worker(TEST_CONSTANTS.JOB_NAME, handler2);

			// Enqueue jobs
			for (let i = 0; i < jobCount; i++) {
				await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i });
			}

			monque1.start();
			monque2.start();

			await waitFor(async () => processedJobs.size === jobCount, { timeout: 10000 });

			expect(processedJobs.size).toBe(jobCount);
			expect(duplicateJobs.size).toBe(0);

			// Both instances should have processed some jobs (distribution)
			expect(instance1Jobs.length + instance2Jobs.length).toBe(jobCount);

			// Wait for database to reflect all completions
			await waitFor(
				async () => {
					const count = await db
						.collection(collectionName)
						.countDocuments({ status: JobStatus.COMPLETED });
					return count === jobCount;
				},
				{ timeout: 5000 },
			);

			const completedCount = await db
				.collection(collectionName)
				.countDocuments({ status: JobStatus.COMPLETED });
			expect(completedCount).toBe(jobCount);
		});
	});

	describe('claim query behavior', () => {
		it('should not claim jobs already claimed by another instance', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			// Create a job and manually set it as claimed by another instance
			const collection = db.collection(collectionName);
			const now = new Date();
			const claimedJob = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { value: 1 },
				nextRunAt: new Date(now.getTime() - 1000),
				claimedBy: 'other-instance',
				lockedAt: now,
				lastHeartbeat: now,
				createdAt: now,
				updatedAt: now,
			});
			await collection.insertOne(claimedJob);

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				schedulerInstanceId: 'new-instance',
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();

			// Wait a bit to ensure polling happens
			await new Promise((resolve) => setTimeout(resolve, 500));
			await monque.stop();

			// Handler should not have been called since job is claimed by another
			expect(handler).not.toHaveBeenCalled();

			// Verify job is still claimed by other instance
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['claimedBy']).toBe('other-instance');
		});

		it('should claim unclaimed pending jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'claiming-instance';

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				schedulerInstanceId: instanceId,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let processed = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				processed = true;
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => processed, { timeout: 5000 });

			// Job should have been processed
			expect(processed).toBe(true);
		});
	});
});
