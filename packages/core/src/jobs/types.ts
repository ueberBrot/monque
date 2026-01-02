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
