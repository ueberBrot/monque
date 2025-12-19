/**
 * Tests for the schedule() method of the Monque scheduler.
 *
 * These tests verify:
 * - Basic cron job scheduling functionality (T054)
 * - nextRunAt calculation from cron expressions
 * - repeatInterval storage
 * - Invalid cron expression handling with helpful messages (T055)
 * - Recurring job completion and auto-rescheduling (T056)
 * - Cron timing after retries
 *
 * @see {@link ../src/monque.ts}
 * @see User Story 4 - Schedule Recurring Jobs with Cron
 */

import { TEST_CONSTANTS } from '@tests/setup/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@tests/setup/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InvalidCronError } from '@/errors.js';
import { Monque } from '@/monque.js';
import { type Job, JobStatus } from '@/types.js';

describe('schedule()', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('schedule');
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

	// T054: Tests for schedule() method (cron parsing, nextRunAt calculation)
	describe('basic cron scheduling', () => {
		it('should schedule a job with a cron expression', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				TEST_CONSTANTS.JOB_DATA,
			);

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

			const job = await monque.schedule(TEST_CONSTANTS.CRON_EVERY_MINUTE, TEST_CONSTANTS.JOB_NAME, {
				value: 123,
			});

			expect(job.status).toBe(JobStatus.PENDING);
		});

		it('should store the repeatInterval (cron expression)', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const cronExpression = '0 9 * * 1'; // Every Monday at 9am
			const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});

			expect(job.repeatInterval).toBe(cronExpression);
		});

		it('should calculate nextRunAt from cron expression', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const beforeSchedule = new Date();
			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
			);
			const afterSchedule = new Date();

			expect(job.nextRunAt).toBeInstanceOf(Date);
			// nextRunAt should be in the future (or at least not before we started scheduling)
			expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeSchedule.getTime());
			// nextRunAt should be within the next minute for '* * * * *' expression
			const oneMinuteLater = new Date(afterSchedule.getTime() + 60000);
			expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(oneMinuteLater.getTime());
		});

		it('should calculate correct nextRunAt for hourly cron', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.schedule('0 * * * *', TEST_CONSTANTS.JOB_NAME, {}); // Every hour at minute 0

			// The next run should be at minute 0
			expect(job.nextRunAt.getMinutes()).toBe(0);
			expect(job.nextRunAt.getSeconds()).toBe(0);
		});

		it('should set failCount to 0', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
			);

			expect(job.failCount).toBe(0);
		});

		it('should set createdAt and updatedAt timestamps', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const beforeSchedule = new Date();
			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
			);
			const afterSchedule = new Date();

			expect(job.createdAt).toBeInstanceOf(Date);
			expect(job.updatedAt).toBeInstanceOf(Date);
			expect(job.createdAt.getTime()).toBeGreaterThanOrEqual(beforeSchedule.getTime());
			expect(job.createdAt.getTime()).toBeLessThanOrEqual(afterSchedule.getTime());
		});

		it('should schedule jobs with various valid cron expressions', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const expressions = [
				'* * * * *', // Every minute
				'0 * * * *', // Every hour
				'0 0 * * *', // Every day at midnight
				'0 0 * * 0', // Every Sunday at midnight
				'0 9 * * 1-5', // Weekdays at 9am
				'*/15 * * * *', // Every 15 minutes
				'0 0 1 * *', // First day of every month
			];

			for (const cron of expressions) {
				const job = await monque.schedule(cron, `job-${cron.replace(/\s/g, '-')}`, {});
				expect(job.repeatInterval).toBe(cron);
				expect(job.nextRunAt).toBeInstanceOf(Date);
			}
		});
	});

	// T055: Tests for invalid cron expression (throws InvalidCronError with helpful message)
	describe('invalid cron expressions', () => {
		it('should throw InvalidCronError for invalid expression', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await expect(monque.schedule('invalid', TEST_CONSTANTS.JOB_NAME, {})).rejects.toThrow(
				InvalidCronError,
			);
		});

		it('should include the invalid expression in the error', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const invalidExpression = 'not-a-cron';

			try {
				await monque.schedule(invalidExpression, TEST_CONSTANTS.JOB_NAME, {});
				expect.fail('Should have thrown InvalidCronError');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				expect((error as InvalidCronError).expression).toBe(invalidExpression);
			}
		});

		it('should provide helpful error message with format example', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			try {
				await monque.schedule('bad expression', TEST_CONSTANTS.JOB_NAME, {});
				expect.fail('Should have thrown InvalidCronError');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				const message = (error as InvalidCronError).message;
				// Should contain the invalid expression
				expect(message).toContain('Invalid cron expression');
				expect(message).toContain('"bad expression"');
				// Should include format explanation
				expect(message).toContain('minute hour day-of-month month day-of-week');
				// Should include an example
				expect(message).toContain('Example:');
			}
		});

		it('should reject expressions with invalid characters', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await expect(
				monque.schedule('abc def ghi jkl mno', TEST_CONSTANTS.JOB_NAME, {}), // Invalid characters
			).rejects.toThrow(InvalidCronError);
		});

		it('should reject expressions with invalid field values', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await expect(
				monque.schedule('60 * * * *', TEST_CONSTANTS.JOB_NAME, {}), // 60 is invalid for minutes
			).rejects.toThrow(InvalidCronError);
		});

		it('should reject expressions with out-of-range hour values', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			await expect(
				monque.schedule('0 25 * * *', TEST_CONSTANTS.JOB_NAME, {}), // 25 is invalid for hours
			).rejects.toThrow(InvalidCronError);
		});
	});

	// T056: Tests for recurring job completion (auto-reschedule after success, uses original cron timing after retries)
	describe('recurring job completion and rescheduling', () => {
		it('should reschedule job after successful completion', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handlerCalls: Job[] = [];
			const handler = vi.fn((job: Job) => {
				handlerCalls.push(job);
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Schedule a job with a cron that runs every minute
			// We'll manually set nextRunAt to now so it runs immediately
			const job = await monque.schedule(TEST_CONSTANTS.CRON_EVERY_MINUTE, TEST_CONSTANTS.JOB_NAME, {
				testValue: 'recurring',
			});
			const originalJobId = job._id;

			// Update the job to run immediately for testing
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			// Wait for the first execution
			await waitFor(async () => handlerCalls.length >= 1);

			// Check that the job was rescheduled (still exists with pending status and new nextRunAt)
			const rescheduledJob = await collection.findOne({ _id: originalJobId });
			expect(rescheduledJob).toBeDefined();
			expect(rescheduledJob?.['status']).toBe(JobStatus.PENDING);
			expect(rescheduledJob?.['repeatInterval']).toBe(TEST_CONSTANTS.CRON_EVERY_MINUTE);
			// nextRunAt should be in the future
			expect(new Date(rescheduledJob?.['nextRunAt'] as Date).getTime()).toBeGreaterThan(Date.now());
		});

		it('should calculate next run from original cron timing', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			let processedJob: Job | null = null;
			const handler = vi.fn((job: Job) => {
				processedJob = job;
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Use a specific cron expression for predictable timing
			const cronExpression = '0 * * * *'; // Every hour at minute 0
			const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});
			const originalJobId = job._id;

			// Update the job to run immediately for testing
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			await waitFor(async () => processedJob !== null);

			// Check the rescheduled job's nextRunAt
			const rescheduledJob = await collection.findOne({ _id: originalJobId });
			expect(rescheduledJob).toBeDefined();

			// The next run should be at minute 0 (matching the cron pattern)
			const nextRunAt = new Date(rescheduledJob?.['nextRunAt'] as Date);
			expect(nextRunAt.getMinutes()).toBe(0);
		});

		it('should reset failCount to 0 after successful completion', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100, maxRetries: 5 });
			monqueInstances.push(monque);
			await monque.initialize();

			let callCount = 0;
			const handler = vi.fn(() => {
				callCount++;
				if (callCount === 1) {
					throw new Error('Simulated failure');
				}
				// Second call succeeds
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Schedule a recurring job
			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
			);
			const originalJobId = job._id;

			// Update the job to run immediately
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			// Wait for first failure (will be retried with backoff)
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					return doc?.['failCount'] === 1;
				},
				{ timeout: 5000 },
			);

			// Update nextRunAt to now to trigger retry immediately
			await collection.updateOne({ _id: originalJobId }, { $set: { nextRunAt: new Date() } });

			// Wait for successful completion
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					// After success, failCount should be reset to 0
					return doc?.['failCount'] === 0 && doc?.['status'] === JobStatus.PENDING;
				},
				{ timeout: 5000 },
			);

			const finalJob = await collection.findOne({ _id: originalJobId });
			expect(finalJob?.['failCount']).toBe(0);
			expect(finalJob?.['status']).toBe(JobStatus.PENDING);
		});

		it('should preserve repeatInterval after retry failure', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100, maxRetries: 5 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn(() => {
				throw new Error('Always fails');
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Schedule a recurring job
			const cronExpression = '*/30 * * * *'; // Every 30 minutes
			const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});
			const originalJobId = job._id;

			// Update the job to run immediately
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			// Wait for first failure
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					return doc?.['failCount'] === 1;
				},
				{ timeout: 5000 },
			);

			// Check that repeatInterval is preserved after failure
			const failedJob = await collection.findOne({ _id: originalJobId });
			expect(failedJob?.['repeatInterval']).toBe(cronExpression);
			expect(failedJob?.['status']).toBe(JobStatus.PENDING); // Should be pending with backoff
		});

		it('should use cron timing for next run after successful retry (not backoff)', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				maxRetries: 5,
				baseRetryInterval: 1000, // 1 second base for backoff
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let callCount = 0;
			const handler = vi.fn(() => {
				callCount++;
				if (callCount === 1) {
					throw new Error('First attempt fails');
				}
				// Second call succeeds
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Schedule a recurring job that runs hourly
			const cronExpression = '0 * * * *';
			const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});
			const originalJobId = job._id;

			// Update the job to run immediately
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			// Wait for first failure
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					return doc?.['failCount'] === 1;
				},
				{ timeout: 5000 },
			);

			// Update nextRunAt to now to trigger retry immediately
			await collection.updateOne({ _id: originalJobId }, { $set: { nextRunAt: new Date() } });

			// Wait for successful completion
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					return doc?.['failCount'] === 0 && doc?.['status'] === JobStatus.PENDING;
				},
				{ timeout: 5000 },
			);

			// Check that nextRunAt follows cron timing, not backoff
			const finalJob = await collection.findOne({ _id: originalJobId });
			const nextRunAt = new Date(finalJob?.['nextRunAt'] as Date);

			// Should be at minute 0 (cron pattern), not a small backoff delay
			expect(nextRunAt.getMinutes()).toBe(0);
			// Should be more than a few seconds in the future (cron timing, not immediate)
			expect(nextRunAt.getTime()).toBeGreaterThan(Date.now() + 1000);
		});

		it('should not reschedule one-time jobs after completion', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			let processed = false;
			const handler = vi.fn(() => {
				processed = true;
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Enqueue a one-time job (not scheduled with cron)
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { oneTime: true });
			const originalJobId = job._id;

			monque.start();

			// Wait for completion
			await waitFor(async () => processed);

			// Check that the job is completed, not rescheduled
			const collection = db.collection(collectionName);
			const completedJob = await collection.findOne({ _id: originalJobId });
			expect(completedJob?.['status']).toBe(JobStatus.COMPLETED);
			expect(completedJob?.['repeatInterval']).toBeUndefined();
		});

		it('should emit job:complete event for recurring jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const completedEvents: Array<{ job: Job; duration: number }> = [];
			monque.on('job:complete', (event) => {
				completedEvents.push(event);
			});

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Schedule a recurring job
			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
			);

			// Update the job to run immediately
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			// Wait for completion event
			await waitFor(async () => completedEvents.length >= 1);

			expect(completedEvents).toHaveLength(1);
			const firstEvent = completedEvents[0];
			expect(firstEvent).toBeDefined();
			expect(firstEvent?.job.name).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(firstEvent?.duration).toBeGreaterThanOrEqual(0);
		});

		it('should clear failReason after successful completion', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100, maxRetries: 5 });
			monqueInstances.push(monque);
			await monque.initialize();

			let callCount = 0;
			const handler = vi.fn(() => {
				callCount++;
				if (callCount === 1) {
					throw new Error('Test failure reason');
				}
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			// Schedule a recurring job
			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
			);
			const originalJobId = job._id;

			// Update the job to run immediately
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });

			monque.start();

			// Wait for first failure
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					return doc?.['failCount'] === 1 && doc?.['failReason'] === 'Test failure reason';
				},
				{ timeout: 5000 },
			);

			// Update nextRunAt to now to trigger retry immediately
			await collection.updateOne({ _id: originalJobId }, { $set: { nextRunAt: new Date() } });

			// Wait for successful completion (failCount reset, failReason cleared)
			await waitFor(
				async () => {
					const doc = await collection.findOne({ _id: originalJobId });
					return doc?.['failCount'] === 0 && doc?.['status'] === JobStatus.PENDING;
				},
				{ timeout: 5000 },
			);

			const finalJob = await collection.findOne({ _id: originalJobId });
			expect(finalJob?.['failCount']).toBe(0);
			expect(finalJob?.['failReason']).toBeUndefined();
		});
	});

	describe('data integrity', () => {
		it('should preserve job data through scheduling', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const complexData = {
				string: 'test',
				number: 42,
				boolean: true,
				nested: { key: 'value' },
				array: [1, 2, 3],
			};

			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				complexData,
			);

			expect(job.data).toEqual(complexData);

			// Verify from database
			const collection = db.collection(collectionName);
			const dbJob = await collection.findOne({ _id: job._id });
			expect(dbJob?.['data']).toEqual(complexData);
		});

		it('should preserve job name through scheduling', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const customJobName = 'my-custom-scheduled-job';
			const job = await monque.schedule(TEST_CONSTANTS.CRON_EVERY_MINUTE, customJobName, {});

			expect(job.name).toBe(customJobName);
		});
	});

	describe('error handling', () => {
		it('should throw if scheduler is not initialized', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			// Do NOT call monque.initialize()

			await expect(
				monque.schedule(TEST_CONSTANTS.CRON_EVERY_MINUTE, TEST_CONSTANTS.JOB_NAME, {}),
			).rejects.toThrow('not initialized');
		});
	});
});
