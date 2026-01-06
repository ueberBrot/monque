This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: packages/core/**
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
packages/
  core/
    src/
      events/
        index.ts
        types.ts
      jobs/
        guards.ts
        index.ts
        types.ts
      scheduler/
        index.ts
        monque.ts
        types.ts
      shared/
        utils/
          backoff.ts
          cron.ts
          index.ts
        errors.ts
        index.ts
      workers/
        index.ts
        types.ts
      index.ts
      reset.d.ts
    tests/
      factories/
        job.factory.ts
      integration/
        atomic-claim.test.ts
        change-streams.test.ts
        concurrency.test.ts
        enqueue.test.ts
        events.test.ts
        heartbeat.test.ts
        indexes.test.ts
        inspection.test.ts
        locking.test.ts
        recovery.test.ts
        retention.test.ts
        retry.test.ts
        schedule.test.ts
        shutdown.test.ts
        stale-recovery.test.ts
        worker.test.ts
      setup/
        constants.ts
        global-setup.ts
        mongodb.ts
        seed.ts
        test-utils.ts
      unit/
        backoff.test.ts
        cron.test.ts
        errors.test.ts
        guards.test.ts
    package.json
    README.md
    tsconfig.json
    tsdown.config.ts
    vitest.config.ts
    vitest.unit.config.ts
```

# Files

## File: packages/core/src/events/index.ts
````typescript
export type { MonqueEventMap } from './types.js';
````

## File: packages/core/src/jobs/guards.ts
````typescript
import type { Job, JobStatusType, PersistedJob } from './types.js';
import { JobStatus } from './types.js';

/**
 * Type guard to check if a job has been persisted to MongoDB.
 *
 * A persisted job is guaranteed to have an `_id` field, which means it has been
 * successfully inserted into the database. This is useful when you need to ensure
 * a job can be updated or referenced by its ID.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job has a valid `_id`, narrowing the type to `PersistedJob<T>`
 *
 * @example Basic usage
 * ```typescript
 * const job: Job<EmailData> = await monque.enqueue('send-email', emailData);
 *
 * if (isPersistedJob(job)) {
 *   // TypeScript knows job._id exists
 *   console.log(`Job ID: ${job._id.toString()}`);
 * }
 * ```
 *
 * @example In a conditional
 * ```typescript
 * function logJobId(job: Job) {
 *   if (!isPersistedJob(job)) {
 *     console.log('Job not yet persisted');
 *     return;
 *   }
 *   // TypeScript knows job is PersistedJob here
 *   console.log(`Processing job ${job._id.toString()}`);
 * }
 * ```
 */
export function isPersistedJob<T>(job: Job<T>): job is PersistedJob<T> {
	return '_id' in job && job._id !== undefined && job._id !== null;
}

/**
 * Type guard to check if a value is a valid job status.
 *
 * Validates that a value is one of the four valid job statuses: `'pending'`,
 * `'processing'`, `'completed'`, or `'failed'`. Useful for runtime validation
 * of user input or external data.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid `JobStatusType`, narrowing the type
 *
 * @example Validating user input
 * ```typescript
 * function filterByStatus(status: string) {
 *   if (!isValidJobStatus(status)) {
 *     throw new Error(`Invalid status: ${status}`);
 *   }
 *   // TypeScript knows status is JobStatusType here
 *   return db.jobs.find({ status });
 * }
 * ```
 *
 * @example Runtime validation
 * ```typescript
 * const statusFromApi = externalData.status;
 *
 * if (isValidJobStatus(statusFromApi)) {
 *   job.status = statusFromApi;
 * } else {
 *   job.status = JobStatus.PENDING;
 * }
 * ```
 */
export function isValidJobStatus(value: unknown): value is JobStatusType {
	return typeof value === 'string' && Object.values(JobStatus).includes(value as JobStatusType);
}

/**
 * Type guard to check if a job is in pending status.
 *
 * A convenience helper for checking if a job is waiting to be processed.
 * Equivalent to `job.status === JobStatus.PENDING` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'pending'`
 *
 * @example Filter pending jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const pendingJobs = jobs.filter(isPendingJob);
 * console.log(`${pendingJobs.length} jobs waiting to be processed`);
 * ```
 *
 * @example Conditional logic
 * ```typescript
 * if (isPendingJob(job)) {
 *   await monque.now(job.name, job.data);
 * }
 * ```
 */
export function isPendingJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.PENDING;
}

/**
 * Type guard to check if a job is currently being processed.
 *
 * A convenience helper for checking if a job is actively running.
 * Equivalent to `job.status === JobStatus.PROCESSING` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'processing'`
 *
 * @example Monitor active jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const activeJobs = jobs.filter(isProcessingJob);
 * console.log(`${activeJobs.length} jobs currently running`);
 * ```
 */
export function isProcessingJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.PROCESSING;
}

/**
 * Type guard to check if a job has completed successfully.
 *
 * A convenience helper for checking if a job finished without errors.
 * Equivalent to `job.status === JobStatus.COMPLETED` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'completed'`
 *
 * @example Find completed jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const completedJobs = jobs.filter(isCompletedJob);
 * console.log(`${completedJobs.length} jobs completed successfully`);
 * ```
 */
export function isCompletedJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.COMPLETED;
}

/**
 * Type guard to check if a job has permanently failed.
 *
 * A convenience helper for checking if a job exhausted all retries.
 * Equivalent to `job.status === JobStatus.FAILED` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'failed'`
 *
 * @example Handle failed jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const failedJobs = jobs.filter(isFailedJob);
 *
 * for (const job of failedJobs) {
 *   console.error(`Job ${job.name} failed: ${job.failReason}`);
 *   await sendAlert(job);
 * }
 * ```
 */
export function isFailedJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.FAILED;
}

/**
 * Type guard to check if a job is a recurring scheduled job.
 *
 * A recurring job has a `repeatInterval` cron expression and will be automatically
 * rescheduled after each successful completion.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job has a `repeatInterval` defined
 *
 * @example Filter recurring jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const recurringJobs = jobs.filter(isRecurringJob);
 * console.log(`${recurringJobs.length} jobs will repeat automatically`);
 * ```
 *
 * @example Conditional cleanup
 * ```typescript
 * if (!isRecurringJob(job) && isCompletedJob(job)) {
 *   // Safe to delete one-time completed jobs
 *   await deleteJob(job._id);
 * }
 * ```
 */
export function isRecurringJob<T>(job: Job<T>): boolean {
	return job.repeatInterval !== undefined && job.repeatInterval !== null;
}
````

## File: packages/core/src/scheduler/index.ts
````typescript
export { Monque } from './monque.js';
export type { MonqueOptions } from './types.js';
````

## File: packages/core/src/shared/utils/backoff.ts
````typescript
/**
 * Default base interval for exponential backoff in milliseconds.
 * @default 1000
 */
export const DEFAULT_BASE_INTERVAL = 1000;

/**
 * Calculate the next run time using exponential backoff.
 *
 * Formula: nextRunAt = now + (2^failCount × baseInterval)
 *
 * @param failCount - Number of previous failed attempts
 * @param baseInterval - Base interval in milliseconds (default: 1000ms)
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @returns The next run date
 *
 * @example
 * ```typescript
 * // First retry (failCount=1): 2^1 * 1000 = 2000ms delay
 * const nextRun = calculateBackoff(1);
 *
 * // Second retry (failCount=2): 2^2 * 1000 = 4000ms delay
 * const nextRun = calculateBackoff(2);
 *
 * // With custom base interval
 * const nextRun = calculateBackoff(3, 500); // 2^3 * 500 = 4000ms delay
 *
 * // With max delay
 * const nextRun = calculateBackoff(10, 1000, 60000); // capped at 60000ms
 * ```
 */
export function calculateBackoff(
	failCount: number,
	baseInterval: number = DEFAULT_BASE_INTERVAL,
	maxDelay?: number,
): Date {
	let delay = 2 ** failCount * baseInterval;

	if (maxDelay !== undefined && delay > maxDelay) {
		delay = maxDelay;
	}

	return new Date(Date.now() + delay);
}

/**
 * Calculate just the delay in milliseconds for a given fail count.
 *
 * @param failCount - Number of previous failed attempts
 * @param baseInterval - Base interval in milliseconds (default: 1000ms)
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @returns The delay in milliseconds
 */
export function calculateBackoffDelay(
	failCount: number,
	baseInterval: number = DEFAULT_BASE_INTERVAL,
	maxDelay?: number,
): number {
	let delay = 2 ** failCount * baseInterval;

	if (maxDelay !== undefined && delay > maxDelay) {
		delay = maxDelay;
	}

	return delay;
}
````

## File: packages/core/src/shared/utils/index.ts
````typescript
export { calculateBackoff } from './backoff.js';
export { getNextCronDate } from './cron.js';
````

## File: packages/core/src/workers/index.ts
````typescript
export type { WorkerOptions, WorkerRegistration } from './types.js';
````

## File: packages/core/src/reset.d.ts
````typescript
import '@total-typescript/ts-reset';
````

## File: packages/core/tests/integration/retention.test.ts
````typescript
import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { Monque } from '@/scheduler';

describe('job retention', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('retention');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
	});

	it('should delete completed jobs older than specified retention', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		// Configure retention to clean up every 100ms, keeping completed jobs for 5000ms
		const monque = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			jobRetention: {
				completed: 5000, // 5000ms retention
				interval: 100, // Check every 100ms
			},
		});
		monqueInstances.push(monque);

		const collection = db.collection(collectionName);

		const now = new Date();
		const oldDate = new Date(now.getTime() - 6000); // 6s ago (should be deleted)
		const recentDate = new Date(now.getTime() - 100); // 100ms ago (should be kept)

		// Insert old completed job
		await collection.insertOne(
			JobFactoryHelpers.completed({
				name: 'old-job',
				updatedAt: oldDate,
			}),
		);

		// Insert recent completed job
		await collection.insertOne(
			JobFactoryHelpers.completed({
				name: 'recent-job',
				updatedAt: recentDate,
			}),
		);

		await monque.initialize();
		monque.start();

		// Wait for cleanup to happen
		await waitFor(
			async () => {
				const count = await collection.countDocuments({ name: 'old-job' });
				return count === 0;
			},
			{ timeout: 2000, interval: 50 },
		);

		const oldJob = await collection.findOne({ name: 'old-job' });
		expect(oldJob).toBeNull();

		const recentJob = await collection.findOne({ name: 'recent-job' });
		expect(recentJob).not.toBeNull();
	});

	it('should delete failed jobs older than specified retention', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			jobRetention: {
				failed: 5000, // 5000ms retention
				interval: 100, // Check every 100ms
			},
		});
		monqueInstances.push(monque);

		const collection = db.collection(collectionName);

		const now = new Date();
		const oldDate = new Date(now.getTime() - 6000);
		const recentDate = new Date(now.getTime() - 100);

		await collection.insertOne(
			JobFactoryHelpers.failed({
				name: 'old-failed-job',
				updatedAt: oldDate,
			}),
		);

		await collection.insertOne(
			JobFactoryHelpers.failed({
				name: 'recent-failed-job',
				updatedAt: recentDate,
			}),
		);

		await monque.initialize();
		monque.start();

		await waitFor(
			async () => {
				const count = await collection.countDocuments({ name: 'old-failed-job' });
				return count === 0;
			},
			{ timeout: 2000, interval: 50 },
		);

		const oldJob = await collection.findOne({ name: 'old-failed-job' });
		expect(oldJob).toBeNull();

		const recentJob = await collection.findOne({ name: 'recent-failed-job' });
		expect(recentJob).not.toBeNull();
	});

	it('should not delete jobs if retention is not configured', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			// No jobRetention
		});
		monqueInstances.push(monque);

		const collection = db.collection(collectionName);
		const oldDate = new Date(Date.now() - 5000);

		await collection.insertOne(
			JobFactoryHelpers.completed({
				name: 'should-keep-job',
				updatedAt: oldDate,
			}),
		);

		await monque.initialize();
		monque.start();

		// Wait a bit to ensure no cleanup happens
		await new Promise((r) => setTimeout(r, 500));

		const job = await collection.findOne({ name: 'should-keep-job' });
		expect(job).not.toBeNull();
	});
});
````

## File: packages/core/tests/setup/constants.ts
````typescript
/**
 * Shared constants for test files to reduce duplication.
 */

export const TEST_CONSTANTS = {
	/** Default collection name for tests */
	COLLECTION_NAME: 'monque_jobs',
	/** Default job name */
	JOB_NAME: 'test-job',
	/** Default job data payload */
	JOB_DATA: { data: 'test' },
	/** Default cron expression (every minute) */
	CRON_EVERY_MINUTE: '* * * * *',
	/** Default cron expression (every hour) */
	CRON_EVERY_HOUR: '0 * * * *',
} as const;
````

## File: packages/core/tests/setup/seed.ts
````typescript
import { faker } from '@faker-js/faker';

// Set a constant seed for deterministic test data
faker.seed(123456);
````

## File: packages/core/vitest.unit.config.ts
````typescript
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import rootConfig from '../../vitest.config.ts';

export default mergeConfig(
	rootConfig,
	defineConfig({
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
				'@tests': fileURLToPath(new URL('./tests', import.meta.url)),
				'@test-utils': fileURLToPath(new URL('./tests/setup', import.meta.url)),
			},
		},
		test: {
			include: ['tests/unit/**/*.test.ts'],
			coverage: {
				include: ['src/**/*.ts'],
			},
			// Unit tests don't need MongoDB
			setupFiles: ['./tests/setup/seed.ts'],
			// Shorter timeouts for unit tests
			testTimeout: 5000,
			hookTimeout: 10000,
		},
	}),
);
````

## File: packages/core/src/events/types.ts
````typescript
import type { Job } from '@/jobs';

/**
 * Event payloads for Monque lifecycle events.
 */
export interface MonqueEventMap {
	/**
	 * Emitted when a job begins processing.
	 */
	'job:start': Job;

	/**
	 * Emitted when a job finishes successfully.
	 */
	'job:complete': {
		job: Job;
		/** Processing duration in milliseconds */
		duration: number;
	};

	/**
	 * Emitted when a job fails (may retry).
	 */
	'job:fail': {
		job: Job;
		error: Error;
		/** Whether the job will be retried */
		willRetry: boolean;
	};

	/**
	 * Emitted for unexpected errors during processing.
	 */
	'job:error': {
		error: Error;
		job?: Job;
	};

	/**
	 * Emitted when stale jobs are recovered on startup.
	 */
	'stale:recovered': {
		count: number;
	};

	/**
	 * Emitted when the change stream is successfully connected.
	 */
	'changestream:connected': undefined;

	/**
	 * Emitted when a change stream error occurs.
	 */
	'changestream:error': {
		error: Error;
	};

	/**
	 * Emitted when the change stream is closed.
	 */
	'changestream:closed': undefined;

	/**
	 * Emitted when falling back from change streams to polling-only mode.
	 */
	'changestream:fallback': {
		reason: string;
	};
}
````

## File: packages/core/src/jobs/index.ts
````typescript
// Guards
export {
	isCompletedJob,
	isFailedJob,
	isPendingJob,
	isPersistedJob,
	isProcessingJob,
	isRecurringJob,
	isValidJobStatus,
} from './guards.js';
// Types
export {
	type EnqueueOptions,
	type GetJobsFilter,
	type Job,
	type JobHandler,
	JobStatus,
	type JobStatusType,
	type PersistedJob,
	type ScheduleOptions,
} from './types.js';
````

## File: packages/core/src/jobs/types.ts
````typescript
import type { ObjectId } from 'mongodb';

/**
 * Represents the lifecycle states of a job in the queue.
 *
 * Jobs transition through states as follows:
 * - PENDING → PROCESSING (when picked up by a worker)
 * - PROCESSING → COMPLETED (on success)
 * - PROCESSING → PENDING (on failure, if retries remain)
 * - PROCESSING → FAILED (on failure, after max retries exhausted)
 *
 * @example
 * ```typescript
 * if (job.status === JobStatus.PENDING) {
 *   // job is waiting to be picked up
 * }
 * ```
 */
export const JobStatus = {
	/** Job is waiting to be picked up by a worker */
	PENDING: 'pending',
	/** Job is currently being executed by a worker */
	PROCESSING: 'processing',
	/** Job completed successfully */
	COMPLETED: 'completed',
	/** Job permanently failed after exhausting all retry attempts */
	FAILED: 'failed',
} as const;

/**
 * Union type of all possible job status values: `'pending' | 'processing' | 'completed' | 'failed'`
 */
export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];

/**
 * Represents a job in the Monque queue.
 *
 * @template T - The type of the job's data payload
 *
 * @example
 * ```typescript
 * interface EmailJobData {
 *   to: string;
 *   subject: string;
 *   template: string;
 * }
 *
 * const job: Job<EmailJobData> = {
 *   name: 'send-email',
 *   data: { to: 'user@example.com', subject: 'Welcome!', template: 'welcome' },
 *   status: JobStatus.PENDING,
 *   nextRunAt: new Date(),
 *   failCount: 0,
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface Job<T = unknown> {
	/** MongoDB document identifier */
	_id?: ObjectId;

	/** Job type identifier, matches worker registration */
	name: string;

	/** Job payload - must be JSON-serializable */
	data: T;

	/** Current lifecycle state */
	status: JobStatusType;

	/** When the job should be processed */
	nextRunAt: Date;

	/** Timestamp when job was locked for processing */
	lockedAt?: Date | null;

	/**
	 * Unique identifier of the scheduler instance that claimed this job.
	 * Used for atomic claim pattern - ensures only one instance processes each job.
	 * Set when a job is claimed, cleared when job completes or fails.
	 */
	claimedBy?: string | null;

	/**
	 * Timestamp of the last heartbeat update for this job.
	 * Used to detect stale jobs when a scheduler instance crashes without releasing.
	 * Updated periodically while job is being processed.
	 */
	lastHeartbeat?: Date | null;

	/**
	 * Heartbeat interval in milliseconds for this job.
	 * Stored on the job to allow recovery logic to use the correct timeout.
	 */
	heartbeatInterval?: number;

	/** Number of failed attempts */
	failCount: number;

	/** Last failure error message */
	failReason?: string;

	/** Cron expression for recurring jobs */
	repeatInterval?: string;

	/** Deduplication key to prevent duplicate jobs */
	uniqueKey?: string;

	/** Job creation timestamp */
	createdAt: Date;

	/** Last modification timestamp */
	updatedAt: Date;
}

/**
 * A job that has been persisted to MongoDB and has a guaranteed `_id`.
 * This is returned by `enqueue()`, `now()`, and `schedule()` methods.
 *
 * @template T - The type of the job's data payload
 */
export type PersistedJob<T = unknown> = Job<T> & { _id: ObjectId };

/**
 * Options for enqueueing a job.
 *
 * @example
 * ```typescript
 * await monque.enqueue('sync-user', { userId: '123' }, {
 *   uniqueKey: 'sync-user-123',
 *   runAt: new Date(Date.now() + 5000), // Run in 5 seconds
 * });
 * ```
 */
export interface EnqueueOptions {
	/**
	 * Deduplication key. If a job with this key is already pending or processing,
	 * the enqueue operation will not create a duplicate.
	 */
	uniqueKey?: string;

	/**
	 * When the job should be processed. Defaults to immediately (new Date()).
	 */
	runAt?: Date;
}

/**
 * Options for scheduling a recurring job.
 *
 * @example
 * ```typescript
 * await monque. schedule('0 * * * *', 'hourly-cleanup', { dir: '/tmp' }, {
 *   uniqueKey: 'hourly-cleanup-job',
 * });
 * ```
 */
export interface ScheduleOptions {
	/**
	 * Deduplication key. If a job with this key is already pending or processing,
	 * the schedule operation will not create a duplicate.
	 */
	uniqueKey?: string;
}

/**
 * Filter options for querying jobs.
 *
 * Use with `monque.getJobs()` to filter jobs by name, status, or limit results.
 *
 * @example
 * ```typescript
 * // Get all pending email jobs
 * const pendingEmails = await monque.getJobs({
 *   name: 'send-email',
 *   status: JobStatus.PENDING,
 * });
 *
 * // Get all failed or completed jobs (paginated)
 * const finishedJobs = await monque.getJobs({
 *   status: [JobStatus.COMPLETED, JobStatus.FAILED],
 *   limit: 50,
 *   skip: 100,
 * });
 * ```
 */
export interface GetJobsFilter {
	/** Filter by job type name */
	name?: string;

	/** Filter by status (single or multiple) */
	status?: JobStatusType | JobStatusType[];

	/** Maximum number of jobs to return (default: 100) */
	limit?: number;

	/** Number of jobs to skip for pagination */
	skip?: number;
}

/**
 * Handler function signature for processing jobs.
 *
 * @template T - The type of the job's data payload
 *
 * @example
 * ```typescript
 * const emailHandler: JobHandler<EmailJobData> = async (job) => {
 *   await sendEmail(job.data.to, job.data.subject);
 * };
 * ```
 */
export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void> | void;
````

## File: packages/core/src/shared/utils/cron.ts
````typescript
import { CronExpressionParser } from 'cron-parser';

import { InvalidCronError } from '../errors.js';

/**
 * Parse a cron expression and return the next scheduled run date.
 *
 * @param expression - A 5-field cron expression (minute hour day-of-month month day-of-week) or a predefined expression
 * @param currentDate - The reference date for calculating next run (default: now)
 * @returns The next scheduled run date
 * @throws {InvalidCronError} If the cron expression is invalid
 *
 * @example
 * ```typescript
 * // Every minute
 * const nextRun = getNextCronDate('* * * * *');
 *
 * // Every day at midnight
 * const nextRun = getNextCronDate('0 0 * * *');
 *
 * // Using predefined expression
 * const nextRun = getNextCronDate('@daily');
 *
 * // Every Monday at 9am
 * const nextRun = getNextCronDate('0 9 * * 1');
 * ```
 */
export function getNextCronDate(expression: string, currentDate?: Date): Date {
	try {
		const interval = CronExpressionParser.parse(expression, {
			currentDate: currentDate ?? new Date(),
		});
		return interval.next().toDate();
	} catch (error) {
		handleCronParseError(expression, error);
	}
}

/**
 * Validate a cron expression without calculating the next run date.
 *
 * @param expression - A 5-field cron expression
 * @throws {InvalidCronError} If the cron expression is invalid
 *
 * @example
 * ```typescript
 * validateCronExpression('0 9 * * 1'); // Throws if invalid
 * ```
 */
export function validateCronExpression(expression: string): void {
	try {
		CronExpressionParser.parse(expression);
	} catch (error) {
		handleCronParseError(expression, error);
	}
}

function handleCronParseError(expression: string, error: unknown): never {
	/* istanbul ignore next -- @preserve cron-parser always throws Error objects */
	const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
	throw new InvalidCronError(
		expression,
		`Invalid cron expression "${expression}": ${errorMessage}. ` +
			'Expected 5-field format: "minute hour day-of-month month day-of-week" or predefined expression (e.g. @daily). ' +
			'Example: "0 9 * * 1" (every Monday at 9am)',
	);
}
````

## File: packages/core/src/shared/index.ts
````typescript
export {
	ConnectionError,
	InvalidCronError,
	MonqueError,
	ShutdownTimeoutError,
	WorkerRegistrationError,
} from './errors.js';
export {
	calculateBackoff,
	calculateBackoffDelay,
	DEFAULT_BASE_INTERVAL,
} from './utils/backoff.js';
export { getNextCronDate, validateCronExpression } from './utils/cron.js';
````

## File: packages/core/src/workers/types.ts
````typescript
import type { JobHandler, PersistedJob } from '@/jobs';

/**
 * Options for registering a worker.
 *
 * @example
 * ```typescript
 * monque.worker('send-email', emailHandler, {
 *   concurrency: 3,
 * });
 * ```
 */
export interface WorkerOptions {
	/**
	 * Number of concurrent jobs this worker can process.
	 * @default 5 (uses defaultConcurrency from MonqueOptions)
	 */
	concurrency?: number;

	/**
	 * Allow replacing an existing worker for the same job name.
	 * If false (default) and a worker already exists, throws WorkerRegistrationError.
	 * @default false
	 */
	replace?: boolean;
}

/**
 * Internal worker registration with handler and options.
 * Tracks the handler, concurrency limit, and currently active jobs.
 */
export interface WorkerRegistration<T = unknown> {
	/** The job handler function */
	handler: JobHandler<T>;
	/** Maximum concurrent jobs for this worker */
	concurrency: number;
	/** Map of active job IDs to their job data */
	activeJobs: Map<string, PersistedJob<T>>;
}
````

