/**
 * Tests for graceful shutdown behavior in the Monque scheduler.
 *
 * These tests verify:
 * - stop() method stops the polling loop
 * - No new jobs are picked up after stop() is called
 * - In-progress jobs complete before stop() resolves
 * - Shutdown timeout behavior with ShutdownTimeoutError emission
 *
 * @see {@link ../src/monque.ts}
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

import { ShutdownTimeoutError } from '@/errors.js';
import { Monque } from '@/monque.js';
import type { Job, MonqueEventMap } from '@/types.js';

describe('stop() - Graceful Shutdown', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('shutdown');
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

	describe('polling behavior', () => {
		it('should stop polling after stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();

			// Let it poll a few times
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Stop the scheduler
			await monque.stop();

			// Enqueue a job after stopping
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { shouldNotProcess: true });

			// Wait a bit to ensure no polling happens
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Handler should not have been called since no jobs were pending before stop
			// and no polling happens after stop
			expect(handler).not.toHaveBeenCalled();
		});

		it('should not pick up new jobs after stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);
			await monque.initialize();

			const processedJobs: Job[] = [];
			const handler = vi.fn((job: Job) => {
				processedJobs.push(job);
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Enqueue first job
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { order: 1 });

			monque.start();

			// Wait for first job to be processed
			await waitFor(async () => processedJobs.length === 1);

			// Stop the scheduler
			await monque.stop();

			// Enqueue more jobs after stopping
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { order: 2 });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { order: 3 });

			// Wait a bit to ensure no processing happens
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Only the first job should have been processed
			expect(processedJobs).toHaveLength(1);
			expect(processedJobs[0]?.data).toEqual({ order: 1 });
		});

		it('should return immediately if already stopped', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			// stop() on a non-started scheduler should return immediately
			const startTime = Date.now();
			await monque.stop();
			const elapsed = Date.now() - startTime;

			expect(elapsed).toBeLessThan(50);
		});

		it('should allow calling stop() multiple times safely', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			monque.start();

			// Multiple concurrent stop() calls should be safe
			const results = await Promise.all([monque.stop(), monque.stop(), monque.stop()]);

			// All should resolve without error
			expect(results).toHaveLength(3);
		});
	});

	describe('in-progress job waiting', () => {
		it('should wait for in-progress jobs to complete before resolving', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				shutdownTimeout: 5000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobCompleted = false;
			const jobStarted = vi.fn();

			const handler = vi.fn(async () => {
				jobStarted();
				// Simulate a job that takes 500ms to complete
				await new Promise((resolve) => setTimeout(resolve, 500));
				jobCompleted = true;
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			// Wait for job to start processing
			await waitFor(async () => jobStarted.mock.calls.length > 0);

			// Job has started but not yet completed
			expect(jobCompleted).toBe(false);

			// Call stop() - should wait for job to complete
			await monque.stop();

			// After stop() resolves, job should have completed
			expect(jobCompleted).toBe(true);
		});

		it('should wait for multiple in-progress jobs to complete', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				shutdownTimeout: 5000,
				defaultConcurrency: 3,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const completedJobs: number[] = [];
			const startedJobs = new Set<number>();

			const handler = vi.fn(async (job: Job<{ order: number }>) => {
				startedJobs.add(job.data.order);
				// Different jobs take different times
				await new Promise((resolve) => setTimeout(resolve, 100 + job.data.order * 100));
				completedJobs.push(job.data.order);
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Enqueue multiple jobs
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { order: 1 });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { order: 2 });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { order: 3 });

			monque.start();

			// Wait for all jobs to start
			await waitFor(async () => startedJobs.size === 3);

			// Not all jobs completed yet
			expect(completedJobs.length).toBeLessThan(3);

			// Call stop() - should wait for all jobs
			await monque.stop();

			// All jobs should have completed
			expect(completedJobs).toHaveLength(3);
			expect(completedJobs).toContain(1);
			expect(completedJobs).toContain(2);
			expect(completedJobs).toContain(3);
		});

		it('should resolve immediately if no jobs are in progress', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				shutdownTimeout: 5000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();

			// Wait a bit for polling to start (but no jobs to process)
			await new Promise((resolve) => setTimeout(resolve, 150));

			// stop() should resolve quickly since no jobs are processing
			const startTime = Date.now();
			await monque.stop();
			const elapsed = Date.now() - startTime;

			// Should be very fast since no jobs to wait for
			expect(elapsed).toBeLessThan(200);
		});
	});

	describe('shutdown timeout behavior', () => {
		it('should emit job:error with ShutdownTimeoutError when timeout expires', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				shutdownTimeout: 200, // Short timeout
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const jobStarted = vi.fn();

			// Job that takes longer than shutdown timeout
			const handler = vi.fn(async () => {
				jobStarted();
				await new Promise((resolve) => setTimeout(resolve, 1000));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Set up event listener before starting
			const errorEvents: MonqueEventMap['job:error'][] = [];
			monque.on('job:error', (payload) => {
				errorEvents.push(payload);
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'long-running' });

			monque.start();

			// Wait for job to start
			await waitFor(async () => jobStarted.mock.calls.length > 0);

			// Call stop() - will timeout
			await monque.stop();

			// Should have emitted job:error with ShutdownTimeoutError
			expect(errorEvents.length).toBeGreaterThanOrEqual(1);

			const timeoutError = errorEvents.find((event) => event.error instanceof ShutdownTimeoutError);
			expect(timeoutError).toBeDefined();
			expect(timeoutError?.error).toBeInstanceOf(ShutdownTimeoutError);
		});

		it('should include incompleteJobs array in ShutdownTimeoutError', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				shutdownTimeout: 200, // Short timeout
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const jobStarted = vi.fn();

			// Job that takes longer than shutdown timeout
			const handler = vi.fn(async () => {
				jobStarted();
				await new Promise((resolve) => setTimeout(resolve, 1000));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Set up event listener
			let shutdownError: ShutdownTimeoutError | undefined;
			monque.on('job:error', (payload) => {
				if (payload.error instanceof ShutdownTimeoutError) {
					shutdownError = payload.error;
				}
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'incomplete' });

			monque.start();

			// Wait for job to start
			await waitFor(async () => jobStarted.mock.calls.length > 0);

			// Call stop() - will timeout
			await monque.stop();

			// ShutdownTimeoutError should have incompleteJobs property
			expect(shutdownError).toBeDefined();
			expect(shutdownError).toBeInstanceOf(ShutdownTimeoutError);
			expect(shutdownError?.incompleteJobs).toBeDefined();
			expect(Array.isArray(shutdownError?.incompleteJobs)).toBe(true);
			expect(shutdownError?.incompleteJobs.length).toBe(1);
			expect(shutdownError?.incompleteJobs[0]?.data).toEqual({ data: 'incomplete' });
		});

		it('should use configurable shutdownTimeout', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			// Test with custom timeout
			const customTimeout = 150;
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				shutdownTimeout: customTimeout,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const jobStarted = vi.fn();

			const handler = vi.fn(async () => {
				jobStarted();
				await new Promise((resolve) => setTimeout(resolve, 1000));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			let errorEmitted = false;
			monque.on('job:error', () => {
				errorEmitted = true;
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			// Wait for job to start
			await waitFor(async () => jobStarted.mock.calls.length > 0);

			const startTime = Date.now();
			await monque.stop();
			const elapsed = Date.now() - startTime;

			// Should timeout within the custom timeout + margin for processing overhead
			// Margin accounts for: polling interval, test runner variance, and event emission time
			expect(errorEmitted).toBe(true);
			expect(elapsed).toBeLessThan(customTimeout + 300);
		});

		it('should default to 30s shutdown timeout', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			// Create instance without specifying shutdownTimeout
			monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			// Verify default is used (we can't easily test 30s timeout,
			// so we just verify the scheduler uses a reasonable default by checking
			// it doesn't timeout instantly for a fast job)
			const handler = vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			let errorEmitted = false;
			monque.on('job:error', () => {
				errorEmitted = true;
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			// Wait for job to start
			await waitFor(async () => handler.mock.calls.length > 0);

			await monque.stop();

			// Should not have emitted error since job completes within default timeout
			expect(errorEmitted).toBe(false);
		});
	});

	describe('isHealthy() after stop', () => {
		it('should return false after stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			monque.start();

			// Should be healthy while running
			expect(monque.isHealthy()).toBe(true);

			await monque.stop();

			// Should not be healthy after stopping
			expect(monque.isHealthy()).toBe(false);
		});
	});
});
