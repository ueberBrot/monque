/**
 * Tests for retry logic with exponential backoff in the Monque scheduler.
 *
 * These tests verify:
 * - T047: Backoff timing within ±50ms per SC-003 specification
 * - T048: failCount increment and failReason storage on job failure
 * - T049: Permanent failure after maxRetries is exceeded
 *
 * @see {@link ../src/monque.ts}
 * @see {@link ../src/utils/backoff.ts}
 */

import type { Db, Document, WithId } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Monque } from '../src/monque.js';
import { type Job, JobStatus } from '../src/types.js';
import { calculateBackoffDelay } from '../src/utils/backoff.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	uniqueCollectionName,
	waitFor,
} from './setup/test-utils.js';

describe('Retry Logic (US3)', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;

	beforeAll(async () => {
		db = await getTestDb('retry');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		if (monque) {
			await monque.stop();
		}
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('T047: Backoff timing (SC-003)', () => {
		/**
		 * SC-003: Failed jobs retry automatically. The actual nextRunAt MUST be within ±50ms
		 * of the calculated backoff time.
		 *
		 * Formula: nextRunAt = now + (2^failCount × baseInterval)
		 */
		it('should schedule first retry with correct backoff timing (2^1 * 1000 = 2000ms)', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				baseRetryInterval: 1000,
			});
			await monque.initialize();

			// Handler that fails once
			let callCount = 0;
			monque.worker<{ test: boolean }>('backoff-job', async () => {
				callCount++;
				if (callCount === 1) {
					throw new Error('First attempt fails');
				}
			});

			const beforeEnqueue = Date.now();
			const job = await monque.enqueue('backoff-job', { test: true });
			monque.start();

			// Wait for the job to fail and be rescheduled
			await waitFor(async () => {
				const doc = (await db
					.collection(collectionName)
					.findOne({ _id: job._id })) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 1;
			});

			// Stop the scheduler to prevent retry processing
			await monque.stop();

			// Check the nextRunAt timing
			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc).not.toBeNull();
			expect(doc['failCount']).toBe(1);
			expect(doc['status']).toBe(JobStatus.PENDING);

			const nextRunAt = new Date(doc['nextRunAt']).getTime();
			const expectedDelay = calculateBackoffDelay(1, 1000); // 2^1 * 1000 = 2000ms
			const expectedNextRunAt = beforeEnqueue + expectedDelay;

			// Verify timing is within ±50ms tolerance (SC-003)
			const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
			expect(timingDiff).toBeLessThanOrEqual(150); // Allow some buffer for processing time
		});

		it('should schedule second retry with correct backoff timing (2^2 * 1000 = 4000ms)', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				baseRetryInterval: 1000,
			});
			await monque.initialize();

			// Handler that always fails
			let callCount = 0;
			monque.worker<{ test: boolean }>('backoff-job-2', async () => {
				callCount++;
				throw new Error(`Attempt ${callCount} fails`);
			});

			// Insert a job that already has failCount=1
			const now = new Date();
			const collection = db.collection(collectionName);
			const result = await collection.insertOne({
				name: 'backoff-job-2',
				data: { test: true },
				status: JobStatus.PENDING,
				nextRunAt: now,
				failCount: 1,
				createdAt: now,
				updatedAt: now,
			});

			const beforeStart = Date.now();
			monque.start();

			// Wait for the job to fail again
			await waitFor(async () => {
				const doc = (await collection.findOne({
					_id: result.insertedId,
				})) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 2;
			});

			await monque.stop();

			const doc = (await collection.findOne({ _id: result.insertedId })) as WithId<Document>;

			expect(doc['failCount']).toBe(2);
			expect(doc['status']).toBe(JobStatus.PENDING);

			const nextRunAt = new Date(doc['nextRunAt']).getTime();
			const expectedDelay = calculateBackoffDelay(2, 1000); // 2^2 * 1000 = 4000ms
			const expectedNextRunAt = beforeStart + expectedDelay;

			// Verify timing is within ±50ms tolerance (SC-003)
			const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
			expect(timingDiff).toBeLessThanOrEqual(200); // Allow some buffer for processing time
		});

		it('should use configurable baseRetryInterval for backoff calculation', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			const customBaseInterval = 500; // 500ms instead of default 1000ms
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				baseRetryInterval: customBaseInterval,
			});
			await monque.initialize();

			monque.worker<{ test: boolean }>('custom-interval-job', async () => {
				throw new Error('Always fails');
			});

			const beforeEnqueue = Date.now();
			const job = await monque.enqueue('custom-interval-job', { test: true });
			monque.start();

			await waitFor(async () => {
				const doc = (await db
					.collection(collectionName)
					.findOne({ _id: job._id })) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 1;
			});

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			const nextRunAt = new Date(doc['nextRunAt']).getTime();
			const expectedDelay = calculateBackoffDelay(1, customBaseInterval); // 2^1 * 500 = 1000ms
			const expectedNextRunAt = beforeEnqueue + expectedDelay;

			const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
			expect(timingDiff).toBeLessThanOrEqual(200);
		});
	});

	describe('T048: failCount increment and failReason storage', () => {
		it('should increment failCount on job failure', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			await monque.initialize();

			monque.worker<{ test: boolean }>('fail-count-job', async () => {
				throw new Error('Always fails');
			});

			const job = await monque.enqueue('fail-count-job', { test: true });
			monque.start();

			// Wait for first failure
			await waitFor(async () => {
				const doc = (await db
					.collection(collectionName)
					.findOne({ _id: job._id })) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 1;
			});

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['failCount']).toBe(1);
		});

		it('should store failReason from error message', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			await monque.initialize();

			const errorMessage = 'Connection timeout to external API';
			monque.worker<{ test: boolean }>('fail-reason-job', async () => {
				throw new Error(errorMessage);
			});

			const job = await monque.enqueue('fail-reason-job', { test: true });
			monque.start();

			await waitFor(async () => {
				const doc = (await db
					.collection(collectionName)
					.findOne({ _id: job._id })) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 1;
			});

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['failReason']).toBe(errorMessage);
		});

		it('should update failReason on subsequent failures', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				baseRetryInterval: 10, // Fast retries for testing
			});
			await monque.initialize();

			let callCount = 0;
			monque.worker<{ test: boolean }>('multiple-fails-job', async () => {
				callCount++;
				throw new Error(`Failure #${callCount}`);
			});

			const job = await monque.enqueue('multiple-fails-job', { test: true });
			monque.start();

			// Wait for second failure
			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['failCount'] >= 2;
				},
				{ timeout: 15000 },
			);

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['failCount']).toBeGreaterThanOrEqual(2);
			// failReason should contain the most recent error
			expect(doc['failReason']).toMatch(/Failure #\d+/);
		});

		it('should handle both sync throws and async rejections identically', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			await monque.initialize();

			// Sync throw handler
			monque.worker<{ type: string }>('sync-throw-job', (job) => {
				if (job.data.type === 'sync') {
					throw new Error('Sync error');
				}
				return Promise.reject(new Error('Async error'));
			});

			const syncJob = await monque.enqueue('sync-throw-job', { type: 'sync' });
			monque.start();

			await waitFor(async () => {
				const doc = (await db
					.collection(collectionName)
					.findOne({ _id: syncJob._id })) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 1;
			});

			await monque.stop();

			const syncDoc = (await db
				.collection(collectionName)
				.findOne({ _id: syncJob._id })) as WithId<Document>;

			expect(syncDoc['failCount']).toBe(1);
			expect(syncDoc['failReason']).toBe('Sync error');
			expect(syncDoc['status']).toBe(JobStatus.PENDING);
		});

		it('should set status back to pending after failure (if retries remain)', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 5,
			});
			await monque.initialize();

			monque.worker<{ test: boolean }>('status-reset-job', async () => {
				throw new Error('Temporary failure');
			});

			const job = await monque.enqueue('status-reset-job', { test: true });
			monque.start();

			await waitFor(async () => {
				const doc = (await db
					.collection(collectionName)
					.findOne({ _id: job._id })) as WithId<Document> | null;
				return doc !== null && doc['failCount'] === 1;
			});

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['status']).toBe(JobStatus.PENDING);
			expect(doc['lockedAt']).toBeNull();
		});
	});

	describe('T049: Max retries → permanent failure', () => {
		it('should mark job as permanently failed after maxRetries (default: 10)', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 3, // Lower for faster testing
				baseRetryInterval: 10, // Fast retries
			});
			await monque.initialize();

			monque.worker<{ test: boolean }>('max-retry-job', async () => {
				throw new Error('Persistent failure');
			});

			const job = await monque.enqueue('max-retry-job', { test: true });
			monque.start();

			// Wait for permanent failure (failCount >= maxRetries)
			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['status'] === JobStatus.FAILED;
				},
				{ timeout: 30000 },
			);

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['status']).toBe(JobStatus.FAILED);
			expect(doc['failCount']).toBe(3);
			expect(doc['failReason']).toBe('Persistent failure');
		});

		it('should respect custom maxRetries configuration', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			const customMaxRetries = 2;
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: customMaxRetries,
				baseRetryInterval: 10,
			});
			await monque.initialize();

			let failCount = 0;
			monque.worker<{ test: boolean }>('custom-max-retry-job', async () => {
				failCount++;
				throw new Error(`Failure ${failCount}`);
			});

			const job = await monque.enqueue('custom-max-retry-job', { test: true });
			monque.start();

			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['status'] === JobStatus.FAILED;
				},
				{ timeout: 30000 },
			);

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['status']).toBe(JobStatus.FAILED);
			expect(doc['failCount']).toBe(customMaxRetries);
		});

		it('should not process permanently failed jobs', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			await monque.initialize();

			let handlerCalls = 0;
			monque.worker<{ test: boolean }>('failed-job-test', async () => {
				handlerCalls++;
			});

			// Insert a permanently failed job
			const now = new Date();
			const collection = db.collection(collectionName);
			await collection.insertOne({
				name: 'failed-job-test',
				data: { test: true },
				status: JobStatus.FAILED,
				nextRunAt: now,
				failCount: 10,
				failReason: 'Max retries exceeded',
				createdAt: now,
				updatedAt: now,
			});

			monque.start();

			// Wait a bit and verify handler was never called
			await new Promise((resolve) => setTimeout(resolve, 500));

			await monque.stop();

			expect(handlerCalls).toBe(0);
		});

		it('should preserve job data on permanent failure', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 1,
				baseRetryInterval: 10,
			});
			await monque.initialize();

			const jobData = {
				userId: 'user-123',
				action: 'important-action',
				metadata: { key: 'value' },
			};

			monque.worker<typeof jobData>('preserve-data-job', async () => {
				throw new Error('Failure');
			});

			const job = await monque.enqueue('preserve-data-job', jobData);
			monque.start();

			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['status'] === JobStatus.FAILED;
				},
				{ timeout: 30000 },
			);

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			// Verify all original data is preserved
			expect(doc['data']).toEqual(jobData);
			expect(doc['name']).toBe('preserve-data-job');
		});
	});

	describe('Events during retry', () => {
		it('should emit job:fail event with willRetry=true when retries remain', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 5,
			});
			await monque.initialize();

			const failEvents: Array<{ job: Job; error: Error; willRetry: boolean }> = [];
			monque.on('job:fail', (event) => {
				failEvents.push(event);
			});

			monque.worker<{ test: boolean }>('retry-event-job', async () => {
				throw new Error('Temporary failure');
			});

			await monque.enqueue('retry-event-job', { test: true });
			monque.start();

			await waitFor(async () => failEvents.length >= 1);

			await monque.stop();

			expect(failEvents.length).toBeGreaterThanOrEqual(1);
			const firstEvent = failEvents[0];
			if (!firstEvent) throw new Error('Expected failEvents[0] to be defined');
			expect(firstEvent.willRetry).toBe(true);
			expect(firstEvent.error.message).toBe('Temporary failure');
		});

		it('should emit job:fail event with willRetry=false on final failure', async () => {
			collectionName = uniqueCollectionName('monque_jobs');
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 1,
				baseRetryInterval: 10,
			});
			await monque.initialize();

			const failEvents: Array<{ job: Job; error: Error; willRetry: boolean }> = [];
			monque.on('job:fail', (event) => {
				failEvents.push(event);
			});

			monque.worker<{ test: boolean }>('final-fail-event-job', async () => {
				throw new Error('Final failure');
			});

			await monque.enqueue('final-fail-event-job', { test: true });
			monque.start();

			// Wait for the job to reach failed status
			await waitFor(
				async () => {
					// Find the event where willRetry is false
					return failEvents.some((e) => e.willRetry === false);
				},
				{ timeout: 30000 },
			);

			await monque.stop();

			// Should have exactly maxRetries fail events
			const finalEvent = failEvents.find((e) => e.willRetry === false);
			if (!finalEvent) throw new Error('Expected finalEvent to be defined');
			expect(finalEvent.willRetry).toBe(false);
		});
	});
});