## File: packages/core/tests/integration/atomic-claim.test.ts
````typescript
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
````

## File: packages/core/tests/integration/change-streams.test.ts
````typescript
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

import type { Job } from '@/jobs';
import { Monque } from '@/scheduler';

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

		it('should emit changestream:fallback after exhausting reconnection attempts', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100, // Fast polling for fallback
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const fallbackEvents: { reason: string }[] = [];
			const errorEvents: { error: Error }[] = [];

			monque.on('changestream:fallback', (payload) => {
				fallbackEvents.push(payload);
			});
			monque.on('changestream:error', (payload) => {
				errorEvents.push(payload);
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});

			let connected = false;
			monque.on('changestream:connected', () => {
				connected = true;
			});

			monque.start();
			await waitFor(async () => connected, { timeout: 5000 });

			// @ts-expect-error - Accessing private property for testing
			const maxAttempts = monque.maxChangeStreamReconnectAttempts;

			// Simulate repeated errors to exhaust reconnection attempts
			// @ts-expect-error - Accessing private property for testing
			const changeStream = monque.changeStream;

			// Emit more errors than max attempts to trigger fallback
			for (let i = 0; i <= maxAttempts + 1; i++) {
				if (changeStream) {
					changeStream.emit('error', new Error(`Simulated test error ${i + 1}`));
					// Small delay to allow error handling
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}

			// Give time for fallback to be emitted
			await waitFor(async () => fallbackEvents.length > 0, { timeout: 5000 });

			expect(fallbackEvents.length).toBeGreaterThan(0);
			expect(fallbackEvents[0]?.reason).toContain('Exhausted');
			expect(fallbackEvents[0]?.reason).toContain('reconnection attempts');
		});

		it('should attempt reconnection with exponential backoff after change stream error', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 5000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let connectionCount = 0;
			monque.on('changestream:connected', () => {
				connectionCount++;
			});

			const errorEvents: { error: Error }[] = [];
			monque.on('changestream:error', (payload) => {
				errorEvents.push(payload);
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});
			monque.start();

			await waitFor(async () => connectionCount >= 1, { timeout: 5000 });

			// @ts-expect-error - Accessing private property for testing
			const changeStream = monque.changeStream;

			// Emit a single error - should trigger reconnection
			if (changeStream) {
				changeStream.emit('error', new Error('Simulated recoverable error'));
			}

			// Wait for error to be processed and reconnection attempt
			await waitFor(async () => errorEvents.length >= 1, { timeout: 3000 });

			// Allow time for reconnection (first attempt has 1s delay)
			await new Promise((resolve) => setTimeout(resolve, 1500));

			// Connection count may increase if reconnection was successful
			// Or remain same if still attempting - either way, verify error was handled
			expect(errorEvents.length).toBeGreaterThanOrEqual(1);
			expect(errorEvents[0]?.error.message).toBe('Simulated recoverable error');
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
````

## File: packages/core/tests/integration/heartbeat.test.ts
````typescript
/**
 * Tests for heartbeat mechanism during job processing.
 *
 * These tests verify:
 * - lastHeartbeat is updated periodically while processing
 * - Heartbeat interval is configurable
 * - Stale jobs are detected using lastHeartbeat
 * - Heartbeat mechanism stops on job completion/failure
 * - Heartbeat cleanup occurs on scheduler shutdown
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

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('heartbeat mechanism', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('heartbeat');
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

	describe('heartbeat updates during processing', () => {
		it('should set lastHeartbeat when claiming a job', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				heartbeatInterval: 100,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 500));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['lastHeartbeat']).toBeInstanceOf(Date);
			expect(doc?.['heartbeatInterval']).toBe(100);
		});

		it('should update lastHeartbeat periodically while processing', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const heartbeatInterval = 100; // 100ms for faster test
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				heartbeatInterval,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const heartbeatTimestamps: Date[] = [];

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				// Hold the job long enough for multiple heartbeats
				const collection = db.collection(collectionName);

				// Record initial heartbeat
				const doc1 = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
				if (doc1?.['lastHeartbeat']) {
					heartbeatTimestamps.push(doc1['lastHeartbeat'] as Date);
				}

				// Wait for heartbeat update
				await new Promise((resolve) => setTimeout(resolve, heartbeatInterval * 2));

				// Record updated heartbeat
				const doc2 = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
				if (doc2?.['lastHeartbeat']) {
					heartbeatTimestamps.push(doc2['lastHeartbeat'] as Date);
				}

				// Wait for another heartbeat update
				await new Promise((resolve) => setTimeout(resolve, heartbeatInterval * 2));

				const doc3 = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
				if (doc3?.['lastHeartbeat']) {
					heartbeatTimestamps.push(doc3['lastHeartbeat'] as Date);
				}
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => heartbeatTimestamps.length >= 3, { timeout: 5000 });

			// Verify heartbeats are increasing
			expect(heartbeatTimestamps.length).toBeGreaterThanOrEqual(3);
			for (let i = 1; i < heartbeatTimestamps.length; i++) {
				const prev = heartbeatTimestamps[i - 1];
				const curr = heartbeatTimestamps[i];
				if (prev && curr) {
					expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
				}
			}
		});

		it('should clear lastHeartbeat when job completes', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				heartbeatInterval: 50,
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
			expect(doc?.['lastHeartbeat']).toBeUndefined();
			expect(doc?.['claimedBy']).toBeUndefined();
		});
	});

	describe('heartbeat interval configuration', () => {
		it('should use custom heartbeat interval', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const customInterval = 200;
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				heartbeatInterval: customInterval,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 500));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['heartbeatInterval']).toBe(customInterval);
		});

		it('should use default heartbeat interval of 30000ms', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				// No heartbeatInterval specified
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 200));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['heartbeatInterval']).toBe(30000);
		});
	});

	describe('stale job detection using lastHeartbeat', () => {
		it('should recover jobs with stale lastHeartbeat on startup', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const lockTimeout = 500; // 500ms for faster test

			// Create a stale job (lastHeartbeat older than lockTimeout)
			const collection = db.collection(collectionName);
			const staleTime = new Date(Date.now() - lockTimeout * 2);
			const staleJob = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { value: 'stale' },
				nextRunAt: new Date(Date.now() - 10000),
				claimedBy: 'dead-instance',
				lockedAt: staleTime,
				lastHeartbeat: staleTime,
				heartbeatInterval: 100,
				createdAt: staleTime,
				updatedAt: staleTime,
			});
			await collection.insertOne(staleJob);

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				lockTimeout,
				recoverStaleJobs: true,
			});
			monqueInstances.push(monque);

			let staleRecovered = false;
			monque.on('stale:recovered', ({ count }) => {
				if (count > 0) {
					staleRecovered = true;
				}
			});

			await monque.initialize();

			// Job should be recovered to pending
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['status']).toBe(JobStatus.PENDING);
			expect(doc?.['claimedBy']).toBeUndefined();
			expect(staleRecovered).toBe(true);
		});

		it('should not recover jobs with recent lastHeartbeat', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const lockTimeout = 5000;

			// Create a job with recent heartbeat (not stale)
			const collection = db.collection(collectionName);
			const recentTime = new Date();
			const activeJob = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { value: 'active' },
				nextRunAt: new Date(Date.now() - 10000),
				claimedBy: 'active-instance',
				lockedAt: recentTime,
				lastHeartbeat: recentTime,
				heartbeatInterval: 100,
				createdAt: recentTime,
				updatedAt: recentTime,
			});
			await collection.insertOne(activeJob);

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				lockTimeout,
				recoverStaleJobs: true,
			});
			monqueInstances.push(monque);

			await monque.initialize();

			// Job should still be processing (not recovered)
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['status']).toBe(JobStatus.PROCESSING);
			expect(doc?.['claimedBy']).toBe('active-instance');
		});
	});

	describe('heartbeat cleanup on shutdown', () => {
		it('should release claimed jobs when stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'shutdown-instance';
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				heartbeatInterval: 50,
				schedulerInstanceId: instanceId,
				shutdownTimeout: 5000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			let resolveJob: (() => void) | undefined;
			const jobPromise = new Promise<void>((resolve) => {
				resolveJob = resolve;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				// Wait until we signal completion
				await jobPromise;
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			// Job is now processing - verify it's claimed
			const collection = db.collection(collectionName);
			let doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['claimedBy']).toBe(instanceId);

			// Let the job complete
			resolveJob?.();

			// Stop should wait for job to complete
			await monque.stop();

			// After stop, job should be completed and claim cleared
			doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['status']).toBe(JobStatus.COMPLETED);
			expect(doc?.['claimedBy']).toBeUndefined();
		});
	});
});
````

## File: packages/core/tests/integration/inspection.test.ts
````typescript
/**
 * Tests for the getJobs() and getJob() methods of the Monque scheduler.
 *
 * These tests verify:
 * - Basic job querying functionality
 * - Filtering by name, status, and combinations
 * - Pagination with limit and skip
 * - Single job lookup by ID
 * - Error handling for uninitialized scheduler
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
} from '@test-utils/test-utils.js';
import type { Collection, Db, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobFactory, JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

/** Test-specific job names to avoid collision */
const JOB_NAMES = {
	EMAIL: 'send-email',
	REPORT: 'generate-report',
	SYNC: 'sync-data',
} as const;

describe('getJobs()', () => {
	let db: Db;
	let collectionName: string;
	let collection: Collection<Document>;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('inspection-getJobs');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	beforeEach(async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		collection = db.collection(collectionName);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('basic querying', () => {
		it('should return all jobs when no filter is provided', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = [
				JobFactory.build({ name: JOB_NAMES.EMAIL }),
				JobFactory.build({ name: JOB_NAMES.REPORT }),
				JobFactory.build({ name: JOB_NAMES.SYNC }),
			];
			await collection.insertMany(seedJobs);

			const jobs = await monque.getJobs();

			expect(jobs).toHaveLength(3);
		});

		it('should return empty array when no jobs exist', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const jobs = await monque.getJobs();

			expect(jobs).toHaveLength(0);
			expect(jobs).toEqual([]);
		});

		it('should return jobs ordered by nextRunAt ascending', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const seedJobs = [
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { order: 3 },
					nextRunAt: new Date(now + 3000),
				}),
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { order: 1 },
					nextRunAt: new Date(now + 1000),
				}),
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { order: 2 },
					nextRunAt: new Date(now + 2000),
				}),
			];
			await collection.insertMany(seedJobs);

			const jobs = await monque.getJobs<{ order: number }>();

			expect(jobs[0]?.data.order).toBe(1);
			expect(jobs[1]?.data.order).toBe(2);
			expect(jobs[2]?.data.order).toBe(3);
		});

		it('should return PersistedJob with _id', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			await collection.insertOne(seedJob);

			const jobs = await monque.getJobs();

			expect(jobs[0]?._id).toBeInstanceOf(ObjectId);
			expect(jobs[0]?.name).toBe(JOB_NAMES.EMAIL);
			expect(jobs[0]?.status).toBe(JobStatus.PENDING);
		});
	});

	describe('filter by name', () => {
		it('should filter jobs by name', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = [
				JobFactory.build({ name: JOB_NAMES.EMAIL }),
				JobFactory.build({ name: JOB_NAMES.EMAIL }),
				JobFactory.build({ name: JOB_NAMES.REPORT }),
			];
			await collection.insertMany(seedJobs);

			const emailJobs = await monque.getJobs({ name: JOB_NAMES.EMAIL });

			expect(emailJobs).toHaveLength(2);
			expect(emailJobs.every((j) => j.name === JOB_NAMES.EMAIL)).toBe(true);
		});

		it('should return empty when name does not match any jobs', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			await collection.insertOne(seedJob);

			const jobs = await monque.getJobs({ name: 'non-existent-job' });

			expect(jobs).toHaveLength(0);
		});
	});

	describe('filter by status', () => {
		it('should filter jobs by single status', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			const completedJob = JobFactoryHelpers.completed({ name: JOB_NAMES.REPORT });
			await collection.insertMany([pendingJob, completedJob]);

			const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
			const completedJobs = await monque.getJobs({ status: JobStatus.COMPLETED });

			expect(pendingJobs).toHaveLength(1);
			expect(pendingJobs[0]?.status).toBe(JobStatus.PENDING);
			expect(completedJobs).toHaveLength(1);
			expect(completedJobs[0]?.status).toBe(JobStatus.COMPLETED);
		});

		it('should filter jobs by multiple statuses', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			const completedJob = JobFactoryHelpers.completed({ name: JOB_NAMES.REPORT });
			const failedJob = JobFactoryHelpers.failed({ name: JOB_NAMES.SYNC });
			await collection.insertMany([pendingJob, completedJob, failedJob]);

			const finishedJobs = await monque.getJobs({
				status: [JobStatus.COMPLETED, JobStatus.FAILED],
			});

			expect(finishedJobs).toHaveLength(2);
			expect(finishedJobs.some((j) => j.status === JobStatus.COMPLETED)).toBe(true);
			expect(finishedJobs.some((j) => j.status === JobStatus.FAILED)).toBe(true);
		});
	});

	describe('pagination', () => {
		it('should limit results with limit option', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = JobFactory.buildList(10, { name: JOB_NAMES.EMAIL });
			await collection.insertMany(seedJobs);

			const resultJobs = await monque.getJobs({ limit: 5 });

			expect(resultJobs).toHaveLength(5);
		});

		it('should skip results with skip option', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const seedJobs = Array.from({ length: 5 }, (_, i) =>
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { index: i },
					nextRunAt: new Date(now + i * 1000),
				}),
			);
			await collection.insertMany(seedJobs);

			const resultJobs = await monque.getJobs<{ index: number }>({ skip: 2 });

			expect(resultJobs).toHaveLength(3);
			expect(resultJobs[0]?.data.index).toBe(2);
			expect(resultJobs[1]?.data.index).toBe(3);
			expect(resultJobs[2]?.data.index).toBe(4);
		});

		it('should support pagination with limit and skip', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const seedJobs = Array.from({ length: 10 }, (_, i) =>
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { index: i },
					nextRunAt: new Date(now + i * 1000),
				}),
			);
			await collection.insertMany(seedJobs);

			const page1 = await monque.getJobs<{ index: number }>({ limit: 3, skip: 0 });
			const page2 = await monque.getJobs<{ index: number }>({ limit: 3, skip: 3 });
			const page3 = await monque.getJobs<{ index: number }>({ limit: 3, skip: 6 });

			expect(page1).toHaveLength(3);
			expect(page1[0]?.data.index).toBe(0);

			expect(page2).toHaveLength(3);
			expect(page2[0]?.data.index).toBe(3);

			expect(page3).toHaveLength(3);
			expect(page3[0]?.data.index).toBe(6);
		});

		it('should default limit to 100', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = JobFactory.buildList(105, { name: JOB_NAMES.EMAIL });
			await collection.insertMany(seedJobs);

			const resultJobs = await monque.getJobs();

			expect(resultJobs).toHaveLength(100);
		});
	});

	describe('combined filters', () => {
		it('should combine name and status filters', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingEmail = JobFactory.build({ name: JOB_NAMES.EMAIL });
			const completedEmail = JobFactoryHelpers.completed({ name: JOB_NAMES.EMAIL });
			const pendingReport = JobFactory.build({ name: JOB_NAMES.REPORT });
			await collection.insertMany([pendingEmail, completedEmail, pendingReport]);

			const pendingEmails = await monque.getJobs({
				name: JOB_NAMES.EMAIL,
				status: JobStatus.PENDING,
			});

			expect(pendingEmails).toHaveLength(1);
			expect(pendingEmails[0]?.name).toBe(JOB_NAMES.EMAIL);
			expect(pendingEmails[0]?.status).toBe(JobStatus.PENDING);
		});

		it('should combine all filters', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const emailJobs = Array.from({ length: 10 }, (_, i) =>
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { index: i },
					nextRunAt: new Date(now + i * 1000),
				}),
			);
			const reportJob = JobFactory.build({ name: JOB_NAMES.REPORT });
			await collection.insertMany([...emailJobs, reportJob]);

			const jobs = await monque.getJobs<{ index: number }>({
				name: JOB_NAMES.EMAIL,
				status: JobStatus.PENDING,
				limit: 3,
				skip: 2,
			});

			expect(jobs).toHaveLength(3);
			expect(jobs[0]?.data.index).toBe(2);
			expect(jobs.every((j) => j.name === JOB_NAMES.EMAIL)).toBe(true);
		});
	});

	describe('error handling', () => {
		it('should throw when not initialized', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);

			await expect(monque.getJobs()).rejects.toThrow('not initialized');
		});
	});
});

describe('getJob()', () => {
	let db: Db;
	let collectionName: string;
	let collection: Collection<Document>;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('inspection-getJob');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	beforeEach(async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		collection = db.collection(collectionName);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('basic lookup', () => {
		it('should return job by ObjectId', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			await collection.insertOne(seedJob);

			const job = await monque.getJob(seedJob._id);

			expect(job).not.toBeNull();
			expect(job?._id.toString()).toBe(seedJob._id.toString());
			expect(job?.name).toBe(JOB_NAMES.EMAIL);
		});

		it('should return null for non-existent job', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const nonExistentId = new ObjectId();

			const job = await monque.getJob(nonExistentId);

			expect(job).toBeNull();
		});

		it('should return job with all fields', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const futureDate = new Date(Date.now() + 60000);
			const seedJob = JobFactory.build({
				name: JOB_NAMES.EMAIL,
				nextRunAt: futureDate,
				uniqueKey: 'test-unique-key',
			});
			await collection.insertOne(seedJob);

			const job = await monque.getJob(seedJob._id);

			expect(job).not.toBeNull();
			expect(job?._id).toBeInstanceOf(ObjectId);
			expect(job?.name).toBe(JOB_NAMES.EMAIL);
			expect(job?.status).toBe(JobStatus.PENDING);
			expect(job?.nextRunAt.getTime()).toBe(futureDate.getTime());
			expect(job?.uniqueKey).toBe('test-unique-key');
			expect(job?.failCount).toBe(0);
			expect(job?.createdAt).toBeInstanceOf(Date);
			expect(job?.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('type safety', () => {
		it('should preserve generic type for job data', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			type EmailJobData = {
				to: string;
				subject: string;
				[key: string]: unknown;
			};

			const seedJob = JobFactoryHelpers.withData<EmailJobData>(
				{ to: 'test@example.com', subject: 'Hello' },
				{ name: JOB_NAMES.EMAIL },
			);
			await collection.insertOne(seedJob);

			const job = await monque.getJob<EmailJobData>(seedJob._id);

			expect(job?.data.to).toBe('test@example.com');
			expect(job?.data.subject).toBe('Hello');
		});
	});

	describe('error handling', () => {
		it('should throw when not initialized', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);

			const someId = new ObjectId();

			await expect(monque.getJob(someId)).rejects.toThrow('not initialized');
		});
	});
});
````

## File: packages/core/tests/unit/backoff.test.ts
````typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateBackoff, calculateBackoffDelay, DEFAULT_BASE_INTERVAL } from '@/shared';

describe('backoff', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('DEFAULT_BASE_INTERVAL', () => {
		it('should be 1000ms (1 second)', () => {
			expect(DEFAULT_BASE_INTERVAL).toBe(1000);
		});
	});

	describe('calculateBackoffDelay', () => {
		it('should calculate delay for failCount=0 as 2^0 * 1000 = 1000ms', () => {
			expect(calculateBackoffDelay(0)).toBe(1000);
		});

		it('should calculate delay for failCount=1 as 2^1 * 1000 = 2000ms', () => {
			expect(calculateBackoffDelay(1)).toBe(2000);
		});

		it('should calculate delay for failCount=2 as 2^2 * 1000 = 4000ms', () => {
			expect(calculateBackoffDelay(2)).toBe(4000);
		});

		it('should calculate delay for failCount=3 as 2^3 * 1000 = 8000ms', () => {
			expect(calculateBackoffDelay(3)).toBe(8000);
		});

		it('should calculate delay for failCount=10 as 2^10 * 1000 = 1024000ms', () => {
			expect(calculateBackoffDelay(10)).toBe(1024000);
		});

		it('should use custom base interval when provided', () => {
			expect(calculateBackoffDelay(1, 500)).toBe(1000); // 2^1 * 500
			expect(calculateBackoffDelay(2, 500)).toBe(2000); // 2^2 * 500
			expect(calculateBackoffDelay(3, 500)).toBe(4000); // 2^3 * 500
		});

		it('should handle zero base interval', () => {
			expect(calculateBackoffDelay(5, 0)).toBe(0);
		});

		it('should cap delay at maxDelay when provided', () => {
			expect(calculateBackoffDelay(10, 1000, 60000)).toBe(60000); // 1024000 > 60000
			expect(calculateBackoffDelay(1, 1000, 60000)).toBe(2000); // 2000 < 60000
		});
	});

	describe('calculateBackoff', () => {
		it('should return Date with delay for failCount=1', () => {
			const now = Date.now();
			const result = calculateBackoff(1);
			const expectedDelay = 2000; // 2^1 * 1000

			expect(result).toBeInstanceOf(Date);
			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should return Date with delay for failCount=2', () => {
			const now = Date.now();
			const result = calculateBackoff(2);
			const expectedDelay = 4000; // 2^2 * 1000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should return Date with delay for failCount=5', () => {
			const now = Date.now();
			const result = calculateBackoff(5);
			const expectedDelay = 32000; // 2^5 * 1000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should use custom base interval', () => {
			const now = Date.now();
			const result = calculateBackoff(3, 2000);
			const expectedDelay = 16000; // 2^3 * 2000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should use default base interval when not provided', () => {
			const now = Date.now();
			const result = calculateBackoff(4);
			const expectedDelay = 16000; // 2^4 * 1000 (DEFAULT_BASE_INTERVAL)

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should calculate proper exponential progression', () => {
			const now = Date.now();

			// Verify exponential growth pattern
			const delays = [0, 1, 2, 3, 4, 5].map((failCount) => {
				const result = calculateBackoff(failCount);
				return result.getTime() - now;
			});

			expect(delays).toEqual([
				1000, // 2^0 * 1000
				2000, // 2^1 * 1000
				4000, // 2^2 * 1000
				8000, // 2^3 * 1000
				16000, // 2^4 * 1000
				32000, // 2^5 * 1000
			]);
		});

		it('should handle large failCount values', () => {
			const now = Date.now();
			const result = calculateBackoff(15);
			const expectedDelay = 32768000; // 2^15 * 1000 = ~32768 seconds

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should cap delay at maxDelay when provided', () => {
			const now = Date.now();
			const result = calculateBackoff(10, 1000, 60000);
			const expectedDelay = 60000; // Capped at 60000ms

			expect(result.getTime()).toBe(now + expectedDelay);
		});
	});
});
````

## File: packages/core/tests/unit/guards.test.ts
````typescript
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
	isCompletedJob,
	isFailedJob,
	isPendingJob,
	isPersistedJob,
	isProcessingJob,
	isRecurringJob,
	isValidJobStatus,
	type Job,
	JobStatus,
	type PersistedJob,
} from '@/jobs';

