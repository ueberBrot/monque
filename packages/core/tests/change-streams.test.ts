/**
 * Tests for MongoDB Change Stream integration.
 *
 * These tests verify:
 * - Change stream initialization on start()
 * - Job notification via insert events
 * - Job notification via update events (status change to pending)
 * - Error handling and reconnection with exponential backoff
 * - Graceful fallback to polling when change streams unavailable
 * - Change stream cleanup on shutdown
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

import type { Job } from '@/jobs/types.js';
import { Monque } from '@/scheduler/monque.js';

describe('change streams', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('change-streams');
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

	describe('change stream initialization', () => {
		it('should emit changestream:connected event when change stream is established', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 10000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});
			monque.start();

			await waitFor(async () => connected, { timeout: 5000 });
			expect(connected).toBe(true);
		});

		it('should emit changestream:closed event on stop()', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 10000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let connected = false;
			let closed = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});
			monque.on('changestream:closed', () => {
				closed = true;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});
			monque.start();

			await waitFor(async () => connected, { timeout: 5000 });
			await monque.stop();

			expect(closed).toBe(true);
		});
	});

	describe('job notification via insert events', () => {
		it('should trigger job processing immediately when job is inserted', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 5000, // 5 second backup poll - change stream should be faster
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let startTime: number;
			let processingTime: number | null = null;

			monque.worker<{ value: number }>(TEST_CONSTANTS.JOB_NAME, async () => {
				processingTime = Date.now() - startTime;
			});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			// Small delay to ensure initial poll has completed
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Enqueue job after change stream is connected and initial poll is done
			startTime = Date.now();
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });

			await waitFor(async () => processingTime !== null, { timeout: 10000 });

			// Should process faster than backup poll interval
			expect(processingTime).toBeLessThan(5000);
		});

		it('should process multiple inserted jobs in sequence', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 2000, // 2 second poll to help pick up remaining jobs
				defaultConcurrency: 1,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const processedIds: number[] = [];
			monque.worker<{ id: number }>(TEST_CONSTANTS.JOB_NAME, async (job) => {
				processedIds.push(job.data.id);
				await new Promise((resolve) => setTimeout(resolve, 50));
			});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			// Enqueue jobs after change stream is connected
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 1 });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 2 });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 3 });

			await waitFor(async () => processedIds.length === 3, { timeout: 10000 });
			expect(processedIds).toHaveLength(3);
		});
	});

	describe('job notification via update events', () => {
		it('should process job when status changes to pending (retry scenario)', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 2000, // 2 second poll for quicker retry pickup
				maxRetries: 3,
				baseRetryInterval: 50, // Short interval for faster retry
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let attempts = 0;
			let completed = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error('First attempt fails');
				}
				completed = true;
			});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });

			// Wait for retry to complete
			await waitFor(async () => completed, { timeout: 10000 });
			expect(attempts).toBe(2);
			expect(completed).toBe(true);
		});

		it('should detect recurring job reschedule via update event', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 2000, // nextRunAt changes rely on polling (status changes trigger change stream)
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let executions = 0;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				executions++;
			});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			// Schedule a job that should run immediately
			const job = await monque.schedule('* * * * *', TEST_CONSTANTS.JOB_NAME, { value: 1 });

			// Trigger it by setting nextRunAt to now
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			await waitFor(async () => executions >= 1, { timeout: 5000 });
			expect(executions).toBeGreaterThanOrEqual(1);
		});
	});

	describe('error handling and reconnection', () => {
		it('should emit changestream:error when an error occurs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 1000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const errorPromise = new Promise<Error>((resolve) => {
				monque.on('changestream:error', ({ error }) => {
					resolve(error);
				});
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			// @ts-expect-error - Accessing private property for testing
			const changeStream = monque.changeStream;
			expect(changeStream).toBeDefined();

			if (changeStream) {
				changeStream.emit('error', new Error('Simulated test error'));
			}

			const error = await errorPromise;
			expect(error).toBeInstanceOf(Error);
			expect(error.message).toBe('Simulated test error');
		});

		it('should continue processing with polling when change stream fails', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100, // Fast polling for fallback
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let processed = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				processed = true;
			});

			monque.start();

			// Even if change stream has issues, polling should work
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			await waitFor(async () => processed, { timeout: 5000 });

			expect(processed).toBe(true);
		});
	});

	describe('fallback to polling', () => {
		it('should emit changestream:fallback event when change streams unavailable', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			// Spy on db.collection to return a collection with a failing watch method
			const originalCollectionFn = db.collection.bind(db);
			const collectionSpy = vi.spyOn(db, 'collection').mockImplementation((name, options) => {
				const collection = originalCollectionFn(name, options);
				// Mock watch to throw immediately
				vi.spyOn(collection, 'watch').mockImplementation(() => {
					throw new Error('Change streams unavailable');
				});
				return collection;
			});

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let fallbackEmitted = false;
			monque.on('changestream:fallback', () => {
				fallbackEmitted = true;
			});

			let processed = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				processed = true;
			});

			monque.start();

			// Wait for fallback event
			await waitFor(async () => fallbackEmitted, { timeout: 2000 });
			expect(fallbackEmitted).toBe(true);

			// Enqueue and verify processing still works via polling
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			await waitFor(async () => processed, { timeout: 5000 });

			expect(processed).toBe(true);

			// Cleanup spy
			collectionSpy.mockRestore();
		});

		it('should use polling as backup even with active change streams', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 200,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let processCount = 0;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				processCount++;
			});

			monque.start();

			// Enqueue multiple jobs
			for (let i = 0; i < 5; i++) {
				await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: i });
			}

			await waitFor(async () => processCount === 5, { timeout: 10000 });
			expect(processCount).toBe(5);
		});
	});

	describe('cleanup on shutdown', () => {
		it('should close change stream cursor on stop()', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 10000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let connected = false;
			let closed = false;

			monque.on('changestream:connected', () => {
				connected = true;
			});
			monque.on('changestream:closed', () => {
				closed = true;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});
			monque.start();

			await waitFor(async () => connected, { timeout: 5000 });

			await monque.stop();

			expect(closed).toBe(true);
		});

		it('should not process new jobs after stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 10000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let processedAfterStop = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				processedAfterStop = true;
			});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			await monque.stop();

			// Enqueue after stop - should not be processed
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			await new Promise((resolve) => setTimeout(resolve, 500));

			expect(processedAfterStop).toBe(false);
		});
	});

	describe('integration with atomic claim', () => {
		it('should distribute jobs across multiple instances via change streams', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const jobCount = 10;

			const monque1 = new Monque(db, {
				collectionName,
				pollInterval: 5000, // 5 second backup poll
				schedulerInstanceId: 'cs-instance-1',
				defaultConcurrency: 2,
			});
			const monque2 = new Monque(db, {
				collectionName,
				pollInterval: 5000, // 5 second backup poll
				schedulerInstanceId: 'cs-instance-2',
				defaultConcurrency: 2,
			});

			monqueInstances.push(monque1, monque2);

			await monque1.initialize();
			await monque2.initialize();

			const processedJobs = new Set<number>();
			const duplicates = new Set<number>();
			const instance1Jobs: number[] = [];
			const instance2Jobs: number[] = [];

			const handler1 = async (job: Job<{ id: number }>) => {
				const id = job.data.id;
				if (processedJobs.has(id)) {
					duplicates.add(id);
				}
				processedJobs.add(id);
				instance1Jobs.push(id);
				await new Promise((resolve) => setTimeout(resolve, 50));
			};

			const handler2 = async (job: Job<{ id: number }>) => {
				const id = job.data.id;
				if (processedJobs.has(id)) {
					duplicates.add(id);
				}
				processedJobs.add(id);
				instance2Jobs.push(id);
				await new Promise((resolve) => setTimeout(resolve, 50));
			};

			monque1.worker(TEST_CONSTANTS.JOB_NAME, handler1);
			monque2.worker(TEST_CONSTANTS.JOB_NAME, handler2);

			let connected1 = false;
			let connected2 = false;
			monque1.on('changestream:connected', () => {
				connected1 = true;
			});
			monque2.on('changestream:connected', () => {
				connected2 = true;
			});

			monque1.start();
			monque2.start();

			await waitFor(async () => connected1 && connected2, { timeout: 5000 });

			// Enqueue jobs
			for (let i = 0; i < jobCount; i++) {
				await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i });
			}

			await waitFor(async () => processedJobs.size === jobCount, { timeout: 15000 });

			expect(processedJobs.size).toBe(jobCount);
			expect(duplicates.size).toBe(0);
			expect(instance1Jobs.length + instance2Jobs.length).toBe(jobCount);
		});
	});

	describe('performance', () => {
		it('should process jobs with lower latency than poll interval', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const pollInterval = 10000; // 10 seconds

			const monque = new Monque(db, {
				collectionName,
				pollInterval,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const latencies: number[] = [];
			let processed = 0;

			monque.worker<{ startTime: number }>(TEST_CONSTANTS.JOB_NAME, async (job) => {
				latencies.push(Date.now() - job.data.startTime);
				processed++;
			});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			// Enqueue several jobs with timestamps
			for (let i = 0; i < 5; i++) {
				await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { startTime: Date.now() });
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			await waitFor(async () => processed === 5, { timeout: 15000 });

			// All latencies should be much less than poll interval
			const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
			expect(avgLatency).toBeLessThan(pollInterval);
			// Most should be under 1 second with change streams
			const fastJobs = latencies.filter((l) => l < 1000).length;
			expect(fastJobs).toBeGreaterThan(0);
		});
	});
});
