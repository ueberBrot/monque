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
 * await monque.schedule('0 * * * *', 'hourly-cleanup', { dir: '/tmp' }, {
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
	 * @default 1800000 (30 minutes)
	 */
	lockTimeout?: number;

	/**
	 * Whether to recover stale processing jobs on scheduler startup.
	 * When true, jobs with lockedAt older than lockTimeout will be reset to pending.
	 * @default true
	 */
	recoverStaleJobs?: boolean;
}

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
}

/**
 * Public API interface for the Monque scheduler.
 * Defines all public methods available on a Monque instance.
 *
 * @example
 * ```typescript
 * const monque: MonquePublicAPI = new Monque(db, options);
 *
 * // Enqueue a job
 * const job = await monque.enqueue('send-email', { to: 'user@example.com' });
 *
 * // Register a worker
 * monque.worker('send-email', async (job) => {
 *   await sendEmail(job.data.to);
 * });
 *
 * // Start processing
 * monque.start();
 * ```
 */
export interface MonquePublicAPI {
	/**
	 * Enqueue a job for processing.
	 * @param name - Job type identifier
	 * @param data - Job payload data
	 * @param options - Enqueueing options
	 * @returns The created job document, or existing job if duplicate uniqueKey
	 */
	enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<PersistedJob<T>>;

	/**
	 * Enqueue a job for immediate processing (syntactic sugar).
	 * @param name - Job type identifier
	 * @param data - Job payload data
	 * @returns The created job document
	 */
	now<T>(name: string, data: T): Promise<PersistedJob<T>>;

	/**
	 * Schedule a recurring job with a cron expression.
	 * @param cron - Cron expression (5-field format)
	 * @param name - Job type identifier
	 * @param data - Job payload data
	 * @param options - Scheduling options (uniqueKey for deduplication)
	 * @returns The created job document, or existing job if duplicate uniqueKey
	 */
	schedule<T>(
		cron: string,
		name: string,
		data: T,
		options?: ScheduleOptions,
	): Promise<PersistedJob<T>>;

	/**
	 * Register a worker to process jobs of a specific type.
	 * @param name - Job type identifier to handle
	 * @param handler - Function to process jobs
	 * @param options - Worker configuration options
	 */
	worker<T>(name: string, handler: JobHandler<T>, options?: WorkerOptions): void;

	/**
	 * Start polling for and processing jobs.
	 */
	start(): void;

	/**
	 * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
	 * @returns Promise that resolves when shutdown is complete
	 */
	stop(): Promise<void>;

	/**
	 * Check if the scheduler is healthy (running and connected).
	 * @returns true if scheduler is running and database connection is active
	 */
	isHealthy(): boolean;
}