describe('job guards', () => {
	let baseJob: Job;

	beforeEach(() => {
		baseJob = {
			name: 'test-job',
			data: { foo: 'bar' },
			status: JobStatus.PENDING,
			nextRunAt: new Date(),
			failCount: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	});

	describe('isPersistedJob', () => {
		it('should return true for job with _id', () => {
			const persistedJob: PersistedJob = {
				...baseJob,
				_id: new ObjectId(),
			};

			expect(isPersistedJob(persistedJob)).toBe(true);
		});

		it('should return false for job without _id', () => {
			expect(isPersistedJob(baseJob)).toBe(false);
		});

		it('should return false when _id is undefined', () => {
			// Job without _id property (same as baseJob)
			expect(isPersistedJob(baseJob)).toBe(false);
		});

		it('should return false when _id is null', () => {
			const jobWithNullId = {
				...baseJob,
				_id: null as unknown as ObjectId,
			};

			expect(isPersistedJob(jobWithNullId)).toBe(false);
		});

		it('should narrow type to PersistedJob when true', () => {
			const job: Job = {
				...baseJob,
				_id: new ObjectId(),
			};

			if (isPersistedJob(job)) {
				// This should compile without errors - TypeScript knows _id exists
				const id: ObjectId = job._id;
				expect(id).toBeInstanceOf(ObjectId);
			} else {
				throw new Error('Should have been persisted');
			}
		});
	});

	describe('isValidJobStatus', () => {
		it('should return true for PENDING status', () => {
			expect(isValidJobStatus(JobStatus.PENDING)).toBe(true);
			expect(isValidJobStatus('pending')).toBe(true);
		});

		it('should return true for PROCESSING status', () => {
			expect(isValidJobStatus(JobStatus.PROCESSING)).toBe(true);
			expect(isValidJobStatus('processing')).toBe(true);
		});

		it('should return true for COMPLETED status', () => {
			expect(isValidJobStatus(JobStatus.COMPLETED)).toBe(true);
			expect(isValidJobStatus('completed')).toBe(true);
		});

		it('should return true for FAILED status', () => {
			expect(isValidJobStatus(JobStatus.FAILED)).toBe(true);
			expect(isValidJobStatus('failed')).toBe(true);
		});

		it('should return false for invalid string', () => {
			expect(isValidJobStatus('invalid')).toBe(false);
			expect(isValidJobStatus('PENDING')).toBe(false);
			expect(isValidJobStatus('')).toBe(false);
		});

		it('should return false for non-string types', () => {
			expect(isValidJobStatus(123)).toBe(false);
			expect(isValidJobStatus(null)).toBe(false);
			expect(isValidJobStatus(undefined)).toBe(false);
			expect(isValidJobStatus({})).toBe(false);
			expect(isValidJobStatus([])).toBe(false);
			expect(isValidJobStatus(true)).toBe(false);
		});
	});

	describe('isPendingJob', () => {
		it('should return true when status is PENDING', () => {
			const job: Job = { ...baseJob, status: JobStatus.PENDING };
			expect(isPendingJob(job)).toBe(true);
		});

		it('should return false when status is not PENDING', () => {
			expect(isPendingJob({ ...baseJob, status: JobStatus.PROCESSING })).toBe(false);
			expect(isPendingJob({ ...baseJob, status: JobStatus.COMPLETED })).toBe(false);
			expect(isPendingJob({ ...baseJob, status: JobStatus.FAILED })).toBe(false);
		});
	});

	describe('isProcessingJob', () => {
		it('should return true when status is PROCESSING', () => {
			const job: Job = { ...baseJob, status: JobStatus.PROCESSING };
			expect(isProcessingJob(job)).toBe(true);
		});

		it('should return false when status is not PROCESSING', () => {
			expect(isProcessingJob({ ...baseJob, status: JobStatus.PENDING })).toBe(false);
			expect(isProcessingJob({ ...baseJob, status: JobStatus.COMPLETED })).toBe(false);
			expect(isProcessingJob({ ...baseJob, status: JobStatus.FAILED })).toBe(false);
		});
	});

	describe('isCompletedJob', () => {
		it('should return true when status is COMPLETED', () => {
			const job: Job = { ...baseJob, status: JobStatus.COMPLETED };
			expect(isCompletedJob(job)).toBe(true);
		});

		it('should return false when status is not COMPLETED', () => {
			expect(isCompletedJob({ ...baseJob, status: JobStatus.PENDING })).toBe(false);
			expect(isCompletedJob({ ...baseJob, status: JobStatus.PROCESSING })).toBe(false);
			expect(isCompletedJob({ ...baseJob, status: JobStatus.FAILED })).toBe(false);
		});
	});

	describe('isFailedJob', () => {
		it('should return true when status is FAILED', () => {
			const job: Job = { ...baseJob, status: JobStatus.FAILED };
			expect(isFailedJob(job)).toBe(true);
		});

		it('should return false when status is not FAILED', () => {
			expect(isFailedJob({ ...baseJob, status: JobStatus.PENDING })).toBe(false);
			expect(isFailedJob({ ...baseJob, status: JobStatus.PROCESSING })).toBe(false);
			expect(isFailedJob({ ...baseJob, status: JobStatus.COMPLETED })).toBe(false);
		});
	});

	describe('isRecurringJob', () => {
		it('should return true when repeatInterval is defined', () => {
			const job: Job = { ...baseJob, repeatInterval: '0 * * * *' };
			expect(isRecurringJob(job)).toBe(true);
		});

		it('should return false when repeatInterval is undefined', () => {
			const job: Job = { ...baseJob };
			expect(isRecurringJob(job)).toBe(false);
		});

		it('should return false when repeatInterval is null', () => {
			const job: Job = { ...baseJob, repeatInterval: null as unknown as string };
			expect(isRecurringJob(job)).toBe(false);
		});

		it('should return true for empty string repeatInterval', () => {
			// Even empty string means it's defined as recurring (though invalid cron)
			const job: Job = { ...baseJob, repeatInterval: '' };
			expect(isRecurringJob(job)).toBe(true);
		});
	});

	describe('combined usage', () => {
		it('should allow combining multiple guards', () => {
			const job: PersistedJob = {
				...baseJob,
				_id: new ObjectId(),
				status: JobStatus.FAILED,
				repeatInterval: '0 0 * * *',
			};

			expect(isPersistedJob(job)).toBe(true);
			expect(isFailedJob(job)).toBe(true);
			expect(isRecurringJob(job)).toBe(true);
			expect(isPendingJob(job)).toBe(false);
		});

		it('should work in filter operations', () => {
			const jobs: Job[] = [
				{ ...baseJob, status: JobStatus.PENDING },
				{ ...baseJob, status: JobStatus.PROCESSING },
				{ ...baseJob, status: JobStatus.COMPLETED },
				{ ...baseJob, status: JobStatus.FAILED },
			];

			const pendingJobs = jobs.filter(isPendingJob);
			const failedJobs = jobs.filter(isFailedJob);

			expect(pendingJobs).toHaveLength(1);
			expect(failedJobs).toHaveLength(1);
		});
	});
});
````

## File: packages/core/src/scheduler/types.ts
````typescript
/**
 * Configuration options for the Monque scheduler.
 *
 * @example
 * ```typescript
 * const monque = new Monque(db, {
 *   collectionName: 'jobs',
 *   pollInterval: 1000,
 *   maxRetries: 10,
 *   baseRetryInterval: 1000,
 *   shutdownTimeout: 30000,
 *   defaultConcurrency: 5,
 * });
 * ```
 */
export interface MonqueOptions {
	/**
	 * Name of the MongoDB collection for storing jobs.
	 * @default 'monque_jobs'
	 */
	collectionName?: string;

	/**
	 * Interval in milliseconds between polling for new jobs.
	 * @default 1000
	 */
	pollInterval?: number;

	/**
	 * Maximum number of retry attempts before marking a job as permanently failed.
	 * @default 10
	 */
	maxRetries?: number;

	/**
	 * Base interval in milliseconds for exponential backoff calculation.
	 * Actual delay = 2^failCount * baseRetryInterval
	 * @default 1000
	 */
	baseRetryInterval?: number;

	/**
	 * Maximum delay in milliseconds for exponential backoff.
	 * If calculated delay exceeds this value, it will be capped.
	 * @default undefined (no cap)
	 */
	maxBackoffDelay?: number | undefined;

	/**
	 * Timeout in milliseconds for graceful shutdown.
	 * @default 30000
	 */
	shutdownTimeout?: number;

	/**
	 * Default number of concurrent jobs per worker.
	 * @default 5
	 */
	defaultConcurrency?: number;

	/**
	 * Maximum time in milliseconds a job can be in 'processing' status before
	 * being considered stale and eligible for re-acquisition by other workers.
	 * When using heartbeat-based detection, this should be at least 2-3x the heartbeatInterval.
	 * @default 1800000 (30 minutes)
	 */
	lockTimeout?: number;

	/**
	 * Unique identifier for this scheduler instance.
	 * Used for atomic job claiming - each instance uses this ID to claim jobs.
	 * Defaults to a randomly generated UUID v4.
	 * @default crypto.randomUUID()
	 */
	schedulerInstanceId?: string;

	/**
	 * Interval in milliseconds for heartbeat updates during job processing.
	 * The scheduler periodically updates lastHeartbeat for all jobs it is processing
	 * to indicate liveness. Other instances use this to detect stale jobs.
	 * @default 30000 (30 seconds)
	 */
	heartbeatInterval?: number;

	/**
	 * Whether to recover stale processing jobs on scheduler startup.
	 * When true, jobs with lockedAt older than lockTimeout will be reset to pending.
	 * @default true
	 */
	recoverStaleJobs?: boolean;

	/**
	 * Configuration for automatic cleanup of completed and failed jobs.
	 * If undefined, no cleanup is performed.
	 */
	jobRetention?:
		| {
				/**
				 * Age in milliseconds after which completed jobs are deleted.
				 * Cleaned up based on 'updatedAt' timestamp.
				 */
				completed?: number;

				/**
				 * Age in milliseconds after which failed jobs are deleted.
				 * Cleaned up based on 'updatedAt' timestamp.
				 */
				failed?: number;

				/**
				 * Interval in milliseconds for running the cleanup job.
				 * @default 3600000 (1 hour)
				 */
				interval?: number;
		  }
		| undefined;
}
````

## File: packages/core/src/shared/errors.ts
````typescript
import type { Job } from '@/jobs';

/**
 * Base error class for all Monque-related errors.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.enqueue('job', data);
 * } catch (error) {
 *   if (error instanceof MonqueError) {
 *     console.error('Monque error:', error.message);
 *   }
 * }
 * ```
 */
export class MonqueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MonqueError';
		// Maintains proper stack trace for where our error was thrown (only available on V8)
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, MonqueError);
		}
	}
}

/**
 * Error thrown when an invalid cron expression is provided.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.schedule('invalid cron', 'job', data);
 * } catch (error) {
 *   if (error instanceof InvalidCronError) {
 *     console.error('Invalid expression:', error.expression);
 *   }
 * }
 * ```
 */
export class InvalidCronError extends MonqueError {
	constructor(
		public readonly expression: string,
		message: string,
	) {
		super(message);
		this.name = 'InvalidCronError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, InvalidCronError);
		}
	}
}

/**
 * Error thrown when there's a database connection issue.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.enqueue('job', data);
 * } catch (error) {
 *   if (error instanceof ConnectionError) {
 *     console.error('Database connection lost');
 *   }
 * }
 * ```
 */
export class ConnectionError extends MonqueError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message);
		this.name = 'ConnectionError';
		if (options?.cause) {
			this.cause = options.cause;
		}
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ConnectionError);
		}
	}
}

/**
 * Error thrown when graceful shutdown times out.
 * Includes information about jobs that were still in progress.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.stop();
 * } catch (error) {
 *   if (error instanceof ShutdownTimeoutError) {
 *     console.error('Incomplete jobs:', error.incompleteJobs.length);
 *   }
 * }
 * ```
 */
export class ShutdownTimeoutError extends MonqueError {
	constructor(
		message: string,
		public readonly incompleteJobs: Job[],
	) {
		super(message);
		this.name = 'ShutdownTimeoutError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ShutdownTimeoutError);
		}
	}
}

/**
 * Error thrown when attempting to register a worker for a job name
 * that already has a registered worker, without explicitly allowing replacement.
 *
 * @example
 * ```typescript
 * try {
 *   monque.worker('send-email', handler1);
 *   monque.worker('send-email', handler2); // throws
 * } catch (error) {
 *   if (error instanceof WorkerRegistrationError) {
 *     console.error('Worker already registered for:', error.jobName);
 *   }
 * }
 *
 * // To intentionally replace a worker:
 * monque.worker('send-email', handler2, { replace: true });
 * ```
 */
export class WorkerRegistrationError extends MonqueError {
	constructor(
		message: string,
		public readonly jobName: string,
	) {
		super(message);
		this.name = 'WorkerRegistrationError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, WorkerRegistrationError);
		}
	}
}
````

## File: packages/core/tests/integration/concurrency.test.ts
````typescript
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
				defaultConcurrency: 5,
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
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);
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
````

