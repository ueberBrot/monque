import type { ObjectId } from 'mongodb';

/**
 * Represents the lifecycle states of a job in the queue.
 *
 * Jobs transition through states as follows:
 * - PENDING → PROCESSING (when picked up by a worker)
 * - PROCESSING → COMPLETED (on success)
 * - PROCESSING → PENDING (on failure, if retries remain)
 * - PROCESSING → FAILED (on failure, after max retries exhausted)
 * - PENDING → CANCELLED (on manual cancellation)
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
	/** Job was manually cancelled */
	CANCELLED: 'cancelled',
} as const;

/**
 * Union type of all possible job status values: `'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'`
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

/**
 * Valid cursor directions for pagination.
 *
 * @example
 * ```typescript
 * const direction = CursorDirection.FORWARD;
 * ```
 */
export const CursorDirection = {
	FORWARD: 'forward',
	BACKWARD: 'backward',
} as const;

export type CursorDirectionType = (typeof CursorDirection)[keyof typeof CursorDirection];

export const JobCursorSortField = {
	IDENTIFIER: 'identifier',
	CREATED_AT: 'createdAt',
	UPDATED_AT: 'updatedAt',
	NEXT_RUN_AT: 'nextRunAt',
} as const;

export type JobCursorSortFieldType = (typeof JobCursorSortField)[keyof typeof JobCursorSortField];

export const JobCursorSortDirection = {
	ASC: 'asc',
	DESC: 'desc',
} as const;

export type JobCursorSortDirectionType =
	(typeof JobCursorSortDirection)[keyof typeof JobCursorSortDirection];

/**
 * Selector options for bulk operations.
 *
 * Used to select multiple jobs for operations like cancellation or deletion.
 *
 * @example
 * ```typescript
 * // Select all failed jobs older than 7 days
 * const selector: JobSelector = {
 *   status: JobStatus.FAILED,
 *   olderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
 * };
 * ```
 */
export interface JobSelector {
	name?: string;
	status?: JobStatusType | JobStatusType[];
	olderThan?: Date;
	newerThan?: Date;
}

export interface JobCursorFilter {
	name?: string;
	status?: JobStatusType | JobStatusType[];
	createdAtFrom?: Date;
	createdAtTo?: Date;
	updatedAtFrom?: Date;
	updatedAtTo?: Date;
	nextRunAtFrom?: Date;
	nextRunAtTo?: Date;
}

export interface JobCursorSort {
	by: JobCursorSortFieldType;
	direction: JobCursorSortDirectionType;
}

/**
 * Options for cursor-based pagination.
 *
 * @example
 * ```typescript
 * const options: CursorOptions = {
 *   limit: 50,
 *   direction: CursorDirection.FORWARD,
 *   filter: { status: JobStatus.PENDING },
 * };
 * ```
 */
export interface CursorOptions {
	cursor?: string;
	limit?: number;
	direction?: CursorDirectionType;
	filter?: JobCursorFilter;
	sort?: JobCursorSort;
}

/**
 * Response structure for cursor-based pagination.
 *
 * @template T - The type of the job's data payload
 *
 * @example
 * ```typescript
 * const page = await monque.listJobs({ limit: 10 });
 * console.log(`Got ${page.jobs.length} jobs`);
 *
 * if (page.hasNextPage) {
 *   console.log(`Next cursor: ${page.cursor}`);
 * }
 * ```
 */
export interface CursorPage<T = unknown> {
	jobs: PersistedJob<T>[];
	cursor: string | null;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

/**
 * Aggregated statistics for the job queue.
 *
 * @example
 * ```typescript
 * const stats = await monque.getQueueStats();
 * console.log(`Total jobs: ${stats.total}`);
 * console.log(`Pending: ${stats.pending}`);
 * console.log(`Processing: ${stats.processing}`);
 * console.log(`Failed: ${stats.failed}`);
 * console.log(`Start to finish avg: ${stats.avgProcessingDurationMs}ms`);
 * ```
 */
export interface QueueStats {
	pending: number;
	processing: number;
	completed: number;
	failed: number;
	cancelled: number;
	total: number;
	avgProcessingDurationMs?: number;
}

/**
 * Local Worker observability exposed through Queue View summaries.
 *
 * This is an immutable snapshot of public counts and limits. It intentionally
 * excludes the Worker handler, active Job ids, and internal Worker maps.
 */
export interface QueueViewWorkerSummary {
	/** Maximum concurrent jobs this local Worker can process */
	readonly concurrency: number;

	/** Number of jobs currently active in this local Worker */
	readonly activeCount: number;
}

/**
 * Operator-facing summary for one Job Name.
 *
 * A Queue View is derived from persisted Jobs and registered Workers; it is not
 * a persisted queue entity.
 */
export interface QueueViewSummary {
	/** Job Name represented by this Queue View */
	readonly name: string;

	/** Whether at least one persisted Job exists for this Job Name */
	readonly hasPersistedJobs: boolean;

	/** Whether this scheduler instance has a local Worker registered for this Job Name */
	readonly hasRegisteredWorker: boolean;

	/** Aggregated persisted Job statistics for this Job Name */
	readonly stats: Readonly<QueueStats>;

	/** Local Worker observability, or null when no local Worker is registered */
	readonly worker: Readonly<QueueViewWorkerSummary> | null;
}

/**
 * Result of a bulk operation.
 *
 * @example
 * ```typescript
 * const result = await monque.cancelJobs(selector);
 * console.log(`Cancelled ${result.count} jobs`);
 *
 * if (result.errors.length > 0) {
 *   console.warn('Some jobs could not be cancelled:', result.errors);
 * }
 * ```
 */
export interface BulkOperationResult {
	count: number;
	errors: Array<{ jobId: string; error: string }>;
}
