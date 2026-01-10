/**
 * Tests for job lifecycle events and observability in the Monque scheduler.
 *
 * These tests verify:
 * - job:start event emission
 * - job:complete event emission with duration
 * - job:fail event emission with error and retry status
 * - job:error event emission for unexpected errors
 * - isHealthy() status reporting
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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MonqueEventMap } from '@/events';
import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Monitor Job Lifecycle Events', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('events');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await stopMonqueInstances(monqueInstances);

		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('job:start event', () => {
		it('should emit job:start when processing begins', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);
			await monque.initialize();

			const startEvents: Job[] = [];
			monque.on('job:start', (job) => {
				startEvents.push({ ...job });
			});

			const handler = vi.fn();
			monque.register(TEST_CONSTANTS.JOB_NAME, handler);

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			await waitFor(async () => startEvents.length > 0);

			expect(startEvents).toHaveLength(1);
			expect(startEvents[0]?.name).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(startEvents[0]?.status).toBe(JobStatus.PROCESSING);
		});
	});

	describe('job:complete event', () => {
		it('should emit job:complete with duration when job finishes successfully', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);
			await monque.initialize();

			const completeEvents: MonqueEventMap['job:complete'][] = [];
			monque.on('job:complete', (payload) => {
				completeEvents.push(payload);
			});

			const handler = vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
			});
			monque.register(TEST_CONSTANTS.JOB_NAME, handler);

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			await waitFor(async () => completeEvents.length > 0);

			expect(completeEvents).toHaveLength(1);
			expect(completeEvents[0]?.job.name).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(completeEvents[0]?.job.status).toBe(JobStatus.COMPLETED);
			expect(completeEvents[0]?.duration).toBeGreaterThanOrEqual(45); // Allow 5ms tolerance for timer precision
		});
	});

	describe('job:fail event', () => {
		it('should emit job:fail with error and willRetry=true when job fails and has retries left', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 3,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const failEvents: MonqueEventMap['job:fail'][] = [];
			monque.on('job:fail', (payload) => {
				failEvents.push(payload);
			});

			const error = new Error('Task failed');
			const handler = vi.fn().mockRejectedValue(error);
			monque.register(TEST_CONSTANTS.JOB_NAME, handler);

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			await waitFor(async () => failEvents.length > 0);

			expect(failEvents).toHaveLength(1);
			expect(failEvents[0]?.job.name).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(failEvents[0]?.error.message).toBe('Task failed');
			expect(failEvents[0]?.willRetry).toBe(true);
		});

		it('should emit job:fail with willRetry=false when job fails and max retries reached', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 1, // Only 1 attempt allowed (0 retries)
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const failEvents: MonqueEventMap['job:fail'][] = [];
			monque.on('job:fail', (payload) => {
				failEvents.push(payload);
			});

			const handler = vi.fn().mockRejectedValue(new Error('Final failure'));
			monque.register(TEST_CONSTANTS.JOB_NAME, handler);

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test' });

			monque.start();

			await waitFor(async () => failEvents.length > 0);

			expect(failEvents).toHaveLength(1);
			expect(failEvents[0]?.willRetry).toBe(false);
		});
	});

	describe('job:error event', () => {
		it('should emit job:error for unexpected errors', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);

			// Register a worker so poll() has something to do and reaches the database
			monque.register(TEST_CONSTANTS.JOB_NAME, async () => {});

			const errorEvents: MonqueEventMap['job:error'][] = [];
			monque.on('job:error', (payload) => {
				errorEvents.push(payload);
			});

			// Mock findOneAndUpdate to throw an error during polling
			// This avoids mocking private methods and couples the test to the data layer dependency instead
			const collection = db.collection(collectionName);
			vi.spyOn(collection, 'findOneAndUpdate').mockRejectedValue(new Error('Poll error'));
			vi.spyOn(db, 'collection').mockReturnValue(collection);

			await monque.initialize();
			monque.start();

			await waitFor(async () => errorEvents.length > 0);

			expect(errorEvents.length).toBeGreaterThan(0);
			expect(errorEvents[0]?.error.message).toBe('Poll error');
		});
	});

	describe('isHealthy()', () => {
		it('should return true when running and initialized', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			expect(monque.isHealthy()).toBe(false); // Not started yet

			monque.start();
			expect(monque.isHealthy()).toBe(true);
		});

		it('should return false when stopped', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			monque.start();
			await monque.stop();

			expect(monque.isHealthy()).toBe(false);
		});
	});

	describe('event listener methods', () => {
		it('should remove listener with off() method', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);
			await monque.initialize();

			const startEvents: Job[] = [];
			const listener = (job: Job) => {
				startEvents.push(job);
			};

			// Add listener
			monque.on('job:start', listener);

			// Register worker and enqueue job
			monque.register(TEST_CONSTANTS.JOB_NAME, async () => {});
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test1' });

			monque.start();
			await waitFor(async () => startEvents.length > 0);
			expect(startEvents).toHaveLength(1);

			// Remove listener
			monque.off('job:start', listener);

			// Enqueue another job
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test2' });
			await waitFor(
				async () => {
					const jobs = await monque.getJobs({ status: JobStatus.COMPLETED });
					return jobs.length >= 2;
				},
				{ timeout: 5000 },
			);

			// Listener should not have received the second event
			expect(startEvents).toHaveLength(1);
		});

		it('should fire listener only once with once() method', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50 });
			monqueInstances.push(monque);
			await monque.initialize();

			const completeEvents: MonqueEventMap['job:complete'][] = [];
			monque.once('job:complete', (payload) => {
				completeEvents.push(payload);
			});

			// Register worker and enqueue multiple jobs
			monque.register(TEST_CONSTANTS.JOB_NAME, async () => {});
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test1' });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test2' });
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: 'test3' });

			monque.start();

			// Wait for all jobs to complete
			await waitFor(
				async () => {
					const jobs = await monque.getJobs({ status: JobStatus.COMPLETED });
					return jobs.length >= 3;
				},
				{ timeout: 5000 },
			);

			// once() listener should have fired only once
			expect(completeEvents).toHaveLength(1);
		});
	});
});