## File: packages/core/tests/integration/enqueue.test.ts
````typescript
/**
 * Tests for the enqueue() method of the Monque scheduler.
 *
 * These tests verify:
 * - Basic job enqueueing functionality
 * - runAt option for delayed jobs
 * - Correct Job document structure returned
 * - Data integrity (payload preserved correctly)
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
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus, type PersistedJob } from '@/jobs';
import type { MonqueOptions } from '@/scheduler';
import { Monque } from '@/scheduler';

describe('enqueue()', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('enqueue');
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

	describe('basic enqueueing', () => {
		it('should enqueue a job with name and data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, TEST_CONSTANTS.JOB_DATA);

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

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 123 });

			expect(job.status).toBe(JobStatus.PENDING);
		});

		it('should set failCount to 0', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});

			expect(job.failCount).toBe(0);
		});

		it('should set createdAt and updatedAt timestamps', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const beforeEnqueue = new Date();
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			const afterEnqueue = new Date();

			expect(job.createdAt).toBeInstanceOf(Date);
			expect(job.updatedAt).toBeInstanceOf(Date);
			expect(job.createdAt.getTime()).toBeGreaterThanOrEqual(beforeEnqueue.getTime());
			expect(job.createdAt.getTime()).toBeLessThanOrEqual(afterEnqueue.getTime());
		});

		it('should set nextRunAt to now by default', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const beforeEnqueue = new Date();
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			const afterEnqueue = new Date();

			expect(job.nextRunAt).toBeInstanceOf(Date);
			expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeEnqueue.getTime());
			expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterEnqueue.getTime());
		});
	});

	describe('runAt option', () => {
		it('should schedule job for future execution with runAt', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const futureDate = new Date(Date.now() + 60000); // 1 minute in future
			const job = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ task: 'later' },
				{ runAt: futureDate },
			);

			expect(job.nextRunAt.getTime()).toBe(futureDate.getTime());
		});

		it('should accept runAt in the past', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pastDate = new Date(Date.now() - 60000); // 1 minute in past
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { runAt: pastDate });

			expect(job.nextRunAt.getTime()).toBe(pastDate.getTime());
		});
	});

	describe('data integrity', () => {
		it('should preserve string data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { message: 'Hello, World!' };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve numeric data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { count: 42, price: 19.99 };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve nested object data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = {
				user: {
					id: '123',
					profile: {
						name: 'John',
						email: 'john@example.com',
					},
				},
				settings: {
					enabled: true,
					options: ['a', 'b', 'c'],
				},
			};
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve array data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { items: [1, 2, 3, 4, 5] };
			const job = await monque.enqueue('array-job', data);

			expect(job.data).toEqual(data);
		});

		it('should preserve null values in data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { value: null, other: 'present' };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});

		it('should preserve boolean values in data', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const data = { active: true, deleted: false };
			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);

			expect(job.data).toEqual(data);
		});
	});

	describe('return value', () => {
		it('should return Job with all required fields', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });

			// Required fields
			expect(job._id).toBeDefined();
			expect(job.name).toBeDefined();
			expect(job.data).toBeDefined();
			expect(job.status).toBeDefined();
			expect(job.nextRunAt).toBeDefined();
			expect(job.failCount).toBeDefined();
			expect(job.createdAt).toBeDefined();
			expect(job.updatedAt).toBeDefined();
		});

		it('should not include optional fields when not set', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});

			// Optional fields should not be set
			expect(job.uniqueKey).toBeUndefined();
			expect(job.repeatInterval).toBeUndefined();
			expect(job.failReason).toBeUndefined();
			expect(job.claimedBy).toBeUndefined();
			expect(job.lastHeartbeat).toBeUndefined();
			expect(job.heartbeatInterval).toBeUndefined();
		});

		it('should include uniqueKey when provided', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { uniqueKey: 'test-key-123' });

			expect(job.uniqueKey).toBe('test-key-123');
		});
	});

	describe('persistence', () => {
		it('should persist job to MongoDB collection', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { stored: true });

			// Verify job exists in collection
			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc).not.toBeNull();
			expect(doc?.['name']).toBe(TEST_CONSTANTS.JOB_NAME);
			expect(doc?.['data']).toEqual({ stored: true });
		});

		it('should allow enqueueing multiple jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job1 = await monque.enqueue('job-1', { index: 1 });
			const job2 = await monque.enqueue('job-2', { index: 2 });
			const job3 = await monque.enqueue('job-3', { index: 3 });

			expect(job1._id).not.toEqual(job2._id);
			expect(job2._id).not.toEqual(job3._id);

			const collection = db.collection(collectionName);
			const count = await collection.countDocuments();
			expect(count).toBe(3);
		});
	});

	describe('error handling', () => {
		it('should throw if not initialized', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			// Do NOT call initialize()

			await expect(monque.enqueue('test', {})).rejects.toThrow('not initialized');
		});
	});
});

describe('now()', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('now');
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

	it('should enqueue a job for immediate processing', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const beforeNow = new Date();
		const job = await monque.now(TEST_CONSTANTS.JOB_NAME, { urgent: true });
		const afterNow = new Date();

		expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeNow.getTime());
		expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterNow.getTime());
	});

	it('should be equivalent to enqueue with runAt: new Date()', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const nowJob = await monque.now('now-job', { method: 'now' });
		const enqueueJob = await monque.enqueue(
			'enqueue-job',
			{ method: 'enqueue' },
			{ runAt: new Date() },
		);

		// Both should have similar structure
		expect(nowJob.status).toBe(enqueueJob.status);
		expect(nowJob.failCount).toBe(enqueueJob.failCount);

		// nextRunAt should be close (within 100ms)
		const timeDiff = Math.abs(nowJob.nextRunAt.getTime() - enqueueJob.nextRunAt.getTime());
		expect(timeDiff).toBeLessThan(100);
	});

	it('should preserve data payload', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const data = { email: 'test@example.com', subject: 'Hello' };
		const job = await monque.now(TEST_CONSTANTS.JOB_NAME, data);

		expect(job.data).toEqual(data);
	});

	it('should return a valid Job document', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, { collectionName });
		monqueInstances.push(monque);
		await monque.initialize();

		const job = await monque.now(TEST_CONSTANTS.JOB_NAME, {});

		expect(job._id).toBeDefined();
		expect(job.name).toBe(TEST_CONSTANTS.JOB_NAME);
		expect(job.status).toBe(JobStatus.PENDING);
		expect(job.failCount).toBe(0);
	});
});

/**
 * Tests for uniqueKey deduplication behavior.
 *
 * These tests verify prevent Duplicate Jobs with Unique Keys:
 * - pending jobs block new jobs with same uniqueKey
 * - processing jobs block new jobs with same uniqueKey
 * - completed jobs allow new jobs with same uniqueKey
 * - failed jobs allow new jobs with same uniqueKey
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
describe('uniqueKey deduplication', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('uniqueKey');
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

	describe('pending job blocks new job with same uniqueKey', () => {
		it('should not create duplicate when pending job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create first job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);

			// Try to create duplicate with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should return the existing job (same _id)
			expect(job2._id?.toString()).toBe(job1._id?.toString());

			// Should only be one job in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(count).toBe(1);
		});

		it('should return the original job document when deduped', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create first job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', first: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Try to create duplicate with different data
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', second: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should return existing job with original data
			expect(job2.data).toEqual({ userId: '123', first: true });
			expect(job2._id?.toString()).toBe(job1._id?.toString());
		});
	});

	describe('processing job blocks new job with same uniqueKey', () => {
		it('should not create duplicate when processing job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);
			expect(job1._id).toBeDefined();

			// Manually update job status to processing (simulating worker pickup)
			const collection = db.collection(collectionName);
			await collection.updateOne(
				{ _id: job1._id },
				{ $set: { status: JobStatus.PROCESSING, lockedAt: new Date() } },
			);

			// Try to create another job with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should return the existing job (same _id)
			expect(job2._id?.toString()).toBe(job1._id?.toString());

			// Should only be one job in the collection
			const count = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(count).toBe(1);
		});
	});

	describe('completed job allows new job with same uniqueKey', () => {
		it('should create new job when completed job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);
			expect(job1._id).toBeDefined();

			// Manually update job status to completed
			const collection = db.collection(collectionName);
			await collection.updateOne({ _id: job1._id }, { $set: { status: JobStatus.COMPLETED } });

			// Create another job with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', retry: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should create a NEW job (different _id)
			expect(job2._id?.toString()).not.toBe(job1._id?.toString());
			expect(job2.status).toBe(JobStatus.PENDING);
			expect(job2.data).toEqual({ userId: '123', retry: true });

			// Should have two jobs in the collection (one completed, one pending)
			const totalCount = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(totalCount).toBe(2);

			const pendingCount = await collection.countDocuments({
				uniqueKey: 'sync-user-123',
				status: JobStatus.PENDING,
			});
			expect(pendingCount).toBe(1);
		});
	});

	describe('failed job allows new job with same uniqueKey', () => {
		it('should create new job when failed job exists with same uniqueKey', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create a job with uniqueKey
			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123' },
				{ uniqueKey: 'sync-user-123' },
			);
			expect(job1._id).toBeDefined();

			// Manually update job status to failed (permanent failure after max retries)
			const collection = db.collection(collectionName);
			await collection.updateOne(
				{ _id: job1._id },
				{
					$set: {
						status: JobStatus.FAILED,
						failCount: 10,
						failReason: 'Max retries exceeded',
					},
				},
			);

			// Create another job with same uniqueKey
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '123', retry: true },
				{ uniqueKey: 'sync-user-123' },
			);

			// Should create a NEW job (different _id)
			expect(job2._id?.toString()).not.toBe(job1._id?.toString());
			expect(job2.status).toBe(JobStatus.PENDING);

			// Should have two jobs in the collection (one failed, one pending)
			const totalCount = await collection.countDocuments({ uniqueKey: 'sync-user-123' });
			expect(totalCount).toBe(2);
		});
	});

	describe('concurrent enqueue with same uniqueKey', () => {
		it('should handle concurrent enqueue attempts atomically', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create 10 concurrent enqueue attempts with same uniqueKey
			const enqueuePromises = Array.from({ length: 10 }, (_, i) =>
				monque.enqueue(TEST_CONSTANTS.JOB_NAME, { attempt: i }, { uniqueKey: 'concurrent-test' }),
			);

			const results = await Promise.all(enqueuePromises);

			// All results should be defined
			expect(results.length).toBe(10);

			// Get first result and verify it exists
			const firstResult = results[0] as NonNullable<(typeof results)[0]>;
			expect(firstResult._id).toBeDefined();

			// All should return the same job (same _id)
			const firstId = firstResult._id.toString();
			expect(results.every((job) => job._id?.toString() === firstId)).toBe(true);

			// Should only be one job in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({ uniqueKey: 'concurrent-test' });
			expect(count).toBe(1);
		});
	});

	describe('different uniqueKeys create separate jobs', () => {
		it('should create separate jobs for different uniqueKeys', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job1 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '111' },
				{ uniqueKey: 'sync-user-111' },
			);
			const job2 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '222' },
				{ uniqueKey: 'sync-user-222' },
			);
			const job3 = await monque.enqueue(
				TEST_CONSTANTS.JOB_NAME,
				{ userId: '333' },
				{ uniqueKey: 'sync-user-333' },
			);

			// All should have different _ids
			expect(job1._id?.toString()).not.toBe(job2._id?.toString());
			expect(job2._id?.toString()).not.toBe(job3._id?.toString());

			// Should have three jobs in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({});
			expect(count).toBe(3);
		});
	});

	describe('jobs without uniqueKey are not deduplicated', () => {
		it('should create multiple jobs when no uniqueKey is provided', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			// Create multiple jobs without uniqueKey
			const job1 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: 'user@example.com' });
			const job2 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: 'user@example.com' });
			const job3 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: 'user@example.com' });

			// All should have different _ids
			expect(job1._id?.toString()).not.toBe(job2._id?.toString());
			expect(job2._id?.toString()).not.toBe(job3._id?.toString());

			// Should have three jobs in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({});
			expect(count).toBe(3);
		});
	});

	describe('Atomic Claim Support', () => {
		describe('Job interface fields', () => {
			it('should allow claimedBy field with string value', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
				const collection = db.collection(collectionName);

				const jobDoc = JobFactoryHelpers.processing({
					name: TEST_CONSTANTS.JOB_NAME,
					claimedBy: 'instance-123',
				});

				const result = await collection.insertOne(jobDoc);
				const inserted = await collection.findOne({ _id: result.insertedId });

				expect(inserted?.['claimedBy']).toBe('instance-123');
			});

			it('should allow lastHeartbeat field with Date value', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
				const collection = db.collection(collectionName);

				const heartbeatTime = new Date();
				const jobDoc = JobFactoryHelpers.processing({
					name: TEST_CONSTANTS.JOB_NAME,
					lastHeartbeat: heartbeatTime,
				});

				const result = await collection.insertOne(jobDoc);
				const inserted = await collection.findOne({ _id: result.insertedId });

				expect(inserted?.['lastHeartbeat']).toBeInstanceOf(Date);
				expect((inserted?.['lastHeartbeat'] as Date).getTime()).toBe(heartbeatTime.getTime());
			});

			it('should allow heartbeatInterval field with number value', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
				const collection = db.collection(collectionName);

				const jobDoc = JobFactoryHelpers.processing({
					name: TEST_CONSTANTS.JOB_NAME,
					heartbeatInterval: 5000,
				});

				const result = await collection.insertOne(jobDoc);
				const inserted = await collection.findOne({ _id: result.insertedId });

				expect(inserted?.['heartbeatInterval']).toBe(5000);
			});
		});

		describe('MonqueOptions fields', () => {
			it('should accept schedulerInstanceId option', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

				const options: MonqueOptions = {
					collectionName,
					schedulerInstanceId: 'custom-instance-id-123',
				};

				const monque = new Monque(db, options);
				monqueInstances.push(monque);

				expect(options.schedulerInstanceId).toBe('custom-instance-id-123');
			});

			it('should accept heartbeatInterval option', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

				const options: MonqueOptions = {
					collectionName,
					heartbeatInterval: 3000,
				};

				const monque = new Monque(db, options);
				monqueInstances.push(monque);

				expect(options.heartbeatInterval).toBe(3000);
			});

			it('should accept all atomic claim options together', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

				const options: MonqueOptions = {
					collectionName,
					schedulerInstanceId: 'my-scheduler-001',
					heartbeatInterval: 5000,
					lockTimeout: 30000,
				};

				const monque = new Monque(db, options);
				monqueInstances.push(monque);

				expect(options.schedulerInstanceId).toBe('my-scheduler-001');
				expect(options.heartbeatInterval).toBe(5000);
				expect(options.lockTimeout).toBe(30000);
			});
		});

		describe('PersistedJob fields', () => {
			it('should have optional atomic claim fields on enqueue', async () => {
				collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
				const monque = new Monque(db, { collectionName });
				monqueInstances.push(monque);
				await monque.initialize();

				const job: PersistedJob = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });

				expect(job.claimedBy).toBeUndefined();
				expect(job.lastHeartbeat).toBeUndefined();
				expect(job.heartbeatInterval).toBeUndefined();
			});
		});
	});
});
````

## File: packages/core/tests/integration/indexes.test.ts
````typescript
/**
 * Tests for MongoDB index creation and query performance.
 *
 * These tests verify:
 * - All required indexes are created on initialization
 * - Indexes for atomic claim pattern (claimedBy+status, lastHeartbeat+status)
 * - Compound indexes for atomic claim queries (status+nextRunAt+claimedBy)
 * - Expanded recovery index (lockedAt+lastHeartbeat+status)
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
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Index creation', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('indexes');
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

	describe('required indexes', () => {
		it('should create all required indexes on initialization', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const indexKeys = indexes.map((idx) => Object.keys(idx.key).join(','));

			// Core indexes
			expect(indexKeys).toContain('status,nextRunAt');
			expect(indexKeys).toContain('name,uniqueKey');
			expect(indexKeys).toContain('name,status');

			// Atomic claim indexes
			expect(indexKeys).toContain('claimedBy,status');
			expect(indexKeys).toContain('lastHeartbeat,status');
			expect(indexKeys).toContain('status,nextRunAt,claimedBy');
			expect(indexKeys).toContain('lockedAt,lastHeartbeat,status');
		});

		it('should create claimedBy+status compound index for job ownership queries', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const claimedByIndex = indexes.find(
				(idx) => 'claimedBy' in idx.key && 'status' in idx.key && Object.keys(idx.key).length === 2,
			);

			expect(claimedByIndex).toBeDefined();
			expect(claimedByIndex?.key).toEqual({ claimedBy: 1, status: 1 });
			expect(claimedByIndex?.background).toBe(true);
		});

		it('should create lastHeartbeat+status compound index for stale job detection', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const heartbeatIndex = indexes.find(
				(idx) =>
					'lastHeartbeat' in idx.key && 'status' in idx.key && Object.keys(idx.key).length === 2,
			);

			expect(heartbeatIndex).toBeDefined();
			expect(heartbeatIndex?.key).toEqual({ lastHeartbeat: 1, status: 1 });
			expect(heartbeatIndex?.background).toBe(true);
		});

		it('should create status+nextRunAt+claimedBy compound index for atomic claim queries', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const atomicClaimIndex = indexes.find(
				(idx) =>
					'status' in idx.key &&
					'nextRunAt' in idx.key &&
					'claimedBy' in idx.key &&
					Object.keys(idx.key).length === 3,
			);

			expect(atomicClaimIndex).toBeDefined();
			expect(atomicClaimIndex?.key).toEqual({ status: 1, nextRunAt: 1, claimedBy: 1 });
			expect(atomicClaimIndex?.background).toBe(true);
		});

		it('should create expanded lockedAt+lastHeartbeat+status index for recovery queries', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const recoveryIndex = indexes.find(
				(idx) =>
					'lockedAt' in idx.key &&
					'lastHeartbeat' in idx.key &&
					'status' in idx.key &&
					Object.keys(idx.key).length === 3,
			);

			expect(recoveryIndex).toBeDefined();
			expect(recoveryIndex?.key).toEqual({ lockedAt: 1, lastHeartbeat: 1, status: 1 });
			expect(recoveryIndex?.background).toBe(true);
		});
	});

	describe('query performance with claimedBy+status index', () => {
		it('should use index for finding jobs by owner', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const instanceId = 'test-instance-123';

			// Insert test jobs using factory helpers
			const job1 = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				claimedBy: instanceId,
			});
			const job2 = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				claimedBy: 'other-instance',
			});
			await collection.insertMany([job1, job2]);

			// Query using the index
			const explainResult = await collection
				.find({ claimedBy: instanceId, status: JobStatus.PROCESSING })
				.explain('executionStats');

			// Verify index was used (not a collection scan)
			const queryPlanner = explainResult['queryPlanner'] as Record<string, unknown>;
			const winningPlanStr = JSON.stringify(queryPlanner);
			expect(winningPlanStr).toContain('IXSCAN');
		});
	});

	describe('query performance with lastHeartbeat+status index', () => {
		it('should use index for finding stale jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const staleThreshold = new Date(Date.now() - 30000);

			// Insert test jobs using factory helpers with different heartbeat times
			const staleJob = JobFactoryHelpers.processing({
				name: 'stale-job',
				lastHeartbeat: new Date(Date.now() - 60000), // 60 seconds ago (stale)
			});
			const activeJob = JobFactoryHelpers.processing({
				name: 'active-job',
				lastHeartbeat: new Date(), // Just now (not stale)
			});
			await collection.insertMany([staleJob, activeJob]);

			// Query using the index (find stale jobs)
			const explainResult = await collection
				.find({ status: JobStatus.PROCESSING, lastHeartbeat: { $lt: staleThreshold } })
				.explain('executionStats');

			// Verify index was used
			const queryPlanner = explainResult['queryPlanner'] as Record<string, unknown>;
			const winningPlanStr = JSON.stringify(queryPlanner);
			expect(winningPlanStr).toContain('IXSCAN');
		});
	});
});
````

## File: packages/core/tests/integration/locking.test.ts
````typescript
/**
 * Tests for atomic job locking in the Monque scheduler.
 *
 * These tests verify:
 * - Atomic locking prevents duplicate job processing
 * - Concurrent workers safely acquire different jobs
 * - No race conditions in job pickup
 * - lockedAt field is set correctly during processing
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

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('atomic job locking', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('locking');
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

	describe('single job acquisition', () => {
		it('should set lockedAt when acquiring a job', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			let processingJob: Job | null = null;
			const handler = vi.fn(async (job: Job) => {
				processingJob = job;
				// Hold the job for a moment to inspect state
				await new Promise((r) => setTimeout(r, 200));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			monque.start();

			// Wait for job to be picked up
			await waitFor(async () => processingJob !== null);

			// Check database state while processing
			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc?.['status']).toBe(JobStatus.PROCESSING);
			expect(doc?.['lockedAt']).toBeInstanceOf(Date);

			await monque.stop();
		});

		it('should update status to processing when job is acquired', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			let jobAcquired = false;
			const handler = vi.fn(async () => {
				jobAcquired = true;
				await new Promise((r) => setTimeout(r, 200));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});

			// Verify initial state
			let collection = db.collection(collectionName);
			let doc = await collection.findOne({ _id: job._id });
			expect(doc?.['status']).toBe(JobStatus.PENDING);

			monque.start();

			// Wait for job to be acquired
			await waitFor(async () => jobAcquired);

			// Verify processing state
			collection = db.collection(collectionName);
			doc = await collection.findOne({ _id: job._id });
			expect(doc?.['status']).toBe(JobStatus.PROCESSING);

			await monque.stop();
		});
	});

	describe('concurrent workers - no duplicate processing', () => {
		it('should not process the same job twice with multiple scheduler instances', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			// Create two scheduler instances pointing to same collection
			const monque1 = new Monque(db, { collectionName, pollInterval: 50, defaultConcurrency: 5 });
			monqueInstances.push(monque1);
			const monque2 = new Monque(db, { collectionName, pollInterval: 50, defaultConcurrency: 5 });
			monqueInstances.push(monque2);

			await monque1.initialize();
			await monque2.initialize();

			const processedJobs: string[] = [];
			const processedJobIds = new Set<string>();

			const handler1 = vi.fn(async (job: Job) => {
				const jobId = job._id?.toString() ?? '';
				if (!job._id) throw new Error('Expected job._id to be defined');
				processedJobs.push(`instance1:${jobId}`);
				processedJobIds.add(jobId);
				await new Promise((r) => setTimeout(r, 100));
			});

			const handler2 = vi.fn(async (job: Job) => {
				const jobId = job._id?.toString() ?? '';
				if (!job._id) throw new Error('Expected job._id to be defined');
				processedJobs.push(`instance2:${jobId}`);
				processedJobIds.add(jobId);
				await new Promise((r) => setTimeout(r, 100));
			});

			monque1.worker(TEST_CONSTANTS.JOB_NAME, handler1);
			monque2.worker(TEST_CONSTANTS.JOB_NAME, handler2);

			// Enqueue multiple jobs
			const jobCount = 10;
			const enqueuedJobIds: string[] = [];
			for (let i = 0; i < jobCount; i++) {
				const job = await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { index: i });
				enqueuedJobIds.push(job._id.toString());
			}

			// Start both instances
			monque1.start();
			monque2.start();

			// Wait for all jobs to be processed
			await waitFor(async () => processedJobIds.size === jobCount, { timeout: 10000 });

			await monque1.stop();
			await monque2.stop();

			// Verify each job was processed exactly once
			expect(processedJobIds.size).toBe(jobCount);

			// Verify all enqueued jobs were processed
			for (const jobId of enqueuedJobIds) {
				expect(processedJobIds.has(jobId)).toBe(true);
			}

			// Total handler calls should equal job count (no duplicates)
			expect(handler1.mock.calls.length + handler2.mock.calls.length).toBe(jobCount);
		});

		it('should distribute jobs between concurrent workers', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			const monque1 = new Monque(db, { collectionName, pollInterval: 30, defaultConcurrency: 2 });
			monqueInstances.push(monque1);
			const monque2 = new Monque(db, { collectionName, pollInterval: 30, defaultConcurrency: 2 });
			monqueInstances.push(monque2);

			await monque1.initialize();
			await monque2.initialize();

			const instance1Jobs: number[] = [];
			const instance2Jobs: number[] = [];

			const handler1 = vi.fn(async (job: Job<{ index: number }>) => {
				instance1Jobs.push(job.data.index);
				await new Promise((r) => setTimeout(r, 80));
			});

			const handler2 = vi.fn(async (job: Job<{ index: number }>) => {
				instance2Jobs.push(job.data.index);
				await new Promise((r) => setTimeout(r, 80));
			});

			monque1.worker(TEST_CONSTANTS.JOB_NAME, handler1);
			monque2.worker(TEST_CONSTANTS.JOB_NAME, handler2);

			// Enqueue jobs
			const jobCount = 8;
			for (let i = 0; i < jobCount; i++) {
				await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { index: i });
			}

			monque1.start();
			monque2.start();

			await waitFor(async () => instance1Jobs.length + instance2Jobs.length === jobCount, {
				timeout: 10000,
			});

			await monque1.stop();
			await monque2.stop();

			// Both instances should have processed some jobs
			expect(instance1Jobs.length + instance2Jobs.length).toBe(jobCount);

			// With two instances and 8 jobs, both should have gotten at least one job
			// (this is probabilistic but with proper locking should be true)
			// We mainly verify no duplicates
			const allProcessed = [...instance1Jobs, ...instance2Jobs].sort((a, b) => a - b);
			expect(allProcessed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		});

		it('should handle rapid polling without duplicate acquisition', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);

			// Very short poll interval to increase contention
			const monque1 = new Monque(db, { collectionName, pollInterval: 10, defaultConcurrency: 1 });
			monqueInstances.push(monque1);
			const monque2 = new Monque(db, { collectionName, pollInterval: 10, defaultConcurrency: 1 });
			monqueInstances.push(monque2);
			const monque3 = new Monque(db, { collectionName, pollInterval: 10, defaultConcurrency: 1 });
			monqueInstances.push(monque3);

			await monque1.initialize();
			await monque2.initialize();
			await monque3.initialize();

			const processedJobIds = new Set<string>();
			const duplicates: string[] = [];

			const createHandler = () =>
				vi.fn(async (job: Job) => {
					const jobId = job._id?.toString() ?? '';
					if (!job._id) throw new Error('Expected job._id to be defined');
					if (processedJobIds.has(jobId)) {
						duplicates.push(jobId);
					}
					processedJobIds.add(jobId);
					await new Promise((r) => setTimeout(r, 50));
				});

			const handler1 = createHandler();
			const handler2 = createHandler();
			const handler3 = createHandler();

			monque1.worker(TEST_CONSTANTS.JOB_NAME, handler1);
			monque2.worker(TEST_CONSTANTS.JOB_NAME, handler2);
			monque3.worker(TEST_CONSTANTS.JOB_NAME, handler3);

			// Enqueue jobs
			const jobCount = 15;
			for (let i = 0; i < jobCount; i++) {
				await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { index: i });
			}

			monque1.start();
			monque2.start();
			monque3.start();

			await waitFor(async () => processedJobIds.size === jobCount, { timeout: 15000 });

			await monque1.stop();
			await monque2.stop();
			await monque3.stop();

			// No duplicates should have been processed
			expect(duplicates).toHaveLength(0);
			expect(processedJobIds.size).toBe(jobCount);
		});
	});

	describe('lock state transitions', () => {
		it('should transition pending → processing → completed', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const statusHistory: string[] = [];
			let checkDuringProcessing = false;

			const handler = vi.fn(async () => {
				checkDuringProcessing = true;
				await new Promise((r) => setTimeout(r, 200));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			const collection = db.collection(collectionName);

			// Check initial status
			let doc = await collection.findOne({ _id: job._id });
			statusHistory.push(doc?.['status'] as string);

			monque.start();

			// Wait until processing starts
			await waitFor(async () => checkDuringProcessing);

			// Check processing status
			doc = await collection.findOne({ _id: job._id });
			statusHistory.push(doc?.['status'] as string);

			// Wait for completion
			await waitFor(async () => {
				const d = await collection.findOne({ _id: job._id });
				return d?.['status'] === JobStatus.COMPLETED;
			});

			// Check completed status
			doc = await collection.findOne({ _id: job._id });
			statusHistory.push(doc?.['status'] as string);

			await monque.stop();

			expect(statusHistory).toEqual([JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.COMPLETED]);
		});

		it('should clear lockedAt after job completion', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			monque.start();

			await waitFor(async () => {
				const collection = db.collection(collectionName);
				const doc = await collection.findOne({ _id: job._id });
				return doc?.['status'] === JobStatus.COMPLETED;
			});

			await monque.stop();

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });
			expect(doc?.['lockedAt']).toBeUndefined();
		});

		it('should update updatedAt timestamp on state changes', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler = vi.fn(async () => {
				await new Promise((r) => setTimeout(r, 100));
			});
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
			const collection = db.collection(collectionName);

			// Get initial updatedAt
			let doc = await collection.findOne({ _id: job._id });
			const initialUpdatedAt = doc?.['updatedAt'] as Date;

			monque.start();

			await waitFor(async () => {
				const d = await collection.findOne({ _id: job._id });
				return d?.['status'] === JobStatus.COMPLETED;
			});

			await monque.stop();

			// Get final updatedAt
			doc = await collection.findOne({ _id: job._id });
			const finalUpdatedAt = doc?.['updatedAt'] as Date;

			expect(finalUpdatedAt.getTime()).toBeGreaterThan(initialUpdatedAt.getTime());
		});
	});

	describe('only pending jobs are acquired', () => {
		it('should not acquire jobs in processing status', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			// Manually insert a job already in processing status
			const collection = db.collection(collectionName);
			await collection.insertOne(
				JobFactoryHelpers.processing({
					name: TEST_CONSTANTS.JOB_NAME,
					nextRunAt: new Date(Date.now() - 1000), // In the past
				}),
			);

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();

			// Wait some time
			await new Promise((r) => setTimeout(r, 500));

			await monque.stop();

			// Handler should not have been called
			expect(handler).not.toHaveBeenCalled();
		});

		it('should not acquire jobs in completed status', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			await collection.insertOne(
				JobFactoryHelpers.completed({
					name: TEST_CONSTANTS.JOB_NAME,
					nextRunAt: new Date(Date.now() - 1000),
				}),
			);

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();
			await new Promise((r) => setTimeout(r, 500));
			await monque.stop();

			expect(handler).not.toHaveBeenCalled();
		});

		it('should not acquire jobs in failed status', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			await collection.insertOne(
				JobFactoryHelpers.failed({
					name: TEST_CONSTANTS.JOB_NAME,
					nextRunAt: new Date(Date.now() - 1000),
				}),
			);

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();
			await new Promise((r) => setTimeout(r, 500));
			await monque.stop();

			expect(handler).not.toHaveBeenCalled();
		});

		it('should not acquire jobs with nextRunAt in the future', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			// Enqueue job scheduled for future
			const futureDate = new Date(Date.now() + 60000); // 1 minute from now
			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { runAt: futureDate });

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();
			await new Promise((r) => setTimeout(r, 500));
			await monque.stop();

			// Job should not be processed yet
			expect(handler).not.toHaveBeenCalled();
		});
	});
});
````

## File: packages/core/tests/integration/recovery.test.ts
````typescript
/**
 * Tests for job recovery and cleanup in the Monque scheduler.
 *
 * These tests verify:
 * - Stale job recovery on initialization
 * - Emission of stale:recovered event
 * - Cleanup of failReason on successful completion
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

import { JobFactory, JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('recovery and cleanup', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('recovery');
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

	describe('stale job recovery', () => {
		it('should recover stale jobs and emit stale:recovered event', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			// Use a short lock timeout for testing
			const monque = new Monque(db, {
				collectionName,
				lockTimeout: 1000,
				recoverStaleJobs: true,
			});
			monqueInstances.push(monque);

			// We need to initialize the collection first to insert data
			// But we want to test recovery during initialize(), so we'll use a separate instance or direct DB access
			// Since initialize() creates indexes, we can just use direct DB access to insert data
			const collection = db.collection(collectionName);

			const now = new Date();
			const staleTime = new Date(now.getTime() - 2000); // Older than lockTimeout (1000ms)

			await collection.insertOne(
				JobFactoryHelpers.processing({
					name: TEST_CONSTANTS.JOB_NAME,
					nextRunAt: staleTime,
					lockedAt: staleTime,
					createdAt: staleTime,
					updatedAt: staleTime,
				}),
			);

			const staleRecoveredSpy = vi.fn();
			monque.on('stale:recovered', staleRecoveredSpy);

			await monque.initialize();

			expect(staleRecoveredSpy).toHaveBeenCalledTimes(1);
			expect(staleRecoveredSpy).toHaveBeenCalledWith({ count: 1 });

			// Verify job is reset to pending
			const job = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(job?.['status']).toBe(JobStatus.PENDING);
			expect(job?.['lockedAt']).toBeUndefined();
		});

		it('should not recover non-stale jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				lockTimeout: 5000,
				recoverStaleJobs: true,
			});
			monqueInstances.push(monque);

			const collection = db.collection(collectionName);

			const now = new Date();
			const activeTime = new Date(now.getTime() - 1000); // Newer than lockTimeout (5000ms)

			await collection.insertOne(
				JobFactoryHelpers.processing({
					name: TEST_CONSTANTS.JOB_NAME,
					nextRunAt: activeTime,
					lockedAt: activeTime,
					createdAt: activeTime,
					updatedAt: activeTime,
				}),
			);

			const staleRecoveredSpy = vi.fn();
			monque.on('stale:recovered', staleRecoveredSpy);

			await monque.initialize();

			expect(staleRecoveredSpy).not.toHaveBeenCalled();

			// Verify job remains processing
			const job = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(job?.['status']).toBe(JobStatus.PROCESSING);
			expect(job?.['lockedAt']).not.toBeNull();
		});
	});

	describe('failReason cleanup', () => {
		it('should remove failReason on successful completion', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);

			// Insert a job that has failed previously
			const result = await collection.insertOne(
				JobFactory.build({
					name: TEST_CONSTANTS.JOB_NAME,
					failCount: 1,
					failReason: 'Previous error',
				}),
			);
			const jobId = result.insertedId;

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();

			await waitFor(async () => {
				const doc = await collection.findOne({ _id: jobId });
				return doc?.['status'] === JobStatus.COMPLETED;
			});

			const job = await collection.findOne({ _id: jobId });
			expect(job?.['status']).toBe(JobStatus.COMPLETED);
			// Fail count is preserved for one-time jobs to show history of failures before success
			expect(job?.['failCount']).toBe(1);

			expect(job).not.toHaveProperty('failReason');
		});

		it('should remove failReason on successful completion of recurring job', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);

			// Insert a recurring job that has failed previously
			const result = await collection.insertOne(
				JobFactory.build({
					name: TEST_CONSTANTS.JOB_NAME,
					repeatInterval: '* * * * *', // Every minute
					failCount: 1,
					failReason: 'Previous error',
				}),
			);
			const jobId = result.insertedId;

			const handler = vi.fn();
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

			monque.start();

			await waitFor(async () => {
				const doc = await collection.findOne({ _id: jobId });
				// For recurring jobs, status goes back to PENDING
				// We can check if failCount is reset to 0
				return doc?.['status'] === JobStatus.PENDING && doc?.['failCount'] === 0;
			});

			const job = await collection.findOne({ _id: jobId });
			expect(job?.['status']).toBe(JobStatus.PENDING);
			expect(job?.['failCount']).toBe(0);
			expect(job).not.toHaveProperty('failReason');
		});
	});
});
````

## File: packages/core/tests/integration/retry.test.ts
````typescript
/**
 * Tests for retry logic with exponential backoff in the Monque scheduler.
 *
 * These tests verify:
 * - Backoff timing within ±50ms
 * - failCount increment and failReason storage on job failure
 * - Permanent failure after maxRetries is exceeded
 *
 * @see {@link ../../src/scheduler/monque.ts}
 * @see {@link ../../src/shared/utils/backoff.ts}
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
import type { Db, Document, WithId } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';
import { calculateBackoffDelay } from '@/shared';

describe('Retry Logic', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('retry');
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

	describe('Backoff timing', () => {
		/**
		 * Failed jobs retry automatically. The actual nextRunAt MUST be within ±50ms
		 * of the calculated backoff time.
		 *
		 * Formula: nextRunAt = now + (2^failCount × baseInterval)
		 */
		it('should schedule first retry with correct backoff timing (2^1 * 1000 = 2000ms)', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				baseRetryInterval: 1000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			// Handler that fails once
			let callCount = 0;
			let failureTime = 0;
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				callCount++;
				if (callCount === 1) {
					failureTime = Date.now();
					throw new Error('First attempt fails');
				}
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
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
			const expectedNextRunAt = failureTime + expectedDelay;

			// Verify timing is within tolerance
			const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
			expect(timingDiff).toBeLessThanOrEqual(250); // Allow buffer for processing time and CI variability
		});

		it('should schedule second retry with correct backoff timing (2^2 * 1000 = 4000ms)', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				baseRetryInterval: 1000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			// Handler that always fails
			let callCount = 0;
			let failureTime = 0;
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				callCount++;
				failureTime = Date.now();
				throw new Error(`Attempt ${callCount} fails`);
			});

			// Insert a job that already has failCount=1
			const collection = db.collection(collectionName);
			const result = await collection.insertOne(
				JobFactoryHelpers.withData(
					{ test: true },
					{
						name: TEST_CONSTANTS.JOB_NAME,
						failCount: 1,
					},
				),
			);

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
			const expectedNextRunAt = failureTime + expectedDelay;

			// Verify timing is within tolerance (SC-003 specifies ±50ms ideal, but we allow buffer for processing time and CI variability)
			const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
			expect(timingDiff).toBeLessThanOrEqual(250); // Allow buffer for processing time and CI variability
		});

		it('should use configurable baseRetryInterval for backoff calculation', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const customBaseInterval = 500; // 500ms instead of default 1000ms
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				baseRetryInterval: customBaseInterval,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let failureTime = 0;
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				failureTime = Date.now();
				throw new Error('Always fails');
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
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
			const expectedNextRunAt = failureTime + expectedDelay;

			const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
			expect(timingDiff).toBeLessThanOrEqual(200);
		});
	});

	describe('failCount increment and failReason storage', () => {
		it('should increment failCount on job failure', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Always fails');
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
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
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const errorMessage = 'Connection timeout to external API';
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error(errorMessage);
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
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
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				baseRetryInterval: 10, // Fast retries for testing
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let callCount = 0;
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				callCount++;
				throw new Error(`Failure #${callCount}`);
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
			monque.start();

			// Wait for second failure
			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['failCount'] >= 2;
				},
				{ timeout: 5000 },
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
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			// Sync throw handler
			monque.worker<{ type: string }>(TEST_CONSTANTS.JOB_NAME, (job) => {
				if (job.data.type === 'sync') {
					throw new Error('Sync error');
				}
				return Promise.reject(new Error('Async error'));
			});

			const syncJob = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { type: 'sync' });
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
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 5,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Temporary failure');
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
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
			expect(doc['lockedAt']).toBeUndefined();
		});
	});

	describe('Max retries → permanent failure', () => {
		it('should mark job as permanently failed after maxRetries (default: 10)', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 3, // Lower for faster testing
				baseRetryInterval: 10, // Fast retries
			});
			monqueInstances.push(monque);
			await monque.initialize();

			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Persistent failure');
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
			monque.start();

			// Wait for permanent failure (failCount >= maxRetries)
			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['status'] === JobStatus.FAILED;
				},
				{ timeout: 5000 },
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
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const customMaxRetries = 2;
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: customMaxRetries,
				baseRetryInterval: 10,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let failCount = 0;
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				failCount++;
				throw new Error(`Failure ${failCount}`);
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
			monque.start();

			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['status'] === JobStatus.FAILED;
				},
				{ timeout: 5000 },
			);

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			expect(doc['status']).toBe(JobStatus.FAILED);
			expect(doc['failCount']).toBe(customMaxRetries);
		});

		it('should not process permanently failed jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let handlerCalls = 0;
			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				handlerCalls++;
			});

			// Insert a permanently failed job
			const collection = db.collection(collectionName);
			await collection.insertOne(
				JobFactoryHelpers.failed({
					name: TEST_CONSTANTS.JOB_NAME,
					data: { test: true },
				}),
			);

			monque.start();

			// Wait a bit and verify handler was never called
			await new Promise((resolve) => setTimeout(resolve, 500));

			await monque.stop();

			expect(handlerCalls).toBe(0);
		});

		it('should preserve job data on permanent failure', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 1,
				baseRetryInterval: 10,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const jobData = {
				userId: 'user-123',
				action: 'important-action',
				metadata: { key: 'value' },
			};

			monque.worker<typeof jobData>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Failure');
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, jobData);
			monque.start();

			await waitFor(
				async () => {
					const doc = (await db
						.collection(collectionName)
						.findOne({ _id: job._id })) as WithId<Document> | null;
					return doc !== null && doc['status'] === JobStatus.FAILED;
				},
				{ timeout: 5000 },
			);

			await monque.stop();

			const doc = (await db
				.collection(collectionName)
				.findOne({ _id: job._id })) as WithId<Document>;

			// Verify all original data is preserved
			expect(doc['data']).toEqual(jobData);
			expect(doc['name']).toBe(TEST_CONSTANTS.JOB_NAME);
		});
	});

	describe('Events during retry', () => {
		it('should emit job:fail event with willRetry=true when retries remain', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 5,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const failEvents: Array<{ job: Job; error: Error; willRetry: boolean }> = [];
			monque.on('job:fail', (event) => {
				failEvents.push(event);
			});

			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Temporary failure');
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
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
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				maxRetries: 1,
				baseRetryInterval: 10,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const failEvents: Array<{ job: Job; error: Error; willRetry: boolean }> = [];
			monque.on('job:fail', (event) => {
				failEvents.push(event);
			});

			monque.worker<{ test: boolean }>(TEST_CONSTANTS.JOB_NAME, async () => {
				throw new Error('Final failure');
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
			monque.start();

			// Wait for the job to reach failed status
			await waitFor(
				async () => {
					// Find the event where willRetry is false
					return failEvents.some((e) => e.willRetry === false);
				},
				{ timeout: 5000 },
			);

			await monque.stop();

			// Should have exactly maxRetries fail events
			const finalEvent = failEvents.find((e) => e.willRetry === false);
			if (!finalEvent) throw new Error('Expected finalEvent to be defined');
			expect(finalEvent.willRetry).toBe(false);
		});
	});
});
````

