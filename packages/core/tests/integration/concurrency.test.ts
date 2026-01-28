/**
 * Integration tests for concurrency and race conditions.
 *
 * These tests verify:
 * - SC-006: Multiple scheduler instances can process jobs concurrently without duplicate processing
 * - High volume job processing with multiple workers
 *
 * @see {@link ../../src/scheduler/monque.ts}
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Concurrency & Scalability', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('concurrency');
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

	it('should process 100 jobs with 3 scheduler instances without duplicates', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const jobCount = 100;
		const instanceCount = 3;

		// Create multiple Monque instances sharing the same collection
		for (let i = 0; i < instanceCount; i++) {
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50, // Fast polling for test
				workerConcurrency: 5,
			});
			monqueInstances.push(monque);
			await monque.initialize();
		}

		// Track processed jobs
		const processedJobs = new Set<number>();
		const duplicateJobs = new Set<number>();
		const processingErrors: Error[] = [];

		// Define handler that tracks execution
		const handler = async (job: Job<{ id: number }>) => {
			const id = job.data.id;
			if (processedJobs.has(id)) {
				duplicateJobs.add(id);
			}
			processedJobs.add(id);
			// Simulate some work
			await new Promise((resolve) => setTimeout(resolve, 10));
		};

		// Register worker on all instances
		for (const monque of monqueInstances) {
			monque.register(TEST_CONSTANTS.JOB_NAME, handler);
			monque.on('job:error', (payload) => processingErrors.push(payload.error));
		}

		// Enqueue jobs using the first instance
		const firstInstance = monqueInstances[0];
		if (!firstInstance) {
			throw new Error('No Monque instance available');
		}
		const enqueuePromises = [];
		for (let i = 0; i < jobCount; i++) {
			enqueuePromises.push(firstInstance.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i }));
		}
		await Promise.all(enqueuePromises);

		// Start all instances
		for (const m of monqueInstances) {
			m.start();
		}

		// Wait for all jobs to be processed
		await waitFor(async () => processedJobs.size === jobCount, {
			timeout: 30000,
		});

		// Verify results
		expect(processedJobs.size).toBe(jobCount);
		expect(duplicateJobs.size).toBe(0);
		expect(processingErrors).toHaveLength(0);

		// Verify in DB that all are completed
		await waitFor(
			async () => {
				const count = await db
					.collection(collectionName)
					.countDocuments({ status: JobStatus.COMPLETED });
				return count === jobCount;
			},
			{ timeout: 10000 },
		);

		const count = await db
			.collection(collectionName)
			.countDocuments({ status: JobStatus.COMPLETED });
		expect(count).toBe(jobCount);
	});
});

describe('Instance-level Concurrency (instanceConcurrency)', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('max-concurrency');
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

	it('should limit total concurrent jobs to instanceConcurrency', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

		const instanceConcurrency = 3;
		const stats = {
			active: 0,
			max: 0,
			completed: 0,
			inc() {
				this.active++;
				if (this.active > this.max) {
					this.max = this.active;
				}
			},
			dec() {
				this.active--;
				this.completed++;
			},
		};

		const monque = new Monque(db, {
			collectionName,
			pollInterval: 500, // Slower polling to avoid race conditions in test
			instanceConcurrency, // Limit to 3 concurrent jobs total
			workerConcurrency: 10, // Each worker could do 10, but global limit is 3
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Handler that tracks concurrent execution
		const handler = async (_job: Job) => {
			stats.inc();

			// Simulate work - longer than poll interval to test proper throttling
			await new Promise((resolve) => setTimeout(resolve, 200));

			stats.dec();
		};

		// Register two workers - each has concurrency 10, but global limit is 3
		monque.register('worker-a', handler);
		monque.register('worker-b', handler);

		// Enqueue 5 jobs for each worker (10 total)
		for (let i = 0; i < 5; i++) {
			await monque.enqueue('worker-a', { id: i });
			await monque.enqueue('worker-b', { id: i });
		}

		monque.start();

		// Wait for all jobs to complete
		await waitFor(async () => stats.completed >= 10, { timeout: 30000 });

		// Max concurrent should never exceed instanceConcurrency (3)
		expect(stats.max).toBeLessThanOrEqual(instanceConcurrency);
		expect(stats.completed).toBe(10);
	});

	it('should process all jobs with instanceConcurrency even when limit is lower than worker concurrency', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

		let completedJobs = 0;

		const monque = new Monque(db, {
			collectionName,
			pollInterval: 50,
			instanceConcurrency: 2,
			workerConcurrency: 5,
		});
		monqueInstances.push(monque);
		await monque.initialize();

		const handler = async (_job: Job) => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			completedJobs++;
		};

		monque.register('test-job', handler);

		// Enqueue 6 jobs
		for (let i = 0; i < 6; i++) {
			await monque.enqueue('test-job', { id: i });
		}

		monque.start();

		// Wait for all jobs to complete
		await waitFor(async () => completedJobs >= 6, { timeout: 10000 });

		expect(completedJobs).toBe(6);

		// Verify all completed in DB
		const count = await db
			.collection(collectionName)
			.countDocuments({ status: JobStatus.COMPLETED });
		expect(count).toBe(6);
	});

	it('should work normally without instanceConcurrency set', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

		let activeJobs = 0;
		let maxActiveJobs = 0;
		let completedJobs = 0;

		const monque = new Monque(db, {
			collectionName,
			pollInterval: 50,
			// No instanceConcurrency set
			workerConcurrency: 5,
		});
		monqueInstances.push(monque);
		await monque.initialize();

		const handler = async (_job: Job) => {
			activeJobs++;
			maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
			await new Promise((resolve) => setTimeout(resolve, 50));
			activeJobs--;
			completedJobs++;
		};

		monque.register('test-job', handler);

		// Enqueue 10 jobs
		for (let i = 0; i < 10; i++) {
			await monque.enqueue('test-job', { id: i });
		}

		monque.start();

		await waitFor(async () => completedJobs >= 10, { timeout: 10000 });

		// Without instanceConcurrency, should be able to run up to workerConcurrency (5)
		expect(maxActiveJobs).toBeLessThanOrEqual(5);
		expect(maxActiveJobs).toBeGreaterThan(1); // Should have some concurrency
		expect(completedJobs).toBe(10);
	});
});
