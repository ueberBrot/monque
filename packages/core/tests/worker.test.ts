/**
 * Tests for the worker() method and job processing in the Monque scheduler.
 *
 * These tests verify:
 * - Worker registration functionality
 * - Job processing by registered workers
 * - Correct handler invocation with job data
 * - Job status transitions during processing
 * - Concurrency limits per worker
 *
 * @see {@link ../src/monque.ts}
 */

import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TEST_CONSTANTS } from '@tests/setup/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@tests/setup/test-utils.js';
import { Monque } from '@/monque.js';
import { type Job, JobStatus } from '@/types.js';

describe('worker()', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('worker');
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

	describe('registration', () => {
		it('should register a worker for a job name', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			// Worker registration is synchronous and should not throw
			expect(() => monque.worker(TEST_CONSTANTS.JOB_NAME, handler)).not.toThrow();
		});

		it('should allow registering multiple workers for different job names', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const jobType1Name = 'job-type-1';
			const jobType2Name = 'job-type-2';
			const jobType3Name = 'job-type-3';
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const handler3 = vi.fn();

			monque.worker(jobType1Name, handler1);
			monque.worker(jobType2Name, handler2);
			monque.worker(jobType3Name, handler3);

			// All registrations should succeed
			expect(() => {
				monque.worker(jobType1Name, handler1);
				monque.worker(jobType2Name, handler2);
				monque.worker(jobType3Name, handler3);
			}).not.toThrow();
		});

		it('should replace handler when registering same job name twice', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const sameJobName = 'same-job';
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler1 = vi.fn();
			const handler2 = vi.fn();

			monque.worker(sameJobName, handler1);
			monque.worker(sameJobName, handler2);

			// Enqueue a job and verify only handler2 is called
			await monque.enqueue(sameJobName, {});
			monque.start();

			await waitFor(async () => handler2.mock.calls.length > 0);

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledTimes(1);
		});

		it('should accept concurrency option', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();

			// Registration with options should succeed
			expect(() => monque.worker('concurrent-job', handler, { concurrency: 3 })).not.toThrow();
		});
	});

	describe('job processing', () => {
		it('should process pending jobs when started', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
			monque.start();

			await waitFor(async () => handler.mock.calls.length > 0);

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('should pass job to handler with correct data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const receivedJobs: Job[] = [];
			const handler = vi.fn((job: Job) => {
				receivedJobs.push(job);
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			const enqueuedData = { userId: '123', action: 'process' };
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, enqueuedData);
			monque.start();

			await waitFor(async () => handler.mock.calls.length > 0);

			expect(receivedJobs).toHaveLength(1);

			const receivedJob = receivedJobs[0];

			if (!receivedJob) throw new Error('Expected receivedJob to be defined');

			expect(receivedJob.name).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(receivedJob.data).toEqual(enqueuedData);
		});

		it('should process jobs in order of nextRunAt', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100, defaultConcurrency: 1 });
			const orderedJobName = 'ordered-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const processedJobs: number[] = [];
			const handler = vi.fn((job: Job<{ order: number }>) => {
				processedJobs.push(job.data.order);
			});
			monque.worker(orderedJobName, handler);

			// Enqueue jobs with different nextRunAt times (in reverse order)
			const now = Date.now();
			await monque.enqueue(orderedJobName, { order: 3 }, { runAt: new Date(now + 30) });
			await monque.enqueue(orderedJobName, { order: 1 }, { runAt: new Date(now + 10) });
			await monque.enqueue(orderedJobName, { order: 2 }, { runAt: new Date(now + 20) });

			monque.start();

			await waitFor(async () => processedJobs.length === 3, { timeout: 5000 });

			expect(processedJobs).toEqual([1, 2, 3]);
		});

		it('should only process jobs for registered workers', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const registeredJobName = 'registered-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(registeredJobName, handler);

			// Enqueue both registered and unregistered job types
			await monque.enqueue(registeredJobName, {});
			await monque.enqueue('unregistered-job', {});

			monque.start();

			await waitFor(async () => handler.mock.calls.length > 0);
			// Give extra time to ensure unregistered job isn't picked up
			await new Promise((r) => setTimeout(r, 300));

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('should handle async handlers', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const asyncJobName = 'async-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn(async () => {
				await new Promise((r) => setTimeout(r, 50));
			});
			monque.worker(asyncJobName, handler);

			await monque.enqueue(asyncJobName, {});
			monque.start();

			await waitFor(async () => handler.mock.calls.length > 0);

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('should update job status to completed after successful processing', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const completeJobName = 'complete-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(completeJobName, handler);

			const job = await monque.enqueue(completeJobName, {});
			monque.start();

			await waitFor(async () => {
				const collection = db.collection(collectionName);
				const doc = await collection.findOne({ _id: job._id });
				return doc?.['status'] === JobStatus.COMPLETED;
			});

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });
			expect(doc?.['status']).toBe(JobStatus.COMPLETED);
		});

		it('should clear lockedAt after successful processing', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const unlockJobName = 'unlock-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(unlockJobName, handler);

			const job = await monque.enqueue(unlockJobName, {});
			monque.start();

			await waitFor(async () => {
				const collection = db.collection(collectionName);
				const doc = await collection.findOne({ _id: job._id });
				return doc?.['status'] === JobStatus.COMPLETED;
			});

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });
			expect(doc?.['lockedAt']).toBeNull();
		});
	});

	describe('concurrency limits', () => {
		it('should respect defaultConcurrency option', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const defaultConcurrency = 2;
			const concurrencyJobName = 'concurrent-job';
			monque = new Monque(db, { collectionName, pollInterval: 50, defaultConcurrency });
			monqueInstances.push(monque);
			await monque.initialize();

			let maxConcurrent = 0;
			let currentConcurrent = 0;

			const handler = vi.fn(async () => {
				currentConcurrent++;
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
				await new Promise((r) => setTimeout(r, 200));
				currentConcurrent--;
			});
			monque.worker(concurrencyJobName, handler);

			// Enqueue more jobs than the concurrency limit
			for (let i = 0; i < 5; i++) {
				await monque.enqueue(concurrencyJobName, { index: i });
			}

			monque.start();

			await waitFor(async () => handler.mock.calls.length === 5, { timeout: 10000 });

			expect(maxConcurrent).toBeLessThanOrEqual(defaultConcurrency);
			expect(maxConcurrent).toBeGreaterThan(0);
		});

		it('should respect worker-specific concurrency option', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50, defaultConcurrency: 10 });
			const limitedJobName = 'limited-job';
			monqueInstances.push(monque);
			await monque.initialize();

			let maxConcurrent = 0;
			let currentConcurrent = 0;
			const workerConcurrency = 1; // Override to 1

			const handler = vi.fn(async () => {
				currentConcurrent++;
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
				await new Promise((r) => setTimeout(r, 100));
				currentConcurrent--;
			});
			monque.worker(limitedJobName, handler, { concurrency: workerConcurrency });

			// Enqueue multiple jobs
			for (let i = 0; i < 3; i++) {
				await monque.enqueue(limitedJobName, { index: i });
			}

			monque.start();

			await waitFor(async () => handler.mock.calls.length === 3, { timeout: 5000 });

			expect(maxConcurrent).toBe(workerConcurrency);
		});

		it('should allow different concurrency per worker type', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			const jobTypeAName = 'type-a';
			const jobTypeBName = 'type-b';
			monqueInstances.push(monque);
			await monque.initialize();

			let maxConcurrentA = 0;
			let currentConcurrentA = 0;
			let maxConcurrentB = 0;
			let currentConcurrentB = 0;

			const handlerA = vi.fn(async () => {
				currentConcurrentA++;
				maxConcurrentA = Math.max(maxConcurrentA, currentConcurrentA);
				await new Promise((r) => setTimeout(r, 150));
				currentConcurrentA--;
			});

			const handlerB = vi.fn(async () => {
				currentConcurrentB++;
				maxConcurrentB = Math.max(maxConcurrentB, currentConcurrentB);
				await new Promise((r) => setTimeout(r, 150));
				currentConcurrentB--;
			});

			monque.worker(jobTypeAName, handlerA, { concurrency: 2 });
			monque.worker(jobTypeBName, handlerB, { concurrency: 4 });

			// Enqueue jobs for both types
			for (let i = 0; i < 4; i++) {
				await monque.enqueue(jobTypeAName, { index: i });
				await monque.enqueue(jobTypeBName, { index: i });
			}

			monque.start();

			await waitFor(
				async () => handlerA.mock.calls.length === 4 && handlerB.mock.calls.length === 4,
				{ timeout: 10000 },
			);

			expect(maxConcurrentA).toBeLessThanOrEqual(2);
			expect(maxConcurrentB).toBeLessThanOrEqual(4);
		});

		it('should process more jobs as slots become available', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const concurrency = 2;
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				defaultConcurrency: concurrency,
			});
			const slotJobName = 'slot-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const processedOrder: number[] = [];

			const handler = vi.fn(async (job: Job<{ index: number }>) => {
				await new Promise((r) => setTimeout(r, 100));
				processedOrder.push(job.data.index);
			});
			monque.worker(slotJobName, handler);

			// Enqueue 4 jobs
			for (let i = 0; i < 4; i++) {
				await monque.enqueue(slotJobName, { index: i });
			}

			monque.start();

			await waitFor(async () => processedOrder.length === 4, { timeout: 5000 });

			// All jobs should have been processed
			expect(processedOrder).toHaveLength(4);
			expect(processedOrder.sort()).toEqual([0, 1, 2, 3]);
		});
	});

	describe('start() and stop()', () => {
		it('should not process jobs before start() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const noStartJobName = 'no-start-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(noStartJobName, handler);

			await monque.enqueue(noStartJobName, {});

			// Wait some time without calling start()
			await new Promise((r) => setTimeout(r, 300));

			expect(handler).not.toHaveBeenCalled();
		});

		it('should stop processing after stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const stopJobName = 'stop-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(stopJobName, handler);

			monque.start();
			await monque.stop();

			// Enqueue job after stop
			await monque.enqueue(stopJobName, {});

			// Wait and verify no processing
			await new Promise((r) => setTimeout(r, 300));

			expect(handler).not.toHaveBeenCalled();
		});

		it('should allow restart after stop()', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			const restartJobName = 'restart-job';
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(restartJobName, handler);

			monque.start();
			await monque.stop();

			// Enqueue job and restart
			await monque.enqueue(restartJobName, {});
			monque.start();

			await waitFor(async () => handler.mock.calls.length > 0);

			expect(handler).toHaveBeenCalledTimes(1);
		});
	});
});