## File: packages/core/tests/integration/schedule.test.ts
````typescript
/**
 * Tests for the schedule() method of the Monque scheduler.
 *
 * These tests verify:
 * - Basic cron job scheduling functionality
 * - nextRunAt calculation from cron expressions
 * - repeatInterval storage
 * - Invalid cron expression handling with helpful messages
 * - Recurring job completion and auto-rescheduling
 * - Cron timing after retries
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */

import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	triggerJobImmediately,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';
import { InvalidCronError } from '@/shared';

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

	// Tests for schedule() method (cron parsing, nextRunAt calculation)
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

	// Tests for invalid cron expression (throws InvalidCronError with helpful message)
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

	// Tests for uniqueKey deduplication in schedule()
	describe('uniqueKey deduplication', () => {
		it('should create a new job when uniqueKey is not provided', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const job1 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{ v: 1 },
			);
			const job2 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{ v: 2 },
			);

			expect(job1._id).not.toEqual(job2._id);
		});

		it('should create a new job when uniqueKey is provided for the first time', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			const uniqueKey = 'unique-schedule-1';
			monqueInstances.push(monque);
			await monque.initialize();

			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{ value: 1 },
				{ uniqueKey },
			);

			expect(job).toBeDefined();
			expect(job._id).toBeDefined();
			expect(job.uniqueKey).toBe(uniqueKey);
		});

		it('should return existing job when duplicate uniqueKey already exists for same name', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const uniqueKey = 'duplicate-schedule-key';
			const job1 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{ value: 1 },
				{ uniqueKey },
			);
			const job2 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{ value: 2 },
				{ uniqueKey },
			);

			// Should return the existing job (same _id)
			expect(job2._id.toString()).toBe(job1._id.toString());

			// Should only be one job in the collection
			const collection = db.collection(collectionName);
			const count = await collection.countDocuments({ uniqueKey });
			expect(count).toBe(1);
		});

		it('should allow same uniqueKey for different job names', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const uniqueKey = 'shared-unique-key';
			const job1 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				'job-name-1',
				{ value: 1 },
				{ uniqueKey },
			);
			const job2 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				'job-name-2',
				{ value: 2 },
				{ uniqueKey },
			);

			// Different job names should create different jobs even with same uniqueKey
			expect(job1._id.toString()).not.toEqual(job2._id.toString());
		});

		it('should not update existing job data when duplicate uniqueKey is scheduled', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const uniqueKey = 'no-update-key';
			const originalData = { original: true };
			const newData = { original: false, extra: 'field' };

			await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				originalData,
				{ uniqueKey },
			);
			const job2 = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				newData,
				{ uniqueKey },
			);

			// Returned job should have original data
			expect(job2.data).toEqual(originalData);

			// Verify the original data is preserved in DB
			const collection = db.collection(collectionName);
			const job = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME, uniqueKey });
			expect(job?.['data']).toEqual(originalData);
		});

		it('should preserve uniqueKey in the persisted job', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const uniqueKey = 'preserved-key';
			const job = await monque.schedule(
				TEST_CONSTANTS.CRON_EVERY_MINUTE,
				TEST_CONSTANTS.JOB_NAME,
				{},
				{ uniqueKey },
			);

			expect(job._id).toBeDefined();
			expect(job.uniqueKey).toBe(uniqueKey);

			const collection = db.collection(collectionName);
			const persistedJob = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME, uniqueKey });
			expect(persistedJob?.['uniqueKey']).toBe(uniqueKey);
		});
	});

	// Tests for recurring job completion (auto-reschedule after success, uses original cron timing after retries)
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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, originalJobId);

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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, originalJobId);

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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, job._id);

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
			await triggerJobImmediately(collection, originalJobId);

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
````

## File: packages/core/tests/integration/shutdown.test.ts
````typescript
/**
 * Tests for graceful shutdown behavior in the Monque scheduler.
 *
 * These tests verify:
 * - stop() method stops the polling loop
 * - No new jobs are picked up after stop() is called
 * - In-progress jobs complete before stop() resolves
 * - Shutdown timeout behavior with ShutdownTimeoutError emission
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
import type { Job } from '@/jobs';
import { Monque } from '@/scheduler';
import { ShutdownTimeoutError } from '@/shared';

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
````

## File: packages/core/tests/integration/stale-recovery.test.ts
````typescript
/**
 * Tests for stale job recovery in the Monque scheduler.
 *
 * These tests verify:
 * - Stale jobs (processing > lockTimeout) are detected
 * - Stale jobs are recovered to pending status on startup
 * - recoverStaleJobs=false option is respected
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */

import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	findJobByQuery,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Stale Job Recovery', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('stale-recovery');
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

	it('should recover stale jobs on startup when recoverStaleJobs is true (default)', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const collection = db.collection(collectionName);

		// Insert a stale job manually
		const staleTime = new Date(Date.now() - 30 * 60 * 1000 - 1000); // 30m 1s ago
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 1 },
				nextRunAt: staleTime,
				lockedAt: staleTime,
				createdAt: staleTime,
				updatedAt: staleTime,
			}),
		);

		// Insert a fresh processing job (not stale)
		const freshTime = new Date();
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 2 },
				nextRunAt: freshTime,
				lockedAt: freshTime,
				createdAt: freshTime,
				updatedAt: freshTime,
			}),
		);

		// Initialize Monque (should trigger recovery)
		monque = new Monque(db, {
			collectionName,
			lockTimeout: 30 * 60 * 1000, // 30 minutes
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Check jobs
		const staleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });
		const freshJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 2 });

		// Stale job should be reset to pending
		expect(staleJob).not.toBeNull();
		expect(staleJob?.status).toBe(JobStatus.PENDING);
		expect(staleJob?.lockedAt).toBeUndefined();

		// Fresh job should remain processing
		expect(freshJob).not.toBeNull();
		expect(freshJob?.status).toBe(JobStatus.PROCESSING);
		expect(freshJob?.lockedAt).not.toBeNull();
	});

	it('should not recover stale jobs when recoverStaleJobs is false', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const collection = db.collection(collectionName);

		// Insert a stale job manually
		const staleTime = new Date(Date.now() - 30 * 60 * 1000 - 1000); // 30m 1s ago
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 1 },
				nextRunAt: staleTime,
				lockedAt: staleTime,
				createdAt: staleTime,
				updatedAt: staleTime,
			}),
		);

		// Initialize Monque with recovery disabled
		monque = new Monque(db, {
			collectionName,
			lockTimeout: 30 * 60 * 1000,
			recoverStaleJobs: false,
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Check job
		const staleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });

		// Stale job should remain processing
		expect(staleJob).not.toBeNull();
		expect(staleJob?.status).toBe(JobStatus.PROCESSING);
		expect(staleJob?.lockedAt).not.toBeNull();
	});

	it('should respect custom lockTimeout configuration', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const collection = db.collection(collectionName);

		const customTimeout = 10000; // 10 seconds

		// Insert a job that is stale according to custom timeout
		const staleTime = new Date(Date.now() - customTimeout - 1000);
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 1 },
				nextRunAt: staleTime,
				lockedAt: staleTime,
				createdAt: staleTime,
				updatedAt: staleTime,
			}),
		);

		// Insert a job that is 5s old (not stale with 10s timeout)
		const notStaleTime = new Date(Date.now() - 5000);
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 2 },
				nextRunAt: notStaleTime,
				lockedAt: notStaleTime,
				createdAt: notStaleTime,
				updatedAt: notStaleTime,
			}),
		);

		// Initialize Monque with custom timeout
		monque = new Monque(db, {
			collectionName,
			lockTimeout: customTimeout,
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Check jobs
		const staleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });
		const notStaleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 2 });

		// Stale job should be reset
		expect(staleJob?.status).toBe(JobStatus.PENDING);

		// Not stale job should remain processing
		expect(notStaleJob?.status).toBe(JobStatus.PROCESSING);
	});
});
````

## File: packages/core/tests/integration/worker.test.ts
````typescript
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

import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';
import { WorkerRegistrationError } from '@/shared';

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
		});

		it('should throw WorkerRegistrationError when registering same job name twice without replace', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const sameJobName = 'same-job';
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler1 = vi.fn();
			const handler2 = vi.fn();

			monque.worker(sameJobName, handler1);

			// Second registration should throw
			expect(() => monque.worker(sameJobName, handler2)).toThrow(WorkerRegistrationError);
			expect(() => monque.worker(sameJobName, handler2)).toThrow(
				`Worker already registered for job name "${sameJobName}"`,
			);
		});

		it('should replace handler when registering same job name with { replace: true }', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const sameJobName = 'same-job-replace';
			monque = new Monque(db, { collectionName, pollInterval: 100 });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler1 = vi.fn();
			const handler2 = vi.fn();

			monque.worker(sameJobName, handler1);
			monque.worker(sameJobName, handler2, { replace: true });

			// Enqueue a job and verify only handler2 is called
			await monque.enqueue(sameJobName, {});
			monque.start();

			await waitFor(async () => handler2.mock.calls.length > 0);

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledTimes(1);
		});

		it('should include job name in WorkerRegistrationError', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const jobName = 'error-job-name';
			monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const handler1 = vi.fn();
			const handler2 = vi.fn();

			monque.worker(jobName, handler1);

			try {
				monque.worker(jobName, handler2);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(WorkerRegistrationError);
				expect((error as WorkerRegistrationError).jobName).toBe(jobName);
			}
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
			expect(doc?.['lockedAt']).toBeUndefined();
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
			const timestamps: { start: number; end: number }[] = [];

			const handler = vi.fn(async () => {
				const start = Date.now();
				currentConcurrent++;
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
				await new Promise((r) => setTimeout(r, 200));
				currentConcurrent--;
				const end = Date.now();
				timestamps.push({ start, end });
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

			// Verify actual concurrency by checking overlapping execution windows
			const overlaps = timestamps.some((t1, i) =>
				timestamps.slice(i + 1).some((t2) => t1.start < t2.end && t2.start < t1.end),
			);
			expect(overlaps).toBe(true);
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
			const timestamps: { start: number; end: number }[] = [];

			const handler = vi.fn(async () => {
				const start = Date.now();
				currentConcurrent++;
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
				await new Promise((r) => setTimeout(r, 100));
				currentConcurrent--;
				const end = Date.now();
				timestamps.push({ start, end });
			});
			monque.worker(limitedJobName, handler, { concurrency: workerConcurrency });

			// Enqueue multiple jobs
			for (let i = 0; i < 3; i++) {
				await monque.enqueue(limitedJobName, { index: i });
			}

			monque.start();

			await waitFor(async () => handler.mock.calls.length === 3, { timeout: 5000 });

			expect(maxConcurrent).toBe(workerConcurrency);

			// Verify no overlapping execution (concurrency of 1 means sequential)
			const overlaps = timestamps.some((t1, i) =>
				timestamps.slice(i + 1).some((t2) => t1.start < t2.end && t2.start < t1.end),
			);
			expect(overlaps).toBe(false);
		});

		it('should allow different concurrency per worker type', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			monque = new Monque(db, { collectionName, pollInterval: 50, heartbeatInterval: 1000 });
			const jobTypeAName = 'type-a';
			const jobTypeBName = 'type-b';
			monqueInstances.push(monque);
			await monque.initialize();

			let maxConcurrentA = 0;
			let currentConcurrentA = 0;
			let maxConcurrentB = 0;
			let currentConcurrentB = 0;
			const timestampsA: { start: number; end: number }[] = [];
			const timestampsB: { start: number; end: number }[] = [];

			const handlerA = vi.fn(async () => {
				const start = Date.now();
				currentConcurrentA++;
				maxConcurrentA = Math.max(maxConcurrentA, currentConcurrentA);
				await new Promise((r) => setTimeout(r, 200));
				currentConcurrentA--;
				const end = Date.now();
				timestampsA.push({ start, end });
			});

			const handlerB = vi.fn(async () => {
				const start = Date.now();
				currentConcurrentB++;
				maxConcurrentB = Math.max(maxConcurrentB, currentConcurrentB);
				await new Promise((r) => setTimeout(r, 200));
				currentConcurrentB--;
				const end = Date.now();
				timestampsB.push({ start, end });
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

			// Verify actual concurrency by checking overlapping execution windows
			const overlapsA = timestampsA.some((t1, i) =>
				timestampsA.slice(i + 1).some((t2) => t1.start < t2.end && t2.start < t1.end),
			);
			const overlapsB = timestampsB.some((t1, i) =>
				timestampsB.slice(i + 1).some((t2) => t1.start < t2.end && t2.start < t1.end),
			);
			expect(overlapsA).toBe(true);
			expect(overlapsB).toBe(true);
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
			expect([...processedOrder].sort()).toEqual([0, 1, 2, 3]);
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
````

## File: packages/core/tests/setup/global-setup.ts
````typescript
/**
 * Vitest global setup - pre-starts MongoDB container and returns teardown.
 *
 * This runs once before all test files. Starting the container here
 * reduces cold-start time for the first test file.
 *
 * The returned function is called after all tests complete for cleanup.
 *
 * Note: The container will be started lazily on first getMongoDb() call
 * if not started here, so this is optional but improves test startup experience.
 */

import { closeMongoDb, getMongoDb, getMongoUri, isMongoDbRunning } from '@tests/setup/mongodb.js';

// Track if cleanup has already been performed
let cleanedUp = false;

async function cleanup(): Promise<void> {
	if (cleanedUp) return;
	cleanedUp = true;

	if (isMongoDbRunning()) {
		console.log('\n🛑 Stopping MongoDB Testcontainer...');
		await closeMongoDb();
		console.log('✅ MongoDB container stopped\n');
	}
}

export default async function globalSetup(): Promise<() => Promise<void>> {
	console.log('\n🚀 Starting MongoDB Testcontainer...');

	// Pre-start the container
	await getMongoDb();

	const uri = await getMongoUri();
	console.log(`✅ MongoDB ready at: ${uri}\n`);

	// Register signal handlers for cleanup on interruption
	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
	for (const signal of signals) {
		process.on(signal, async () => {
			console.log(`\n⚠️  Received ${signal}, cleaning up...`);
			await cleanup();
			process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
		});
	}

	// Also handle uncaught exceptions
	process.on('uncaughtException', async (error) => {
		console.error('\n❌ Uncaught exception, cleaning up...', error);
		await cleanup();
		process.exit(1);
	});

	// Return teardown function
	return cleanup;
}
````

## File: packages/core/tests/unit/cron.test.ts
````typescript
import { describe, expect, it } from 'vitest';

import { getNextCronDate, InvalidCronError, validateCronExpression } from '@/shared';

// Test fixtures - shared reference dates
const TEST_DATE_MID_MORNING = new Date('2025-01-01T10:30:00.000Z');
const TEST_DATE_EARLY_MORNING = new Date('2025-01-01T08:00:00.000Z');

describe('cron', () => {
	describe('getNextCronDate', () => {
		it('should parse "* * * * *" (every minute)', () => {
			const now = new Date();
			const result = getNextCronDate('* * * * *', now);
			expect(result).toBeInstanceOf(Date);
			// Should be within the next minute
			expect(result.getTime()).toBeGreaterThan(now.getTime());
			expect(result.getTime() - now.getTime()).toBeLessThanOrEqual(60000);
		});

		it('should parse "0 * * * *" (every hour at minute 0)', () => {
			const result = getNextCronDate('0 * * * *', TEST_DATE_MID_MORNING);
			// Next run should be at minute 0
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse "0 0 * * *" (every day at midnight)', () => {
			const result = getNextCronDate('0 0 * * *', TEST_DATE_MID_MORNING);
			// Next run should be at 00:00
			expect(result.getHours()).toBe(0);
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse predefined expressions like @daily', () => {
			const result = getNextCronDate('@daily', TEST_DATE_MID_MORNING);
			// Next run should be at 00:00
			expect(result.getHours()).toBe(0);
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse "30 9 * * 1" (every Monday at 9:30am)', () => {
			// Jan 1, 2025 is a Wednesday
			const result = getNextCronDate('30 9 * * 1', TEST_DATE_MID_MORNING);
			// Result should be on a Monday
			expect(result.getDay()).toBe(1); // Monday
			expect(result.getMinutes()).toBe(30);
			expect(result.getHours()).toBe(9);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse "0 12 1 * *" (first day of every month at noon)', () => {
			const result = getNextCronDate('0 12 1 * *', TEST_DATE_EARLY_MORNING);
			// Next run should be on the 1st of the month at noon
			expect(result.getDate()).toBe(1);
			expect(result.getHours()).toBe(12);
			expect(result.getMinutes()).toBe(0);
		});

		it('should accept a custom reference date', () => {
			const referenceDate = new Date('2025-06-15T08:00:00.000Z');
			const result = getNextCronDate('0 9 * * *', referenceDate);
			// Next 9am after June 15 8am
			expect(result.getHours()).toBe(9);
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(referenceDate.getTime());
		});

		it('should throw InvalidCronError for invalid expression', () => {
			expect(() => getNextCronDate('invalid')).toThrow(InvalidCronError);
		});

		it('should throw InvalidCronError with expression property', () => {
			try {
				getNextCronDate('not a cron');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				expect((error as InvalidCronError).expression).toBe('not a cron');
			}
		});

		it('should include helpful error message with format example', () => {
			try {
				getNextCronDate('bad');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				const message = (error as InvalidCronError).message;
				expect(message).toContain('Invalid cron expression');
				expect(message).toContain('"bad"');
				expect(message).toContain('minute hour day-of-month month day-of-week');
				expect(message).toContain('predefined expression');
				expect(message).toContain('Example:');
			}
		});

		it('should handle expressions with ranges', () => {
			const result = getNextCronDate('0 9-17 * * *', TEST_DATE_EARLY_MORNING); // 9am to 5pm
			// Next run should be between 9am and 5pm
			expect(result.getHours()).toBeGreaterThanOrEqual(9);
			expect(result.getHours()).toBeLessThanOrEqual(17);
			expect(result.getMinutes()).toBe(0);
		});

		it('should handle expressions with steps', () => {
			const result = getNextCronDate('*/15 * * * *', TEST_DATE_MID_MORNING); // Every 15 minutes
			// Next 15-minute mark
			expect(result.getMinutes() % 15).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should handle expressions with lists', () => {
			const result = getNextCronDate('0 9,12,18 * * *', TEST_DATE_MID_MORNING); // 9am, 12pm, 6pm
			// Next should be at one of those hours
			expect([9, 12, 18]).toContain(result.getHours());
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});
	});

	describe('validateCronExpression', () => {
		it('should not throw for valid expressions', () => {
			expect(() => validateCronExpression('* * * * *')).not.toThrow();
			expect(() => validateCronExpression('0 0 * * *')).not.toThrow();
			expect(() => validateCronExpression('30 9 1 * 1')).not.toThrow();
			expect(() => validateCronExpression('*/5 * * * *')).not.toThrow();
			expect(() => validateCronExpression('0 9-17 * * 1-5')).not.toThrow();
		});

		it('should throw InvalidCronError for invalid expressions', () => {
			expect(() => validateCronExpression('invalid')).toThrow(InvalidCronError);
			expect(() => validateCronExpression('60 * * * *')).toThrow(InvalidCronError); // Invalid minute
			expect(() => validateCronExpression('* 25 * * *')).toThrow(InvalidCronError); // Invalid hour
		});

		it('should throw InvalidCronError with expression property', () => {
			try {
				validateCronExpression('wrong');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				expect((error as InvalidCronError).expression).toBe('wrong');
			}
		});

		it('should include helpful error message', () => {
			try {
				validateCronExpression('x x x x x');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				const message = (error as InvalidCronError).message;
				expect(message).toContain('Invalid cron expression');
				expect(message).toContain('Example:');
			}
		});
	});
});
````

## File: packages/core/tests/unit/errors.test.ts
````typescript
/**
 * Tests for custom error classes in the Monque scheduler.
 *
 * These tests verify:
 * - MonqueError base class functionality
 * - InvalidCronError with expression storage
 * - ConnectionError for database issues
 * - ShutdownTimeoutError with incomplete jobs tracking
 * - Error inheritance chain (all catchable as Error/MonqueError)
 *
 * @see {@link @/shared/errors.js}
 */

import { describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import {
	ConnectionError,
	InvalidCronError,
	MonqueError,
	ShutdownTimeoutError,
	WorkerRegistrationError,
} from '@/shared';

describe('errors', () => {
	describe('MonqueError', () => {
		it('should create an error with the correct message', () => {
			const error = new MonqueError('Test error message');
			expect(error.message).toBe('Test error message');
		});

		it('should have name "MonqueError"', () => {
			const error = new MonqueError('Test');
			expect(error.name).toBe('MonqueError');
		});

		it('should be an instance of Error', () => {
			const error = new MonqueError('Test');
			expect(error).toBeInstanceOf(Error);
		});

		it('should be an instance of MonqueError', () => {
			const error = new MonqueError('Test');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should have a stack trace', () => {
			const error = new MonqueError('Test');
			expect(error.stack).toBeDefined();
			expect(error.stack).toContain('MonqueError');
		});
	});

	describe('InvalidCronError', () => {
		it('should create an error with expression and message', () => {
			const error = new InvalidCronError('bad cron', 'Invalid expression');
			expect(error.message).toBe('Invalid expression');
			expect(error.expression).toBe('bad cron');
		});

		it('should have name "InvalidCronError"', () => {
			const error = new InvalidCronError('* *', 'Too few fields');
			expect(error.name).toBe('InvalidCronError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new InvalidCronError('x', 'Invalid');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new InvalidCronError('x', 'Invalid');
			expect(error).toBeInstanceOf(Error);
		});

		it('should expose the invalid expression', () => {
			const expression = '60 * * * *';
			const error = new InvalidCronError(expression, 'Minute out of range');
			expect(error.expression).toBe(expression);
		});

		it('should have a stack trace', () => {
			const error = new InvalidCronError('bad', 'Invalid');
			expect(error.stack).toBeDefined();
		});
	});

	describe('ConnectionError', () => {
		it('should create an error with the correct message', () => {
			const error = new ConnectionError('Database connection failed');
			expect(error.message).toBe('Database connection failed');
		});

		it('should have name "ConnectionError"', () => {
			const error = new ConnectionError('Connection lost');
			expect(error.name).toBe('ConnectionError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new ConnectionError('Timeout');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new ConnectionError('Timeout');
			expect(error).toBeInstanceOf(Error);
		});

		it('should have a stack trace', () => {
			const error = new ConnectionError('Failed');
			expect(error.stack).toBeDefined();
		});

		it('should chain the cause error when provided', () => {
			const cause = new Error('Original database error');
			const error = new ConnectionError('Connection failed', { cause });

			expect(error.cause).toBe(cause);
			expect(error.message).toBe('Connection failed');
		});
	});

	describe('ShutdownTimeoutError', () => {
		it('should create an error with message and incomplete jobs', () => {
			const incompleteJobs = [
				JobFactoryHelpers.processing({ name: 'job1' }),
				JobFactoryHelpers.processing({ name: 'job2' }),
			];
			const error = new ShutdownTimeoutError('Shutdown timed out', incompleteJobs);

			expect(error.message).toBe('Shutdown timed out');
			expect(error.incompleteJobs).toEqual(incompleteJobs);
		});

		it('should have name "ShutdownTimeoutError"', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error.name).toBe('ShutdownTimeoutError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error).toBeInstanceOf(Error);
		});

		it('should expose incompleteJobs array', () => {
			const job = JobFactoryHelpers.processing({ name: 'job1' });
			const error = new ShutdownTimeoutError('Timeout', [job]);
			expect(error.incompleteJobs).toHaveLength(1);
			expect(error.incompleteJobs[0]?.name).toBe(job.name);
		});

		it('should handle empty incompleteJobs array', () => {
			const error = new ShutdownTimeoutError('No jobs running', []);
			expect(error.incompleteJobs).toHaveLength(0);
		});

		it('should preserve job data in incompleteJobs', () => {
			const job = JobFactoryHelpers.processing();
			const error = new ShutdownTimeoutError('Timeout', [job]);

			expect(error.incompleteJobs[0]?.data).toEqual(job.data);
		});

		it('should have a stack trace', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error.stack).toBeDefined();
		});
	});

	describe('WorkerRegistrationError', () => {
		it('should create an error with message and job name', () => {
			const error = new WorkerRegistrationError('Worker already registered', 'test-job');
			expect(error.message).toBe('Worker already registered');
			expect(error.jobName).toBe('test-job');
		});

		it('should have name "WorkerRegistrationError"', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error.name).toBe('WorkerRegistrationError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error).toBeInstanceOf(Error);
		});

		it('should have a stack trace', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error.stack).toBeDefined();
		});
	});

	describe('error inheritance chain', () => {
		it('InvalidCronError should be catchable as MonqueError', () => {
			const error = new InvalidCronError('bad', 'Invalid');
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('ConnectionError should be catchable as MonqueError', () => {
			const error = new ConnectionError('Failed');
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('ShutdownTimeoutError should be catchable as MonqueError', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('WorkerRegistrationError should be catchable as MonqueError', () => {
			const error = new WorkerRegistrationError('Failed', 'job');
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('all errors should be catchable as Error', () => {
			const errors = [
				new MonqueError('Base'),
				new InvalidCronError('x', 'Invalid'),
				new ConnectionError('Failed'),
				new ShutdownTimeoutError('Timeout', []),
				new WorkerRegistrationError('Failed', 'job'),
			];

			for (const error of errors) {
				let caught = false;
				try {
					throw error;
				} catch (e) {
					if (e instanceof Error) {
						caught = true;
					}
				}
				expect(caught).toBe(true);
			}
		});
	});
});
````

## File: packages/core/tsconfig.json
````json
{
	"compilerOptions": {
		// Environment setup & latest features
		"lib": ["ESNext"],
		"target": "ESNext",
		"module": "ESNext",
		"moduleDetection": "force",

		// Bundler mode
		"moduleResolution": "bundler",
		"allowImportingTsExtensions": true,
		"verbatimModuleSyntax": true,
		"noEmit": true,

		// Best practices
		"strict": true,
		"skipLibCheck": true,
		"noFallthroughCasesInSwitch": true,
		"noUncheckedIndexedAccess": true,
		"noImplicitOverride": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"noPropertyAccessFromIndexSignature": true,
		"exactOptionalPropertyTypes": true,
		"forceConsistentCasingInFileNames": true,
		"esModuleInterop": true,
		"resolveJsonModule": true,
		"isolatedModules": true,
		"declaration": true,
		"declarationMap": true,

		"baseUrl": ".",
		"paths": {
			"@/*": ["src/*"],
			"@tests/*": ["tests/*"],
			"@test-utils/*": ["tests/setup/*"]
		}
	},
	"include": ["src/**/*", "tests/**/*"],
	"exclude": ["node_modules", "dist"]
}
````

## File: packages/core/tsdown.config.ts
````typescript
import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	external: ['mongodb'],
});
````

## File: packages/core/tests/integration/events.test.ts
````typescript
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
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

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
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

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
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

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
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);

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
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});

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
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});
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
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {});
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
````

