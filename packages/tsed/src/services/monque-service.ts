/**
 * MonqueService - Injectable wrapper for Monque
 *
 * Provides a DI-friendly interface to the Monque job queue.
 * All methods delegate to the underlying Monque instance.
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
import { MonqueError } from '@monque/core';
import { Injectable } from '@tsed/di';
import { ObjectId } from 'mongodb';

/**
 * Injectable service that wraps the Monque instance.
 *
 * Exposes the full Monque public API through dependency injection.
 */
@Injectable()
export class MonqueService {
	/**
	 * Internal Monque instance (set by MonqueModule)
	 * @internal
	 */
	private _monque: Monque | null = null;

	/**
	 * Set the internal Monque instance.
	 * Called by MonqueModule during initialization.
	 * @internal
	 */
	_setMonque(monque: Monque): void {
		this._monque = monque;
	}

	/**
	 * Access the underlying Monque instance.
	 * @throws Error if MonqueModule is not initialized
	 */
	get monque(): Monque {
		if (!this._monque) {
			throw new MonqueError(
				'MonqueService is not initialized. Ensure MonqueModule is imported and enabled.',
			);
		}

		return this._monque;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Scheduling
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Enqueue a job for processing.
	 *
	 * @param name - Job type identifier (use full namespaced name, e.g., "email.send")
	 * @param data - Job payload
	 * @param options - Scheduling and deduplication options
	 * @returns The created or existing job document
	 */
	async enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<PersistedJob<T>> {
		return this.monque.enqueue(name, data, options);
	}

	/**
	 * Enqueue a job for immediate processing.
	 *
	 * @param name - Job type identifier
	 * @param data - Job payload
	 * @returns The created job document
	 */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		return this.monque.now(name, data);
	}

	/**
	 * Schedule a recurring job with a cron expression.
	 *
	 * @param cron - Cron expression (5-field standard or predefined like @daily)
	 * @param name - Job type identifier
	 * @param data - Job payload
	 * @param options - Scheduling options
	 * @returns The created job document
	 */
	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options?: ScheduleOptions,
	): Promise<PersistedJob<T>> {
		return this.monque.schedule(cron, name, data, options);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Management (Single Job Operations)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Cancel a pending or scheduled job.
	 *
	 * @param jobId - The ID of the job to cancel
	 * @returns The cancelled job, or null if not found
	 */
	async cancelJob(jobId: string): Promise<PersistedJob<unknown> | null> {
		return this.monque.cancelJob(jobId);
	}

	/**
	 * Retry a failed or cancelled job.
	 *
	 * @param jobId - The ID of the job to retry
	 * @returns The updated job, or null if not found
	 */
	async retryJob(jobId: string): Promise<PersistedJob<unknown> | null> {
		return this.monque.retryJob(jobId);
	}

	/**
	 * Reschedule a pending job to run at a different time.
	 *
	 * @param jobId - The ID of the job to reschedule
	 * @param runAt - The new Date when the job should run
	 * @returns The updated job, or null if not found
	 */
	async rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null> {
		return this.monque.rescheduleJob(jobId, runAt);
	}

	/**
	 * Permanently delete a job.
	 *
	 * @param jobId - The ID of the job to delete
	 * @returns true if deleted, false if job not found
	 */
	async deleteJob(jobId: string): Promise<boolean> {
		return this.monque.deleteJob(jobId);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Management (Bulk Operations)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Cancel multiple jobs matching the given filter.
	 *
	 * @param filter - Selector for which jobs to cancel
	 * @returns Result with count of cancelled jobs
	 */
	async cancelJobs(filter: JobSelector): Promise<BulkOperationResult> {
		return this.monque.cancelJobs(filter);
	}

	/**
	 * Retry multiple jobs matching the given filter.
	 *
	 * @param filter - Selector for which jobs to retry
	 * @returns Result with count of retried jobs
	 */
	async retryJobs(filter: JobSelector): Promise<BulkOperationResult> {
		return this.monque.retryJobs(filter);
	}

	/**
	 * Delete multiple jobs matching the given filter.
	 *
	 * @param filter - Selector for which jobs to delete
	 * @returns Result with count of deleted jobs
	 */
	async deleteJobs(filter: JobSelector): Promise<BulkOperationResult> {
		return this.monque.deleteJobs(filter);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Job Queries
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Get a job by its ID.
	 *
	 * @param jobId - The job's ObjectId (as string or ObjectId)
	 * @returns The job document, or null if not found
	 */
	async getJob<T>(jobId: string | ObjectId): Promise<PersistedJob<T> | null> {
		const id = typeof jobId === 'string' ? ObjectId.createFromHexString(jobId) : jobId;
		return this.monque.getJob(id);
	}

	/**
	 * Query jobs from the queue with optional filters.
	 *
	 * @param filter - Optional filter criteria (name, status, limit, skip)
	 * @returns Array of matching jobs
	 */
	async getJobs<T>(filter?: GetJobsFilter): Promise<PersistedJob<T>[]> {
		return this.monque.getJobs(filter);
	}

	/**
	 * Get a paginated list of jobs using opaque cursors.
	 *
	 * @param options - Pagination options (cursor, limit, direction, filter)
	 * @returns Page of jobs with next/prev cursors
	 */
	async getJobsWithCursor<T>(options?: CursorOptions): Promise<CursorPage<T>> {
		return this.monque.getJobsWithCursor(options);
	}

	/**
	 * Get aggregate statistics for the job queue.
	 *
	 * @param filter - Optional filter to scope statistics by job name
	 * @returns Queue statistics
	 */
	async getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats> {
		return this.monque.getQueueStats(filter);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Health Check
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Check if the scheduler is healthy and running.
	 *
	 * @returns true if running and connected
	 */
	isHealthy(): boolean {
		return this.monque.isHealthy();
	}
}
