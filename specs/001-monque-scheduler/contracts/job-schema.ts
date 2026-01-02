import type { ObjectId } from 'mongodb';

/**
 * Job status constants using `as const` pattern for type safety and tree-shaking.
 *
 * @example
 * ```typescript
 * if (job.status === JobStatus.PENDING) {
 *   // job is ready to process
 * }
 * ```
 */
export const JobStatus = {
	/** Job is waiting to be processed */
	PENDING: 'pending',
	/** Job is currently being executed by a worker */
	PROCESSING: 'processing',
	/** Job finished successfully */
	COMPLETED: 'completed',
	/** Job permanently failed after max retries */
	FAILED: 'failed',
} as const;

/**
 * Union type of all possible job statuses.
 */
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

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
	status: JobStatus;

	/** When the job should be processed */
	nextRunAt: Date;

	/** Timestamp when job was locked for processing */
	lockedAt?: Date | null;

	/** Timestamp of last worker heartbeat */
	lastHeartbeat?: Date | null;

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
 * Signature for the `now()` convenience method.
 * Enqueues a job for immediate processing (syntactic sugar for enqueue without options).
 *
 * @template T - The type of the job's data payload
 *
 * @example
 * ```typescript
 * // Trigger immediate job execution
 * const job = await monque.now('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 * });
 *
 * // Equivalent to:
 * await monque.enqueue('send-email', data, { runAt: new Date() });
 * ```
 */
export type NowMethod = <T>(name: string, data: T) => Promise<Job<T>>;

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
	 * Interval in milliseconds for updating job heartbeats.
	 * @default 30000
	 */
	heartbeatInterval?: number;

	/**
	 * Tolerance in milliseconds before a job is considered a zombie.
	 * @default 90000
	 */
	heartbeatTolerance?: number;

	/**
	 * Whether to enable zombie job takeover.
	 * @default true
	 */
	enableZombieTakeover?: boolean;

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
}

/**
 * Options for the @Job decorator in @monque/tsed.
 *
 * @example
 * ```typescript
 * @Job({ name: 'send-email' })
 * class SendEmailJob {
 *   async handle(job: Job<EmailJobData>) {
 *     // ...
 *   }
 * }
 * ```
 */
export interface JobDecoratorOptions {
	/** Job type identifier - must match when enqueueing */
	name: string;

	/**
	 * Number of concurrent jobs this worker can process.
	 * @default 5
	 */
	concurrency?: number;
}

/**
 * Configuration options for MonqueModule in @monque/tsed.
 *
 * @example
 * ```typescript
 * // With Mongoose
 * MonqueModule.forRoot({
 *   connection: mongooseConnection,
 * });
 *
 * // With native MongoDB
 * MonqueModule.forRoot({
 *   connection: mongoDb,
 *   collectionName: 'custom_jobs',
 * });
 * ```
 */
export interface MonqueModuleOptions extends MonqueOptions {
	/**
	 * MongoDB connection - can be either a Mongoose Connection or native MongoDB Db instance.
	 */
	connection: unknown;
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
// ============================================================================
// Error Classes
// ============================================================================

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
	constructor(message: string) {
		super(message);
		this.name = 'ConnectionError';
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
	}
}