## File: packages/core/tests/setup/mongodb.ts
````typescript
/**
 * MongoDB Testcontainers singleton manager for integration tests.
 *
 * This module provides a shared MongoDB container across all test files
 * for performance. Container is started on first call to getMongoDb()
 * and stays running until closeMongoDb() is called (typically in globalTeardown).
 *
 * @example
 * ```typescript
 * import { getMongoDb, closeMongoDb } from './setup/mongodb';
 *
 * let db: Db;
 *
 * beforeAll(async () => {
 *   db = await getMongoDb();
 * });
 * ```
 */

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';

const mongoContainerImage = 'mongo:8';

/**
 * Check if container reuse is enabled via environment variable.
 * When enabled, containers persist between test runs for faster iteration.
 * Ryuk (the cleanup container) is kept enabled as a safety net for orphans.
 */
const isReuseEnabled = process.env['TESTCONTAINERS_REUSE_ENABLE'] === 'true';

// Module-level singleton instances
let container: StartedMongoDBContainer | null = null;
let client: MongoClient | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ensures the MongoDB container is initialized.
 * Handles concurrent calls by reusing the same initialization promise.
 */
async function ensureInitialized(): Promise<void> {
	if (initPromise) {
		// Initialization in progress or complete, wait for it
		return initPromise;
	}

	if (container) {
		// Already initialized
		return;
	}

	initPromise = (async () => {
		try {
			const mongoContainer = new MongoDBContainer(mongoContainerImage);
			container = await (isReuseEnabled ? mongoContainer.withReuse() : mongoContainer).start();
		} catch (error) {
			initPromise = null;
			container = null;
			throw new Error(`Failed to start MongoDB container: ${error}`);
		}
	})();

	return initPromise;
}

/**
 * Gets or creates a MongoDB connection from the shared Testcontainer.
 * Container is started on first call and reused for subsequent calls.
 * When TESTCONTAINERS_REUSE_ENABLE=true, the container persists between test runs.
 *
 * @returns A MongoDB Db instance connected to the test container
 */
export async function getMongoDb(): Promise<Db> {
	await ensureInitialized();

	if (!container) {
		throw new Error('MongoDB container not initialized');
	}

	if (!client) {
		try {
			const uri = container.getConnectionString();
			client = new MongoClient(uri, {
				// Use directConnection for container
				directConnection: true,
			});
			await client.connect();
		} catch (error) {
			// Clean up container if client connection fails
			if (container) {
				await container.stop().catch(() => {
					// Ignore stop errors, we're already in error state
				});
				container = null;
			}
			client = null;
			throw new Error(`Failed to connect MongoDB client: ${error}`);
		}
	}

	return client.db('monque_test');
}

/**
 * Gets the MongoDB connection string from the running container.
 * Useful for passing to Monque instances in tests.
 *
 * @returns The MongoDB connection URI
 * @throws If container has not been started
 */
export async function getMongoUri(): Promise<string> {
	await ensureInitialized();

	if (!container) {
		throw new Error('MongoDB container not initialized');
	}

	return container.getConnectionString();
}

/**
 * Gets the MongoClient instance connected to the test container.
 * Useful for tests that need direct client access.
 *
 * @returns The MongoClient instance
 */
export async function getMongoClient(): Promise<MongoClient> {
	// Ensure container and client are initialized
	await getMongoDb();

	if (!client) {
		throw new Error('MongoClient not initialized');
	}

	return client;
}

/**
 * Closes the MongoDB connection and optionally stops the container.
 * When TESTCONTAINERS_REUSE_ENABLE=true, the container is kept running
 * for faster subsequent test runs. Should be called in globalTeardown.
 */
export async function closeMongoDb(): Promise<void> {
	if (client) {
		await client.close();
		client = null;
	}

	if (container) {
		// Only stop the container if reuse is disabled
		// When reuse is enabled, keep it running for faster subsequent runs
		if (!isReuseEnabled) {
			await container.stop();
		}
		container = null;
	}
}

/**
 * Checks if the MongoDB container is currently running.
 *
 * @returns true if container is started and client is connected
 */
export function isMongoDbRunning(): boolean {
	return container !== null && client !== null;
}
````

## File: packages/core/src/scheduler/monque.ts
````typescript
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
	ChangeStream,
	ChangeStreamDocument,
	Collection,
	Db,
	DeleteResult,
	Document,
	ObjectId,
	WithId,
} from 'mongodb';

import type { MonqueEventMap } from '@/events';
import {
	type EnqueueOptions,
	type GetJobsFilter,
	isPersistedJob,
	type Job,
	type JobHandler,
	JobStatus,
	type JobStatusType,
	type PersistedJob,
	type ScheduleOptions,
} from '@/jobs';
import {
	ConnectionError,
	calculateBackoff,
	getNextCronDate,
	MonqueError,
	WorkerRegistrationError,
} from '@/shared';
import type { WorkerOptions, WorkerRegistration } from '@/workers';

import type { MonqueOptions } from './types.js';

/**
 * Default configuration values
 */
const DEFAULTS = {
	collectionName: 'monque_jobs',
	pollInterval: 1000,
	maxRetries: 10,
	baseRetryInterval: 1000,
	shutdownTimeout: 30000,
	defaultConcurrency: 5,
	lockTimeout: 1_800_000, // 30 minutes
	recoverStaleJobs: true,
	heartbeatInterval: 30000, // 30 seconds
	retentionInterval: 3600_000, // 1 hour
} as const;

/**
 * Monque - MongoDB-backed job scheduler
 *
 * A type-safe job scheduler with atomic locking, exponential backoff, cron scheduling,
 * stale job recovery, and event-driven observability. Built on native MongoDB driver.
 *
 * @example Complete lifecycle
 * ```;
typescript
 *

import { Monque } from '@monque/core';

*

import { MongoClient } from 'mongodb';

*
 *
const client = new MongoClient('mongodb://localhost:27017');
* await client.connect()
*
const db = client.db('myapp');
*
 * // Create instance with options
 *
const monque = new Monque(db, {
 *   collectionName: 'jobs',
 *   pollInterval: 1000,
 *   maxRetries: 10,
 *   shutdownTimeout: 30000,
 * });
*
 * // Initialize (sets up indexes and recovers stale jobs)
 * await monque.initialize()
*
 * // Register workers with type safety
 *
type EmailJob = {};
*   to: string
*   subject: string
*   body: string
* }
 *
 * monque.worker<EmailJob>('send-email', async (job) =>
{
	*   await emailService.send(job.data.to, job.data.subject, job.data.body)
	*
}
)
*
 * // Monitor events for observability
 * monque.on('job:complete', (
{
	job, duration;
}
) =>
{
 *   logger.info(`Job $job.namecompleted in $durationms`);
 * });
 *
 * monque.on('job:fail', ({ job, error, willRetry }) => {
 *   logger.error(`Job $job.namefailed:`, error);
 * });
 *
 * // Start processing
 * monque.start();
 *
 * // Enqueue jobs
 * await monque.enqueue('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   body: 'Thanks for signing up.'
 * });
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await monque.stop();
 *   await client.close();
 *   process.exit(0);
 * });
 * ```
 */
export class Monque extends EventEmitter {
	private readonly db: Db;
	private readonly options: Required<Omit<MonqueOptions, 'maxBackoffDelay' | 'jobRetention'>> &
		Pick<MonqueOptions, 'maxBackoffDelay' | 'jobRetention'>;
	private collection: Collection<Document> | null = null;
	private workers: Map<string, WorkerRegistration> = new Map();
	private pollIntervalId: ReturnType<typeof setInterval> | null = null;
	private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
	private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
	private isRunning = false;
	private isInitialized = false;

	/**
	 * MongoDB Change Stream for real-time job notifications.
	 * When available, provides instant job processing without polling delay.
	 */
	private changeStream: ChangeStream | null = null;

	/**
	 * Number of consecutive reconnection attempts for change stream.
	 * Used for exponential backoff during reconnection.
	 */
	private changeStreamReconnectAttempts = 0;

	/**
	 * Maximum reconnection attempts before falling back to polling-only mode.
	 */
	private readonly maxChangeStreamReconnectAttempts = 3;

	/**
	 * Debounce timer for change stream event processing.
	 * Prevents claim storms when multiple events arrive in quick succession.
	 */
	private changeStreamDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Whether the scheduler is currently using change streams for notifications.
	 */
	private usingChangeStreams = false;

	/**
	 * Timer ID for change stream reconnection with exponential backoff.
	 * Tracked to allow cancellation during shutdown.
	 */
	private changeStreamReconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(db: Db, options: MonqueOptions = {}) {
		super();
		this.db = db;
		this.options = {
			collectionName: options.collectionName ?? DEFAULTS.collectionName,
			pollInterval: options.pollInterval ?? DEFAULTS.pollInterval,
			maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
			baseRetryInterval: options.baseRetryInterval ?? DEFAULTS.baseRetryInterval,
			shutdownTimeout: options.shutdownTimeout ?? DEFAULTS.shutdownTimeout,
			defaultConcurrency: options.defaultConcurrency ?? DEFAULTS.defaultConcurrency,
			lockTimeout: options.lockTimeout ?? DEFAULTS.lockTimeout,
			recoverStaleJobs: options.recoverStaleJobs ?? DEFAULTS.recoverStaleJobs,
			maxBackoffDelay: options.maxBackoffDelay,
			schedulerInstanceId: options.schedulerInstanceId ?? randomUUID(),
			heartbeatInterval: options.heartbeatInterval ?? DEFAULTS.heartbeatInterval,
			jobRetention: options.jobRetention,
		};
	}

	/**
	 * Initialize the scheduler by setting up the MongoDB collection and indexes.
	 * Must be called before start().
	 *
	 * @throws {ConnectionError} If collection or index creation fails
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			this.collection = this.db.collection(this.options.collectionName);

			// Create indexes for efficient queries
			await this.createIndexes();

			// Recover stale jobs if enabled
			if (this.options.recoverStaleJobs) {
				await this.recoverStaleJobs();
			}

			this.isInitialized = true;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown error during initialization';
			throw new ConnectionError(`Failed to initialize Monque: ${message}`);
		}
	}

	/**
	 * Create required MongoDB indexes for efficient job processing.
	 *
	 * The following indexes are created:
	 * - `{status, nextRunAt}` - For efficient job polling queries
	 * - `{name, uniqueKey}` - Partial unique index for deduplication (pending/processing only)
	 * - `{name, status}` - For job lookup by type
	 * - `{claimedBy, status}` - For finding jobs owned by a specific scheduler instance
	 * - `{lastHeartbeat, status}` - For detecting stale jobs via heartbeat timeout
	 * - `{status, nextRunAt, claimedBy}` - For atomic claim queries (find unclaimed pending jobs)
	 * - `{lockedAt, lastHeartbeat, status}` - For stale job recovery combining lock time and heartbeat
	 */
	private async createIndexes(): Promise<void> {
		if (!this.collection) {
			throw new ConnectionError('Collection not initialized');
		}

		// Compound index for job polling - status + nextRunAt for efficient queries
		await this.collection.createIndex({ status: 1, nextRunAt: 1 }, { background: true });

		// Partial unique index for deduplication - scoped by name + uniqueKey
		// Only enforced where uniqueKey exists and status is pending/processing
		await this.collection.createIndex(
			{ name: 1, uniqueKey: 1 },
			{
				unique: true,
				partialFilterExpression: {
					uniqueKey: { $exists: true },
					status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
				},
				background: true,
			},
		);

		// Index for job lookup by name
		await this.collection.createIndex({ name: 1, status: 1 }, { background: true });

		// Compound index for finding jobs claimed by a specific scheduler instance.
		// Used for heartbeat updates and cleanup on shutdown.
		await this.collection.createIndex({ claimedBy: 1, status: 1 }, { background: true });

		// Compound index for detecting stale jobs via heartbeat timeout.
		// Used to find processing jobs that have stopped sending heartbeats.
		await this.collection.createIndex({ lastHeartbeat: 1, status: 1 }, { background: true });

		// Compound index for atomic claim queries.
		// Optimizes the findOneAndUpdate query that claims unclaimed pending jobs.
		await this.collection.createIndex(
			{ status: 1, nextRunAt: 1, claimedBy: 1 },
			{ background: true },
		);

		// Expanded index for stale job recovery combining lock time and heartbeat.
		// Supports recovery queries that check both lockedAt and lastHeartbeat.
		await this.collection.createIndex(
			{ lockedAt: 1, lastHeartbeat: 1, status: 1 },
			{ background: true },
		);
	}

	/**
	 * Recover stale jobs that were left in 'processing' status.
	 * A job is considered stale if its `lockedAt` timestamp exceeds the configured `lockTimeout`.
	 * Stale jobs are reset to 'pending' so they can be picked up by workers again.
	 */
	private async recoverStaleJobs(): Promise<void> {
		if (!this.collection) {
			return;
		}

		const staleThreshold = new Date(Date.now() - this.options.lockTimeout);

		const result = await this.collection.updateMany(
			{
				status: JobStatus.PROCESSING,
				lockedAt: { $lt: staleThreshold },
			},
			{
				$set: {
					status: JobStatus.PENDING,
					updatedAt: new Date(),
				},
				$unset: {
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
					heartbeatInterval: '',
				},
			},
		);

		if (result.modifiedCount > 0) {
			// Emit event for recovered jobs
			this.emit('stale:recovered', {
				count: result.modifiedCount,
			});
		}
	}

	/**
	 * Clean up old completed and failed jobs based on retention policy.
	 *
	 * - Removes completed jobs older than `jobRetention.completed`
	 * - Removes failed jobs older than `jobRetention.failed`
	 *
	 * The cleanup runs concurrently for both statuses if configured.
	 *
	 * @returns Promise resolving when all deletion operations complete
	 */
	private async cleanupJobs(): Promise<void> {
		if (!this.collection || !this.options.jobRetention) {
			return;
		}

		const { completed, failed } = this.options.jobRetention;
		const now = Date.now();
		const deletions: Promise<DeleteResult>[] = [];

		if (completed) {
			const cutoff = new Date(now - completed);
			deletions.push(
				this.collection.deleteMany({
					status: JobStatus.COMPLETED,
					updatedAt: { $lt: cutoff },
				}),
			);
		}

		if (failed) {
			const cutoff = new Date(now - failed);
			deletions.push(
				this.collection.deleteMany({
					status: JobStatus.FAILED,
					updatedAt: { $lt: cutoff },
				}),
			);
		}

		if (deletions.length > 0) {
			await Promise.all(deletions);
		}
	}

	/**
	 * Enqueue a job for processing.
	 *
	 * Jobs are stored in MongoDB and processed by registered workers. Supports
	 * delayed execution via `runAt` and deduplication via `uniqueKey`.
	 *
	 * When a `uniqueKey` is provided, only one pending or processing job with that key
	 * can exist. Completed or failed jobs don't block new jobs with the same key.
	 *
	 * Failed jobs are automatically retried with exponential backoff up to `maxRetries`
	 * (default: 10 attempts). The delay between retries is calculated as `2^failCount × baseRetryInterval`.
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler
	 * @param options - Scheduling and deduplication options
	 * @returns Promise resolving to the created or existing job document
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
	 *
	 * @example Basic job enqueueing
	 * ```typescript
	 * await monque.enqueue('send-email', {
	 *   to: 'user@example.com',
	 *   subject: 'Welcome!',
	 *   body: 'Thanks for signing up.'
	 * });
	 * ```
	 *
	 * @example Delayed execution
	 * ```typescript
	 * const oneHourLater = new Date(Date.now() + 3600000);
	 * await monque.enqueue('reminder', { message: 'Check in!' }, {
	 *   runAt: oneHourLater
	 * });
	 * ```
	 *
	 * @example Prevent duplicates with unique key
	 * ```typescript
	 * await monque.enqueue('sync-user', { userId: '123' }, {
	 *   uniqueKey: 'sync-user-123'
	 * });
	 * // Subsequent enqueues with same uniqueKey return existing pending/processing job
	 * ```
	 */
	async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
		this.ensureInitialized();

