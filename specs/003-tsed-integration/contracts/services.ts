/**
 * @monque/tsed - Service Contracts
 *
 * Defines the public API for MonqueService.
 */

import type {
	BulkOperationResult,
	CursorOptions,
	CursorPage,
	EnqueueOptions,
	GetJobsFilter,
	JobSelector,
	Monque,
	PersistedJob,
	QueueStats,
	ScheduleOptions,
} from '@monque/core';
import type { ObjectId } from 'mongodb';

// ─────────────────────────────────────────────────────────────────────────────
// MonqueService Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable service that provides programmatic access to job queue operations.
 *
 * Wraps the underlying Monque instance and exposes its full public API for use
 * within Ts.ED services and controllers.
 *
 * @example
 * ```typescript
 * @Service()
 * export class OrderService {
 *   @Inject()
 *   private monque: MonqueService;
 *
 *   async createOrder(data: CreateOrderDto) {
 *     const order = await this.save(data);
 *     await this.monque.enqueue("order.process", { orderId: order.id });
 *     return order;
 *   }
 * }
 * ```
 */
export interface IMonqueService {
	// ─────────────────────────────────────────────────────────────────────────────
	// Monque Instance Access
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Access the underlying Monque instance.
	 *
	 * @throws Error if MonqueModule is not initialized.
	 */
	readonly monque: Monque;

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Scheduling
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Enqueue a job for processing.
	 *
	 * Jobs are stored in MongoDB and processed by registered workers.
	 * Supports delayed execution via `runAt` and deduplication via `uniqueKey`.
	 *
	 * @param name - Job type identifier (use full namespaced name, e.g., "email.send")
	 * @param data - Job payload
	 * @param options - Scheduling and deduplication options
	 * @returns The created or existing job document
	 */
	enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<PersistedJob<T>>;

	/**
	 * Enqueue a job for immediate processing.
	 *
	 * Convenience method equivalent to `enqueue(name, data, { runAt: new Date() })`.
	 *
	 * @param name - Job type identifier
	 * @param data - Job payload
	 * @returns The created job document
	 */
	now<T>(name: string, data: T): Promise<PersistedJob<T>>;

	/**
	 * Schedule a recurring job with a cron expression.
	 *
	 * Creates a job that automatically re-schedules itself based on the cron pattern.
	 *
	 * @param cron - Cron expression (5-field standard or predefined like @daily)
	 * @param name - Job type identifier
	 * @param data - Job payload
	 * @param options - Scheduling options
	 * @returns The created job document
	 */
	schedule<T>(
		cron: string,
		name: string,
		data: T,
		options?: ScheduleOptions,
	): Promise<PersistedJob<T>>;

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Management (Single Job Operations)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Cancel a pending or scheduled job.
	 *
	 * Sets the job status to 'cancelled'. Cannot cancel jobs that are
	 * currently 'processing', 'completed', or 'failed'.
	 *
	 * @param jobId - The ID of the job to cancel
	 * @returns The cancelled job, or null if not found
	 * @throws {JobStateError} If job is in an invalid state for cancellation
	 */
	cancelJob(jobId: string): Promise<PersistedJob<unknown> | null>;

	/**
	 * Retry a failed or cancelled job.
	 *
	 * Resets the job to 'pending' status, clears failure count/reason,
	 * and sets nextRunAt to now (immediate retry).
	 *
	 * @param jobId - The ID of the job to retry
	 * @returns The updated job, or null if not found
	 * @throws {JobStateError} If job is not in failed or cancelled state
	 */
	retryJob(jobId: string): Promise<PersistedJob<unknown> | null>;

	/**
	 * Reschedule a pending job to run at a different time.
	 *
	 * Only works for jobs in 'pending' status.
	 *
	 * @param jobId - The ID of the job to reschedule
	 * @param runAt - The new Date when the job should run
	 * @returns The updated job, or null if not found
	 * @throws {JobStateError} If job is not in pending state
	 */
	rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null>;

	/**
	 * Permanently delete a job.
	 *
	 * This action is irreversible. Can delete a job in any state.
	 *
	 * @param jobId - The ID of the job to delete
	 * @returns true if deleted, false if job not found
	 */
	deleteJob(jobId: string): Promise<boolean>;

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Management (Bulk Operations)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Cancel multiple jobs matching the given filter.
	 *
	 * Only cancels jobs in 'pending' status.
	 *
	 * @param filter - Selector for which jobs to cancel
	 * @returns Result with count of cancelled jobs and any errors
	 */
	cancelJobs(filter: JobSelector): Promise<BulkOperationResult>;

	/**
	 * Retry multiple jobs matching the given filter.
	 *
	 * Only retries jobs in 'failed' or 'cancelled' status.
	 *
	 * @param filter - Selector for which jobs to retry
	 * @returns Result with count of retried jobs and any errors
	 */
	retryJobs(filter: JobSelector): Promise<BulkOperationResult>;

	/**
	 * Delete multiple jobs matching the given filter.
	 *
	 * Deletes jobs in any status.
	 *
	 * @param filter - Selector for which jobs to delete
	 * @returns Result with count of deleted jobs
	 */
	deleteJobs(filter: JobSelector): Promise<BulkOperationResult>;

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Queries
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Get a job by its ID.
	 *
	 * @param jobId - The job's ObjectId (as string or ObjectId)
	 * @returns The job document, or null if not found
	 */
	getJob<T>(jobId: string | ObjectId): Promise<PersistedJob<T> | null>;

	/**
	 * Query jobs from the queue with optional filters.
	 *
	 * @param filter - Optional filter criteria (name, status, limit, skip)
	 * @returns Array of matching jobs
	 */
	getJobs<T>(filter?: GetJobsFilter): Promise<PersistedJob<T>[]>;

	/**
	 * Get a paginated list of jobs using opaque cursors.
	 *
	 * Provides stable pagination for large job lists.
	 *
	 * @param options - Pagination options (cursor, limit, direction, filter)
	 * @returns Page of jobs with next/prev cursors
	 * @throws {InvalidCursorError} If the provided cursor is malformed
	 */
	getJobsWithCursor<T>(options?: CursorOptions): Promise<CursorPage<T>>;

	/**
	 * Get aggregate statistics for the job queue.
	 *
	 * Returns counts per status and average processing duration.
	 *
	 * @param filter - Optional filter to scope statistics by job name
	 * @returns Queue statistics
	 */
	getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats>;

	// ─────────────────────────────────────────────────────────────────────────────
	// Health Check
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Check if the scheduler is healthy and running.
	 *
	 * @returns true if running and connected
	 */
	isHealthy(): boolean;
}