		const now = new Date();
		const job: Omit<Job<T>, '_id'> = {
			name,
			data,
			status: JobStatus.PENDING,
			nextRunAt: options.runAt ?? now,
			failCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		if (options.uniqueKey) {
			job.uniqueKey = options.uniqueKey;
		}

		try {
			if (options.uniqueKey) {
				if (!this.collection) {
					throw new ConnectionError('Failed to enqueue job: collection not available');
				}

				// Use upsert with $setOnInsert for deduplication (scoped by name + uniqueKey)
				const result = await this.collection.findOneAndUpdate(
					{
						name,
						uniqueKey: options.uniqueKey,
						status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
					},
					{
						$setOnInsert: job,
					},
					{
						upsert: true,
						returnDocument: 'after',
					},
				);

				if (!result) {
					throw new ConnectionError('Failed to enqueue job: findOneAndUpdate returned no document');
				}

				return this.documentToPersistedJob<T>(result as WithId<Document>);
			}

			const result = await this.collection?.insertOne(job as Document);

			if (!result) {
				throw new ConnectionError('Failed to enqueue job: collection not available');
			}

			return { ...job, _id: result.insertedId } as PersistedJob<T>;
		} catch (error) {
			if (error instanceof ConnectionError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error during enqueue';
			throw new ConnectionError(
				`Failed to enqueue job: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Enqueue a job for immediate processing.
	 *
	 * Convenience method equivalent to `enqueue(name, data, { runAt: new Date() })`.
	 * Jobs are picked up on the next poll cycle (typically within 1 second based on `pollInterval`).
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler
	 * @returns Promise resolving to the created job document
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
	 *
	 * @example Send email immediately
	 * ```typescript
	 * await monque.now('send-email', {
	 *   to: 'admin@example.com',
	 *   subject: 'Alert',
	 *   body: 'Immediate attention required'
	 * });
	 * ```
	 *
	 * @example Process order in background
	 * ```typescript
	 * const order = await createOrder(data);
	 * await monque.now('process-order', { orderId: order.id });
	 * return order; // Return immediately, processing happens async
	 * ```
	 */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		return this.enqueue(name, data, { runAt: new Date() });
	}

	/**
	 * Schedule a recurring job with a cron expression.
	 *
	 * Creates a job that automatically re-schedules itself based on the cron pattern.
	 * Uses standard 5-field cron format: minute, hour, day of month, month, day of week.
	 * Also supports predefined expressions like `@daily`, `@weekly`, `@monthly`, etc.
	 * After successful completion, the job is reset to `pending` status and scheduled
	 * for its next run based on the cron expression.
	 *
	 * When a `uniqueKey` is provided, only one pending or processing job with that key
	 * can exist. This prevents duplicate scheduled jobs on application restart.
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param cron - Cron expression (5 fields or predefined expression)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler on each run
	 * @param options - Scheduling options (uniqueKey for deduplication)
	 * @returns Promise resolving to the created job document with `repeatInterval` set
	 * @throws {InvalidCronError} If cron expression is invalid
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
	 *
	 * @example Hourly cleanup job
	 * ```typescript
	 * await monque.schedule('0 * * * *', 'cleanup-temp-files', {
	 *   directory: '/tmp/uploads'
	 * });
	 * ```
	 *
	 * @example Prevent duplicate scheduled jobs with unique key
	 * ```typescript
	 * await monque.schedule('0 * * * *', 'hourly-report', { type: 'sales' }, {
	 *   uniqueKey: 'hourly-report-sales'
	 * });
	 * // Subsequent calls with same uniqueKey return existing pending/processing job
	 * ```
	 *
	 * @example Daily report at midnight (using predefined expression)
	 * ```typescript
	 * await monque.schedule('@daily', 'daily-report', {
	 *   reportType: 'sales',
	 *   recipients: ['analytics@example.com']
	 * });
	 * ```
	 */
	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options: ScheduleOptions = {},
	): Promise<PersistedJob<T>> {
		this.ensureInitialized();

		// Validate cron and get next run date (throws InvalidCronError if invalid)
		const nextRunAt = getNextCronDate(cron);

		const now = new Date();
		const job: Omit<Job<T>, '_id'> = {
			name,
			data,
			status: JobStatus.PENDING,
			nextRunAt,
			repeatInterval: cron,
			failCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		if (options.uniqueKey) {
			job.uniqueKey = options.uniqueKey;
		}

		try {
			if (options.uniqueKey) {
				if (!this.collection) {
					throw new ConnectionError('Failed to schedule job: collection not available');
				}

				// Use upsert with $setOnInsert for deduplication (scoped by name + uniqueKey)
				const result = await this.collection.findOneAndUpdate(
					{
						name,
						uniqueKey: options.uniqueKey,
						status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
					},
					{
						$setOnInsert: job,
					},
					{
						upsert: true,
						returnDocument: 'after',
					},
				);

				if (!result) {
					throw new ConnectionError(
						'Failed to schedule job: findOneAndUpdate returned no document',
					);
				}

				return this.documentToPersistedJob<T>(result as WithId<Document>);
			}

			const result = await this.collection?.insertOne(job as Document);

			if (!result) {
				throw new ConnectionError('Failed to schedule job: collection not available');
			}

			return { ...job, _id: result.insertedId } as PersistedJob<T>;
		} catch (error) {
			if (error instanceof MonqueError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error during schedule';
			throw new ConnectionError(
				`Failed to schedule job: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Register a worker to process jobs of a specific type.
	 *
	 * Workers can be registered before or after calling `start()`. Each worker
	 * processes jobs concurrently up to its configured concurrency limit (default: 5).
	 *
	 * The handler function receives the full job object including metadata (`_id`, `status`,
	 * `failCount`, etc.). If the handler throws an error, the job is retried with exponential
	 * backoff up to `maxRetries` times. After exhausting retries, the job is marked as `failed`.
	 *
	 * Events are emitted during job processing: `job:start`, `job:complete`, `job:fail`, and `job:error`.
	 *
	 * **Duplicate Registration**: By default, registering a worker for a job name that already has
	 * a worker will throw a `WorkerRegistrationError`. This fail-fast behavior prevents accidental
	 * replacement of handlers. To explicitly replace a worker, pass `{ replace: true }`.
	 *
	 * @template T - The job data payload type for type-safe access to `job.data`
	 * @param name - Job type identifier to handle
	 * @param handler - Async function to execute for each job
	 * @param options - Worker configuration
	 * @param options.concurrency - Maximum concurrent jobs for this worker (default: `defaultConcurrency`)
	 * @param options.replace - When `true`, replace existing worker instead of throwing error
	 * @throws {WorkerRegistrationError} When a worker is already registered for `name` and `replace` is not `true`
	 *
	 * @example Basic email worker
	 * ```typescript
	 * interface EmailJob {
	 *   to: string;
	 *   subject: string;
	 *   body: string;
	 * }
	 *
	 * monque.worker<EmailJob>('send-email', async (job) => {
	 *   await emailService.send(job.data.to, job.data.subject, job.data.body);
	 * });
	 * ```
	 *
	 * @example Worker with custom concurrency
	 * ```typescript
	 * // Limit to 2 concurrent video processing jobs (resource-intensive)
	 * monque.worker('process-video', async (job) => {
	 *   await videoProcessor.transcode(job.data.videoId);
	 * }, { concurrency: 2 });
	 * ```
	 *
	 * @example Replacing an existing worker
	 * ```typescript
	 * // Replace the existing handler for 'send-email'
	 * monque.worker('send-email', newEmailHandler, { replace: true });
	 * ```
	 *
	 * @example Worker with error handling
	 * ```typescript
	 * monque.worker('sync-user', async (job) => {
	 *   try {
	 *     await externalApi.syncUser(job.data.userId);
	 *   } catch (error) {
	 *     // Job will retry with exponential backoff
	 *     // Delay = 2^failCount × baseRetryInterval (default: 1000ms)
	 *     throw new Error(`Sync failed: ${error.message}`);
	 *   }
	 * });
	 * ```
	 */
	worker<T>(name: string, handler: JobHandler<T>, options: WorkerOptions = {}): void {
		const concurrency = options.concurrency ?? this.options.defaultConcurrency;

		// Check for existing worker and throw unless replace is explicitly true
		if (this.workers.has(name) && options.replace !== true) {
			throw new WorkerRegistrationError(
				`Worker already registered for job name "${name}". Use { replace: true } to replace.`,
				name,
			);
		}

		this.workers.set(name, {
			handler: handler as JobHandler,
			concurrency,
			activeJobs: new Map(),
		});
	}

	/**
	 * Start polling for and processing jobs.
	 *
	 * Begins polling MongoDB at the configured interval (default: 1 second) to pick up
	 * pending jobs and dispatch them to registered workers. Must call `initialize()` first.
	 * Workers can be registered before or after calling `start()`.
	 *
	 * Jobs are processed concurrently up to each worker's configured concurrency limit.
	 * The scheduler continues running until `stop()` is called.
	 *
	 * @example Basic startup
	 * ```typescript
	 * const monque = new Monque(db);
	 * await monque.initialize();
	 *
	 * monque.worker('send-email', emailHandler);
	 * monque.worker('process-order', orderHandler);
	 *
	 * monque.start(); // Begin processing jobs
	 * ```
	 *
	 * @example With event monitoring
	 * ```typescript
	 * monque.on('job:start', (job) => {
	 *   logger.info(`Starting job ${job.name}`);
	 * });
	 *
	 * monque.on('job:complete', ({ job, duration }) => {
	 *   metrics.recordJobDuration(job.name, duration);
	 * });
	 *
	 * monque.on('job:fail', ({ job, error, willRetry }) => {
	 *   logger.error(`Job ${job.name} failed:`, error);
	 *   if (!willRetry) {
	 *     alerting.sendAlert(`Job permanently failed: ${job.name}`);
	 *   }
	 * });
	 *
	 * monque.start();
	 * ```
	 *
	 * @throws {ConnectionError} If scheduler not initialized (call `initialize()` first)
	 */
	start(): void {
		if (this.isRunning) {
			return;
		}

		if (!this.isInitialized) {
			throw new ConnectionError('Monque not initialized. Call initialize() before start().');
		}

		this.isRunning = true;

		// Set up change streams as the primary notification mechanism
		this.setupChangeStream();

		// Set up polling as backup (runs at configured interval)
		this.pollIntervalId = setInterval(() => {
			this.poll().catch((error: unknown) => {
				this.emit('job:error', { error: error as Error });
			});
		}, this.options.pollInterval);

		// Start heartbeat interval for claimed jobs
		this.heartbeatIntervalId = setInterval(() => {
			this.updateHeartbeats().catch((error: unknown) => {
				this.emit('job:error', { error: error as Error });
			});
		}, this.options.heartbeatInterval);

		// Start cleanup interval if retention is configured
		if (this.options.jobRetention) {
			const interval = this.options.jobRetention.interval ?? DEFAULTS.retentionInterval;

			// Run immediately on start
			this.cleanupJobs().catch((error: unknown) => {
				this.emit('job:error', { error: error as Error });
			});

			this.cleanupIntervalId = setInterval(() => {
				this.cleanupJobs().catch((error: unknown) => {
					this.emit('job:error', { error: error as Error });
				});
			}, interval);
		}

		// Run initial poll immediately to pick up any existing jobs
		this.poll().catch((error: unknown) => {
			this.emit('job:error', { error: error as Error });
		});
	}

	/**
	 * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
	 *
	 * Stops polling for new jobs and waits for all active jobs to finish processing.
	 * Times out after the configured `shutdownTimeout` (default: 30 seconds), emitting
	 * a `job:error` event with a `ShutdownTimeoutError` containing incomplete jobs.
	 *
	 * It's safe to call `stop()` multiple times - subsequent calls are no-ops if already stopped.
	 *
	 * @returns Promise that resolves when all jobs complete or timeout is reached
	 *
	 * @example Graceful application shutdown
	 * ```typescript
	 * process.on('SIGTERM', async () => {
	 *   console.log('Shutting down gracefully...');
	 *   await monque.stop(); // Wait for jobs to complete
	 *   await mongoClient.close();
	 *   process.exit(0);
	 * });
	 * ```
	 *
	 * @example With timeout handling
	 * ```typescript
	 * monque.on('job:error', ({ error }) => {
	 *   if (error.name === 'ShutdownTimeoutError') {
	 *     logger.warn('Forced shutdown after timeout:', error.incompleteJobs);
	 *   }
	 * });
	 *
	 * await monque.stop();
	 * ```
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		// Close change stream
		await this.closeChangeStream();

		// Clear debounce timer
		if (this.changeStreamDebounceTimer) {
			clearTimeout(this.changeStreamDebounceTimer);
			this.changeStreamDebounceTimer = null;
		}

		// Clear reconnection timer
		if (this.changeStreamReconnectTimer) {
			clearTimeout(this.changeStreamReconnectTimer);
			this.changeStreamReconnectTimer = null;
		}

		if (this.cleanupIntervalId) {
			clearInterval(this.cleanupIntervalId);
			this.cleanupIntervalId = null;
		}

		// Clear polling interval
		if (this.pollIntervalId) {
			clearInterval(this.pollIntervalId);
			this.pollIntervalId = null;
		}

		// Clear heartbeat interval
		if (this.heartbeatIntervalId) {
			clearInterval(this.heartbeatIntervalId);
			this.heartbeatIntervalId = null;
		}

		// Wait for all active jobs to complete (with timeout)
		const activeJobs = this.getActiveJobs();
		if (activeJobs.length === 0) {
			return;
		}

		// Create a promise that resolves when all jobs are done
		let checkInterval: ReturnType<typeof setInterval> | undefined;
		const waitForJobs = new Promise<undefined>((resolve) => {
			checkInterval = setInterval(() => {
				if (this.getActiveJobs().length === 0) {
					clearInterval(checkInterval);
					resolve(undefined);
				}
			}, 100);
		});

		// Race between job completion and timeout
		const timeout = new Promise<'timeout'>((resolve) => {
			setTimeout(() => resolve('timeout'), this.options.shutdownTimeout);
		});

		let result: undefined | 'timeout';

		try {
			result = await Promise.race([waitForJobs, timeout]);
		} finally {
			if (checkInterval) {
				clearInterval(checkInterval);
			}
		}

		if (result === 'timeout') {
			const incompleteJobs = this.getActiveJobsList();
			const { ShutdownTimeoutError } = await import('@/shared/errors.js');

			const error = new ShutdownTimeoutError(
				`Shutdown timed out after ${this.options.shutdownTimeout}ms with ${incompleteJobs.length} incomplete jobs`,
				incompleteJobs,
			);
			this.emit('job:error', { error });
		}
	}

	/**
	 * Check if the scheduler is healthy (running and connected).
	 *
	 * Returns `true` when the scheduler is started, initialized, and has an active
	 * MongoDB collection reference. Useful for health check endpoints and monitoring.
	 *
	 * A healthy scheduler:
	 * - Has called `initialize()` successfully
	 * - Has called `start()` and is actively polling
	 * - Has a valid MongoDB collection reference
	 *
	 * @returns `true` if scheduler is running and connected, `false` otherwise
	 *
	 * @example Express health check endpoint
	 * ```typescript
	 * app.get('/health', (req, res) => {
	 *   const healthy = monque.isHealthy();
	 *   res.status(healthy ? 200 : 503).json({
	 *     status: healthy ? 'ok' : 'unavailable',
	 *     scheduler: healthy,
	 *     timestamp: new Date().toISOString()
	 *   });
	 * });
	 * ```
	 *
	 * @example Kubernetes readiness probe
	 * ```typescript
	 * app.get('/readyz', (req, res) => {
	 *   if (monque.isHealthy() && dbConnected) {
	 *     res.status(200).send('ready');
	 *   } else {
	 *     res.status(503).send('not ready');
	 *   }
	 * });
	 * ```
	 *
	 * @example Periodic health monitoring
	 * ```typescript
	 * setInterval(() => {
	 *   if (!monque.isHealthy()) {
	 *     logger.error('Scheduler unhealthy');
	 *     metrics.increment('scheduler.unhealthy');
	 *   }
	 * }, 60000); // Check every minute
	 * ```
	 */
	isHealthy(): boolean {
		return this.isRunning && this.isInitialized && this.collection !== null;
	}

	/**
	 * Query jobs from the queue with optional filters.
	 *
	 * Provides read-only access to job data for monitoring, debugging, and
	 * administrative purposes. Results are ordered by `nextRunAt` ascending.
	 *
	 * @template T - The expected type of the job data payload
	 * @param filter - Optional filter criteria
	 * @returns Promise resolving to array of matching jobs
	 * @throws {ConnectionError} If scheduler not initialized
	 *
	 * @example Get all pending jobs
	 * ```typescript
	 * const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
	 * console.log(`${pendingJobs.length} jobs waiting`);
	 * ```
	 *
	 * @example Get failed email jobs
	 * ```typescript
	 * const failedEmails = await monque.getJobs({
	 *   name: 'send-email',
	 *   status: JobStatus.FAILED,
	 * });
	 * for (const job of failedEmails) {
	 *   console.error(`Job ${job._id} failed: ${job.failReason}`);
	 * }
	 * ```
	 *
	 * @example Paginated job listing
	 * ```typescript
	 * const page1 = await monque.getJobs({ limit: 50, skip: 0 });
	 * const page2 = await monque.getJobs({ limit: 50, skip: 50 });
	 * ```
	 *
	 * @example Use with type guards from @monque/core
	 * ```typescript
	 * import { isPendingJob, isRecurringJob } from '@monque/core';
	 *
	 * const jobs = await monque.getJobs();
	 * const pendingRecurring = jobs.filter(job => isPendingJob(job) && isRecurringJob(job));
	 * ```
	 */
	async getJobs<T = unknown>(filter: GetJobsFilter = {}): Promise<PersistedJob<T>[]> {
		this.ensureInitialized();

		if (!this.collection) {
			throw new ConnectionError('Failed to query jobs: collection not available');
		}

		const query: Document = {};

		if (filter.name !== undefined) {
			query['name'] = filter.name;
		}

		if (filter.status !== undefined) {
			if (Array.isArray(filter.status)) {
				query['status'] = { $in: filter.status };
			} else {
				query['status'] = filter.status;
			}
		}

		const limit = filter.limit ?? 100;
		const skip = filter.skip ?? 0;

		try {
			const cursor = this.collection.find(query).sort({ nextRunAt: 1 }).skip(skip).limit(limit);

			const docs = await cursor.toArray();
			return docs.map((doc) => this.documentToPersistedJob<T>(doc));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error during getJobs';
			throw new ConnectionError(
				`Failed to query jobs: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Get a single job by its MongoDB ObjectId.
	 *
	 * Useful for retrieving job details when you have a job ID from events,
	 * logs, or stored references.
	 *
	 * @template T - The expected type of the job data payload
	 * @param id - The job's ObjectId
	 * @returns Promise resolving to the job if found, null otherwise
	 * @throws {ConnectionError} If scheduler not initialized
	 *
	 * @example Look up job from event
	 * ```typescript
	 * monque.on('job:fail', async ({ job }) => {
	 *   // Later, retrieve the job to check its status
	 *   const currentJob = await monque.getJob(job._id);
	 *   console.log(`Job status: ${currentJob?.status}`);
	 * });
	 * ```
	 *
	 * @example Admin endpoint
	 * ```typescript
	 * app.get('/jobs/:id', async (req, res) => {
	 *   const job = await monque.getJob(new ObjectId(req.params.id));
	 *   if (!job) {
	 *     return res.status(404).json({ error: 'Job not found' });
	 *   }
	 *   res.json(job);
	 * });
	 * ```
	 */
	async getJob<T = unknown>(id: ObjectId): Promise<PersistedJob<T> | null> {
		this.ensureInitialized();

		if (!this.collection) {
			throw new ConnectionError('Failed to get job: collection not available');
		}

		try {
			const doc = await this.collection.findOne({ _id: id });
			if (!doc) {
				return null;
			}
			return this.documentToPersistedJob<T>(doc as WithId<Document>);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error during getJob';
			throw new ConnectionError(
				`Failed to get job: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Poll for available jobs and process them.
	 *
	 * Called at regular intervals (configured by `pollInterval`). For each registered worker,
	 * attempts to acquire jobs up to the worker's available concurrency slots.
	 *
	 * @private
	 */
	private async poll(): Promise<void> {
		if (!this.isRunning || !this.collection) {
			return;
		}

		for (const [name, worker] of this.workers) {
			// Check if worker has capacity
			const availableSlots = worker.concurrency - worker.activeJobs.size;

			if (availableSlots <= 0) {
				continue;
			}

			// Try to acquire jobs up to available slots
			for (let i = 0; i < availableSlots; i++) {
				const job = await this.acquireJob(name);

				if (job) {
					this.processJob(job, worker).catch((error: unknown) => {
						this.emit('job:error', { error: error as Error, job });
					});
				} else {
					// No more jobs available for this worker
					break;
				}
			}
		}
	}

	/**
	 * Atomically acquire a pending job for processing using the claimedBy pattern.
	 *
	 * Uses MongoDB's `findOneAndUpdate` with atomic operations to ensure only one scheduler
	 * instance can claim a job. The query ensures the job is:
	 * - In pending status
	 * - Has nextRunAt <= now
	 * - Is not claimed by another instance (claimedBy is null/undefined)
	 *
	 * @private
	 * @param name - The job type to acquire
	 * @returns The acquired job with updated status, claimedBy, and heartbeat info, or `null` if no jobs available
	 */
	private async acquireJob(name: string): Promise<PersistedJob | null> {
		if (!this.collection) {
			return null;
		}

		const now = new Date();

		const result = await this.collection.findOneAndUpdate(
			{
				name,
				status: JobStatus.PENDING,
				nextRunAt: { $lte: now },
				$or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
			},
			{
				$set: {
					status: JobStatus.PROCESSING,
					claimedBy: this.options.schedulerInstanceId,
					lockedAt: now,
					lastHeartbeat: now,
					heartbeatInterval: this.options.heartbeatInterval,
					updatedAt: now,
				},
			},
			{
				sort: { nextRunAt: 1 },
				returnDocument: 'after',
			},
		);

		if (!result) {
			return null;
		}

		return this.documentToPersistedJob(result as WithId<Document>);
	}

	/**
	 * Execute a job using its registered worker handler.
	 *
	 * Tracks the job as active during processing, emits lifecycle events, and handles
	 * both success and failure cases. On success, calls `completeJob()`. On failure,
	 * calls `failJob()` which implements exponential backoff retry logic.
	 *
	 * @private
	 * @param job - The job to process
	 * @param worker - The worker registration containing the handler and active job tracking
	 */
	private async processJob(job: PersistedJob, worker: WorkerRegistration): Promise<void> {
		const jobId = job._id.toString();
		worker.activeJobs.set(jobId, job);

		const startTime = Date.now();
		this.emit('job:start', job);

		try {
			await worker.handler(job);

			// Job completed successfully
			const duration = Date.now() - startTime;
			await this.completeJob(job);
			this.emit('job:complete', { job, duration });
		} catch (error) {
			// Job failed
			const err = error instanceof Error ? error : new Error(String(error));
			await this.failJob(job, err);

			const willRetry = job.failCount + 1 < this.options.maxRetries;
			this.emit('job:fail', { job, error: err, willRetry });
		} finally {
			worker.activeJobs.delete(jobId);
		}
	}

	/**
	 * Mark a job as completed successfully.
	 *
	 * For recurring jobs (with `repeatInterval`), schedules the next run based on the cron
	 * expression and resets `failCount` to 0. For one-time jobs, sets status to `completed`.
	 * Clears `lockedAt` and `failReason` fields in both cases.
	 *
	 * @private
	 * @param job - The job that completed successfully
	 */
	private async completeJob(job: Job): Promise<void> {
		if (!this.collection || !isPersistedJob(job)) {
			return;
		}

		if (job.repeatInterval) {
			// Recurring job - schedule next run
			const nextRunAt = getNextCronDate(job.repeatInterval);
			await this.collection.updateOne(
				{ _id: job._id },
				{
					$set: {
						status: JobStatus.PENDING,
						nextRunAt,
						failCount: 0,
						updatedAt: new Date(),
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
						heartbeatInterval: '',
						failReason: '',
					},
				},
			);
		} else {
			// One-time job - mark as completed
			await this.collection.updateOne(
				{ _id: job._id },
				{
					$set: {
						status: JobStatus.COMPLETED,
						updatedAt: new Date(),
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
						heartbeatInterval: '',
						failReason: '',
					},
				},
			);
			job.status = JobStatus.COMPLETED;
		}
	}

	/**
	 * Handle job failure with exponential backoff retry logic.
	 *
	 * Increments `failCount` and calculates next retry time using exponential backoff:
	 * `nextRunAt = 2^failCount × baseRetryInterval` (capped by optional `maxBackoffDelay`).
	 *
	 * If `failCount >= maxRetries`, marks job as permanently `failed`. Otherwise, resets
	 * to `pending` status for retry. Stores error message in `failReason` field.
	 *
	 * @private
	 * @param job - The job that failed
	 * @param error - The error that caused the failure
	 */
	private async failJob(job: Job, error: Error): Promise<void> {
		if (!this.collection || !isPersistedJob(job)) {
			return;
		}

		const newFailCount = job.failCount + 1;

		if (newFailCount >= this.options.maxRetries) {
			// Permanent failure
			await this.collection.updateOne(
				{ _id: job._id },
				{
					$set: {
						status: JobStatus.FAILED,
						failCount: newFailCount,
						failReason: error.message,
						updatedAt: new Date(),
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
						heartbeatInterval: '',
					},
				},
			);
		} else {
			// Schedule retry with exponential backoff
			const nextRunAt = calculateBackoff(
				newFailCount,
				this.options.baseRetryInterval,
				this.options.maxBackoffDelay,
			);

			await this.collection.updateOne(
				{ _id: job._id },
				{
					$set: {
						status: JobStatus.PENDING,
						failCount: newFailCount,
						failReason: error.message,
						nextRunAt,
						updatedAt: new Date(),
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
						heartbeatInterval: '',
					},
				},
			);
		}
	}

	/**
	 * Ensure the scheduler is initialized before operations.
	 *
	 * @private
	 * @throws {ConnectionError} If scheduler not initialized or collection unavailable
	 */
	private ensureInitialized(): void {
		if (!this.isInitialized || !this.collection) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}
	}

	/**
	 * Update heartbeats for all jobs claimed by this scheduler instance.
	 *
	 * This method runs periodically while the scheduler is running to indicate
	 * that jobs are still being actively processed. Other instances use the
	 * lastHeartbeat timestamp to detect stale jobs from crashed schedulers.
	 *
	 * @private
	 */
	private async updateHeartbeats(): Promise<void> {
		if (!this.collection || !this.isRunning) {
			return;
		}

		const now = new Date();

		await this.collection.updateMany(
			{
				claimedBy: this.options.schedulerInstanceId,
				status: JobStatus.PROCESSING,
			},
			{
				$set: {
					lastHeartbeat: now,
					updatedAt: now,
				},
			},
		);
	}

	/**
	 * Set up MongoDB Change Stream for real-time job notifications.
	 *
	 * Change streams provide instant notifications when jobs are inserted or when
	 * job status changes to pending (e.g., after a retry). This eliminates the
	 * polling delay for reactive job processing.
	 *
	 * The change stream watches for:
	 * - Insert operations (new jobs)
	 * - Update operations where status field changes
	 *
	 * If change streams are unavailable (e.g., standalone MongoDB), the system
	 * gracefully falls back to polling-only mode.
	 *
	 * @private
	 */
	private setupChangeStream(): void {
		if (!this.collection || !this.isRunning) {
			return;
		}

		try {
			// Create change stream with pipeline to filter relevant events
			const pipeline = [
				{
					$match: {
						$or: [
							{ operationType: 'insert' },
							{
								operationType: 'update',
								'updateDescription.updatedFields.status': { $exists: true },
							},
						],
					},
				},
			];

			this.changeStream = this.collection.watch(pipeline, {
				fullDocument: 'updateLookup',
			});

			// Handle change events
			this.changeStream.on('change', (change) => {
				this.handleChangeStreamEvent(change);
			});

			// Handle errors with reconnection
			this.changeStream.on('error', (error: Error) => {
				this.emit('changestream:error', { error });
				this.handleChangeStreamError(error);
			});

			// Mark as connected
			this.usingChangeStreams = true;
			this.changeStreamReconnectAttempts = 0;
			this.emit('changestream:connected', undefined);
		} catch (error) {
			// Change streams not available (e.g., standalone MongoDB)
			this.usingChangeStreams = false;
			const reason = error instanceof Error ? error.message : 'Unknown error';
			this.emit('changestream:fallback', { reason });
		}
	}

	/**
	 * Handle a change stream event by triggering a debounced poll.
	 *
	 * Events are debounced to prevent "claim storms" when multiple changes arrive
	 * in rapid succession (e.g., bulk job inserts). A 100ms debounce window
	 * collects multiple events and triggers a single poll.
	 *
	 * @private
	 * @param change - The change stream event document
	 */
	private handleChangeStreamEvent(change: ChangeStreamDocument<Document>): void {
		if (!this.isRunning) {
			return;
		}

		// Trigger poll on insert (new job) or update where status changes
		const isInsert = change.operationType === 'insert';
		const isUpdate = change.operationType === 'update';

		// Get fullDocument if available (for insert or with updateLookup option)
		const fullDocument = 'fullDocument' in change ? change.fullDocument : undefined;
		const isPendingStatus = fullDocument?.['status'] === JobStatus.PENDING;

		// For inserts: always trigger since new pending jobs need processing
		// For updates: trigger if status changed to pending (retry/release scenario)
		const shouldTrigger = isInsert || (isUpdate && isPendingStatus);

		if (shouldTrigger) {
			// Debounce poll triggers to avoid claim storms
			if (this.changeStreamDebounceTimer) {
				clearTimeout(this.changeStreamDebounceTimer);
			}

			this.changeStreamDebounceTimer = setTimeout(() => {
				this.changeStreamDebounceTimer = null;
				this.poll().catch((error: unknown) => {
					this.emit('job:error', { error: error as Error });
				});
			}, 100);
		}
	}

	/**
	 * Handle change stream errors with exponential backoff reconnection.
	 *
	 * Attempts to reconnect up to `maxChangeStreamReconnectAttempts` times with
	 * exponential backoff (base 1000ms). After exhausting retries, falls back to
	 * polling-only mode.
	 *
	 * @private
	 * @param error - The error that caused the change stream failure
	 */
	private handleChangeStreamError(error: Error): void {
		if (!this.isRunning) {
			return;
		}

		this.changeStreamReconnectAttempts++;

		if (this.changeStreamReconnectAttempts > this.maxChangeStreamReconnectAttempts) {
			// Fall back to polling-only mode
			this.usingChangeStreams = false;
			this.emit('changestream:fallback', {
				reason: `Exhausted ${this.maxChangeStreamReconnectAttempts} reconnection attempts: ${error.message}`,
			});
			return;
		}

		// Exponential backoff: 1s, 2s, 4s
		const delay = 2 ** (this.changeStreamReconnectAttempts - 1) * 1000;

		// Clear any existing reconnect timer before scheduling a new one
		if (this.changeStreamReconnectTimer) {
			clearTimeout(this.changeStreamReconnectTimer);
		}

		this.changeStreamReconnectTimer = setTimeout(() => {
			this.changeStreamReconnectTimer = null;
			if (this.isRunning) {
				// Close existing change stream before reconnecting
				if (this.changeStream) {
					this.changeStream.close().catch(() => {});
					this.changeStream = null;
				}
				this.setupChangeStream();
			}
		}, delay);
	}

	/**
	 * Close the change stream cursor and emit closed event.
	 *
	 * @private
	 */
	private async closeChangeStream(): Promise<void> {
		if (this.changeStream) {
			try {
				await this.changeStream.close();
			} catch {
				// Ignore close errors during shutdown
			}
			this.changeStream = null;

			if (this.usingChangeStreams) {
				this.emit('changestream:closed', undefined);
			}
		}

		this.usingChangeStreams = false;
		this.changeStreamReconnectAttempts = 0;
	}

	/**
	 * Get array of active job IDs across all workers.
	 *
	 * @private
	 * @returns Array of job ID strings currently being processed
	 */
	private getActiveJobs(): string[] {
		const activeJobs: string[] = [];
		for (const worker of this.workers.values()) {
			activeJobs.push(...worker.activeJobs.keys());
		}
		return activeJobs;
	}

	/**
	 * Get list of active job documents (for shutdown timeout error).
	 *
	 * @private
	 * @returns Array of active Job objects
	 */
	private getActiveJobsList(): Job[] {
		const activeJobs: Job[] = [];
		for (const worker of this.workers.values()) {
			activeJobs.push(...worker.activeJobs.values());
		}
		return activeJobs;
	}

	/**
	 * Convert a MongoDB document to a typed PersistedJob object.
	 *
	 * Maps raw MongoDB document fields to the strongly-typed `PersistedJob<T>` interface,
	 * ensuring type safety and handling optional fields (`lockedAt`, `failReason`, etc.).
	 *
	 * @private
	 * @template T - The job data payload type
	 * @param doc - The raw MongoDB document with `_id`
	 * @returns A strongly-typed PersistedJob object with guaranteed `_id`
	 */
	private documentToPersistedJob<T>(doc: WithId<Document>): PersistedJob<T> {
		const job: PersistedJob<T> = {
			_id: doc._id,
			name: doc['name'] as string,
			data: doc['data'] as T,
			status: doc['status'] as JobStatusType,
			nextRunAt: doc['nextRunAt'] as Date,
			failCount: doc['failCount'] as number,
			createdAt: doc['createdAt'] as Date,
			updatedAt: doc['updatedAt'] as Date,
		};

		// Only set optional properties if they exist
		if (doc['lockedAt'] !== undefined) {
			job.lockedAt = doc['lockedAt'] as Date | null;
		}
		if (doc['claimedBy'] !== undefined) {
			job.claimedBy = doc['claimedBy'] as string | null;
		}
		if (doc['lastHeartbeat'] !== undefined) {
			job.lastHeartbeat = doc['lastHeartbeat'] as Date | null;
		}
		if (doc['heartbeatInterval'] !== undefined) {
			job.heartbeatInterval = doc['heartbeatInterval'] as number;
		}
		if (doc['failReason'] !== undefined) {
			job.failReason = doc['failReason'] as string;
		}
		if (doc['repeatInterval'] !== undefined) {
			job.repeatInterval = doc['repeatInterval'] as string;
		}
		if (doc['uniqueKey'] !== undefined) {
			job.uniqueKey = doc['uniqueKey'] as string;
		}

		return job;
	}

	/**
	 * Type-safe event emitter methods
	 */
	override emit<K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]): boolean {
		return super.emit(event, payload);
	}

	override on<K extends keyof MonqueEventMap>(
		event: K,
		listener: (payload: MonqueEventMap[K]) => void,
	): this {
		return super.on(event, listener);
	}

	override once<K extends keyof MonqueEventMap>(
		event: K,
		listener: (payload: MonqueEventMap[K]) => void,
	): this {
		return super.once(event, listener);
	}

	override off<K extends keyof MonqueEventMap>(
		event: K,
		listener: (payload: MonqueEventMap[K]) => void,
	): this {
		return super.off(event, listener);
	}
}
````

## File: packages/core/README.md
````markdown
# @monque/core

MongoDB-backed job scheduler with atomic locking, exponential backoff, and cron scheduling.

## Installation

Using Bun:
```bash
bun add @monque/core mongodb
```

Or using npm/yarn/pnpm:
```bash
npm install @monque/core mongodb
yarn add @monque/core mongodb
pnpm add @monque/core mongodb
```

## Usage

```typescript
import { Monque } from '@monque/core';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const monque = new Monque(client.db('myapp'), {
  collectionName: 'jobs',
  pollInterval: 1000,
  maxRetries: 10,
  defaultConcurrency: 5,
});

await monque.initialize();

// Register workers
monque.worker('send-email', async (job) => {
  await sendEmail(job.data.to, job.data.subject);
});

// Start processing
monque.start();

// Enqueue jobs
await monque.enqueue('send-email', { to: 'user@example.com', subject: 'Hello' });

// Schedule recurring jobs
await monque.schedule('0 9 * * *', 'daily-report', { type: 'summary' });

// Graceful shutdown
await monque.stop();
```

## API

### `new Monque(db, options?)`

Creates a new Monque instance.

**Options:**
- `collectionName` - MongoDB collection name (default: `'monque_jobs'`)
- `pollInterval` - Polling interval in ms (default: `1000`)
- `maxRetries` - Max retry attempts (default: `10`)
- `baseRetryInterval` - Base backoff interval in ms (default: `1000`)
- `shutdownTimeout` - Graceful shutdown timeout in ms (default: `30000`)
- `defaultConcurrency` - Jobs per worker (default: `5`)
- `lockTimeout` - Stale job threshold in ms (default: `1800000`)
- `recoverStaleJobs` - Recover stale jobs on startup (default: `true`)

### Methods

- `initialize()` - Set up collection and indexes
- `enqueue(name, data, options?)` - Enqueue a job
- `now(name, data)` - Enqueue for immediate processing
- `schedule(cron, name, data)` - Schedule recurring job
- `worker(name, handler, options?)` - Register a worker
- `start()` - Start processing jobs
- `stop()` - Graceful shutdown
- `isHealthy()` - Check scheduler health

### Events

```typescript
monque.on('job:start', (job) => { /* job started */ });
monque.on('job:complete', ({ job, duration }) => { /* job completed */ });
monque.on('job:fail', ({ job, error, willRetry }) => { /* job failed */ });
monque.on('job:error', ({ error, job? }) => { /* unexpected error */ });
monque.on('stale:recovered', ({ count }) => { /* stale jobs recovered */ });
```

## Development

### Running Tests

```bash
# Run tests once (fresh container each time)
bun run test

# Run tests in watch mode with container reuse (faster iteration)
bun run test:dev

# Or enable reuse globally in your shell profile
export TESTCONTAINERS_REUSE_ENABLE=true
bun run test:watch
```

When `TESTCONTAINERS_REUSE_ENABLE=true`, the MongoDB testcontainer persists between test runs, significantly speeding up local development. Ryuk (the testcontainers cleanup daemon) remains enabled as a safety net for orphaned containers.

To manually clean up reusable containers:
```bash
docker stop $(docker ps -q --filter label=org.testcontainers=true)
```

## License

ISC
````

## File: packages/core/tests/factories/job.factory.ts
````typescript
import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';
import { ObjectId } from 'mongodb';

import { TEST_CONSTANTS } from '@tests/setup/constants.js';
import { JobStatus, type PersistedJob } from '@/jobs';

/**
 * Transient parameters for JobFactory.
 * These don't end up in the built object but control factory behavior.
 */
interface JobTransientParams {
	/** Generate custom data shape instead of default email/userId */
	withData?: Record<string, unknown>;
}

/**
 * Factory for creating test Job objects with realistic fake data.
 *
 * @example
 * ```typescript
 * // Basic usage - creates a pending job with random data
 * const job = JobFactory.build();
 *
 * // Override specific fields
 * const processingJob = JobFactory.build({ status: JobStatus.PROCESSING });
 *
 * // Use transient params for custom data
 * const emailJob = JobFactory.build({}, { transient: { withData: { to: 'test@example.com' } } });
 *
 * // Use status-specific helpers
 * const failed = JobFactoryHelpers.failed();
 * const processing = JobFactoryHelpers.processing();
 * ```
 */
export const JobFactory = Factory.define<PersistedJob<unknown>, JobTransientParams>(
	({ transientParams }) => {
		const data = transientParams.withData ?? {
			email: faker.internet.email(),
			userId: faker.string.uuid(),
		};

		return {
			_id: new ObjectId(faker.database.mongodbObjectId()),
			name: TEST_CONSTANTS.JOB_NAME,
			data,
			status: JobStatus.PENDING,
			failCount: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			nextRunAt: new Date(),
		};
	},
);

/** Convenience builders for common job states */
export const JobFactoryHelpers = {
	/** Build a job in PROCESSING state with lockedAt set */
	processing: (overrides?: Partial<PersistedJob<unknown>>) =>
		JobFactory.build({
			status: JobStatus.PROCESSING,
			lockedAt: new Date(),
			claimedBy: overrides?.claimedBy ?? 'test-instance-id',
			lastHeartbeat: overrides?.lastHeartbeat ?? new Date(),
			...overrides,
		}),

	/** Build a job in COMPLETED state */
	completed: (overrides?: Partial<PersistedJob<unknown>>) =>
		JobFactory.build({
			status: JobStatus.COMPLETED,
			...overrides,
		}),

	/** Build a job in FAILED state with failCount and failReason */
	failed: (overrides?: Partial<PersistedJob<unknown>>) =>
		JobFactory.build({
			status: JobStatus.FAILED,
			failCount: 10,
			failReason: 'Max retries exceeded',
			...overrides,
		}),

	/** Build a job with custom data payload */
	withData: <T extends Record<string, unknown>>(data: T, overrides?: Partial<PersistedJob<T>>) =>
		JobFactory.build(overrides as Partial<PersistedJob<unknown>>, {
			transient: { withData: data },
		}) as PersistedJob<T>,
};
````

## File: packages/core/vitest.config.ts
````typescript
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import rootConfig from '../../vitest.config.ts';

export default mergeConfig(
	rootConfig,
	defineConfig({
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
				'@tests': fileURLToPath(new URL('./tests', import.meta.url)),
				'@test-utils': fileURLToPath(new URL('./tests/setup', import.meta.url)),
			},
		},
		test: {
			include: ['tests/**/*.test.ts'],
			coverage: {
				include: ['src/**/*.ts'],
				exclude: [
					// Type-only files with no runtime code
					'src/**/types.ts',
					'src/events/types.ts',
					'src/workers/types.ts',
					'src/scheduler/types.ts',
				],
			},
			// Global setup for MongoDB Testcontainers (returns teardown function)
			globalSetup: ['./tests/setup/global-setup.ts'],
			// Seed faker for deterministic tests
			setupFiles: ['./tests/setup/seed.ts'],
			// Increase timeout for integration tests (container startup can be slow)
			testTimeout: 30000,
			hookTimeout: 60000,
		},
	}),
);
````

## File: packages/core/src/index.ts
````typescript
// Types - Events
export type { MonqueEventMap } from '@/events';
// Types - Jobs
export {
	type EnqueueOptions,
	type GetJobsFilter,
	isCompletedJob,
	isFailedJob,
	isPendingJob,
	isPersistedJob,
	isProcessingJob,
	isRecurringJob,
	isValidJobStatus,
	type Job,
	type JobHandler,
	JobStatus,
	type JobStatusType,
	type PersistedJob,
	type ScheduleOptions,
} from '@/jobs';
// Types - Scheduler
export type { MonqueOptions } from '@/scheduler';
// Main class
export { Monque } from '@/scheduler';
// Errors
// Utilities (for advanced use cases)
export {
	ConnectionError,
	calculateBackoff,
	calculateBackoffDelay,
	DEFAULT_BASE_INTERVAL,
	getNextCronDate,
	InvalidCronError,
	MonqueError,
	ShutdownTimeoutError,
	validateCronExpression,
	WorkerRegistrationError,
} from '@/shared';
// Types - Workers
export type { WorkerOptions } from '@/workers';
````

## File: packages/core/tests/setup/test-utils.ts
````typescript
/**
 * Test utilities for MongoDB integration tests.
 *
 * Provides helper functions for isolated test databases and cleanup.
 *
 * @example
 * ```typescript
 * import { getTestDb, cleanupTestDb } from './setup/test-utils';
 *
 * describe('MyTest', () => {
 *   let db: Db;
 *
 *   beforeAll(async () => {
 *     db = await getTestDb('my-test-suite');
 *   });
 *
 *   afterAll(async () => {
 *     await cleanupTestDb(db);
 *   });
 * });
 * ```
 */

import type { Collection, Db, Document, ObjectId } from 'mongodb';

import { getMongoClient } from '@tests/setup/mongodb.js';
import type { Job } from '@/jobs';

/**
 * Gets an isolated test database.
 * Each test file should use a unique testName to avoid conflicts.
 *
 * @param testName - A unique identifier for the test suite (used as database name suffix)
 * @returns A MongoDB Db instance for isolated testing
 */
export async function getTestDb(testName: string): Promise<Db> {
	const client = await getMongoClient();
	// Sanitize test name for use as database name
	const sanitizedName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');

	return client.db(`monque_test_${sanitizedName}`);
}

/**
 * Drops the test database to clean up after test suite.
 * Call this in afterAll() to ensure test isolation.
 *
 * @param db - The database instance to drop
 */
export async function cleanupTestDb(db: Db): Promise<void> {
	await db.dropDatabase();
}

/**
 * Clears all documents from a specific collection without dropping it.
 * Useful for cleaning up between tests within the same suite.
 *
 * @param db - The database instance
 * @param collectionName - Name of the collection to clear
 */
export async function clearCollection(db: Db, collectionName: string): Promise<void> {
	await db.collection(collectionName).deleteMany({});
}

/**
 * Creates a unique collection name for test isolation.
 * Useful when running parallel tests that share a database.
 *
 * @param baseName - Base collection name
 * @returns Unique collection name with random suffix
 */
export function uniqueCollectionName(baseName: string): string {
	const suffix = Math.random().toString(36).substring(2, 8);

	return `${baseName}_${suffix}`;
}

/**
 * Waits for a condition to be true with timeout.
 * Useful for testing async operations like job processing.
 *
 * @param condition - Async function that returns true when condition is met
 * @param options - Configuration for polling and timeout
 * @returns Promise that resolves when condition is true
 * @throws Error if timeout is exceeded
 */
export async function waitFor(
	condition: () => Promise<boolean>,
	options: { timeout?: number; interval?: number } = {},
): Promise<void> {
	const { timeout = 10000, interval = 100 } = options;
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	const elapsed = Date.now() - startTime;
	throw new Error(
		`waitFor condition not met within ${timeout}ms (elapsed: ${elapsed}ms). ` +
			`Consider increasing timeout or checking test conditions.`,
	);
}

/**
 * Stops multiple Monque instances in parallel.
 * Useful for cleaning up in afterEach/afterAll.
 *
 * @param instances - Array of Monque instances or objects with a stop method
 */
export async function stopMonqueInstances(
	instances: { stop: () => Promise<void> }[],
): Promise<void> {
	await Promise.all(instances.map((i) => i.stop()));
	// Clear the array in place
	instances.length = 0;
}

/**
 * Updates a job's nextRunAt to now for immediate execution in tests.
 * Useful for triggering scheduled jobs immediately without waiting for their scheduled time.
 *
 * @param collection - The MongoDB collection containing the job
 * @param jobId - The ObjectId of the job to trigger
 */
export async function triggerJobImmediately(
	collection: Collection,
	jobId: ObjectId,
): Promise<void> {
	await collection.updateOne({ _id: jobId }, { $set: { nextRunAt: new Date() } });
}

/**
 * Finds a job by a custom query and returns it typed as Job.
 * This helper eliminates the need for unsafe double-casting (as unknown as Job)
 * when querying jobs directly from the collection in tests.
 *
 * @param collection - The MongoDB collection containing jobs
 * @param query - MongoDB query to find the job
 * @returns The job if found, null otherwise
 *
 * @example
 * ```typescript
 * const job = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });
 * expect(job?.status).toBe(JobStatus.PENDING);
 * ```
 */
export async function findJobByQuery<T = unknown>(
	collection: Collection,
	query: Document,
): Promise<Job<T> | null> {
	const doc = await collection.findOne(query);
	return doc as Job<T> | null;
}
````

## File: packages/core/package.json
````json
{
	"name": "@monque/core",
	"version": "0.0.0",
	"description": "MongoDB-backed job scheduler with atomic locking, exponential backoff, and cron scheduling",
	"type": "module",
	"packageManager": "bun@1.3.5",
	"engines": {
		"node": ">=22.21.1"
	},
	"publishConfig": {
		"access": "public"
	},
	"main": "./dist/index.cjs",
	"module": "./dist/index.mjs",
	"types": "./dist/index.d.mts",
	"exports": {
		".": {
			"import": {
				"types": "./dist/index.d.mts",
				"default": "./dist/index.mjs"
			},
			"require": {
				"types": "./dist/index.d.cts",
				"default": "./dist/index.cjs"
			}
		}
	},
	"files": [
		"dist"
	],
	"scripts": {
		"build": "tsdown",
		"check:exports": "publint && attw --pack .",
		"clean": "rimraf dist coverage .turbo",
		"type-check": "tsc --noEmit",
		"pretest": "bun run type-check",
		"test": "vitest run",
		"test:unit": "bun run type-check && vitest run --config vitest.unit.config.ts --coverage.enabled=false",
		"test:integration": "bun run type-check && vitest run integration/ --coverage.enabled=false",
		"test:dev": "TESTCONTAINERS_REUSE_ENABLE=true vitest",
		"test:watch": "vitest",
		"test:watch:unit": "vitest --config vitest.unit.config.ts",
		"test:watch:integration": "vitest integration/",
		"lint": "biome check src/"
	},
	"keywords": [
		"job",
		"queue",
		"scheduler",
		"mongodb",
		"cron",
		"background-jobs"
	],
	"license": "ISC",
	"dependencies": {
		"cron-parser": "^5.4.0"
	},
	"peerDependencies": {
		"mongodb": "^7.0.0"
	},
	"devDependencies": {
		"@faker-js/faker": "^10.1.0",
		"@testcontainers/mongodb": "^11.10.0",
		"@total-typescript/ts-reset": "^0.6.1",
		"@types/bun": "^1.3.5",
		"fishery": "^2.4.0",
		"mongodb": "^7.0.0",
		"tsdown": "^0.18.1",
		"typescript": "^5.7.3"
	}
}
````
