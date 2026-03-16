import { ObjectId } from 'mongodb';

import { type BulkOperationResult, type JobSelector, JobStatus, type PersistedJob } from '@/jobs';
import { buildSelectorQuery } from '@/scheduler';
import { ConnectionError, JobStateError, MonqueError } from '@/shared';

import type { SchedulerContext } from './types.js';

/**
 * Internal service for job lifecycle management operations.
 *
 * Provides atomic state transitions (cancel, retry, reschedule) and deletion.
 * Emits appropriate events on each operation.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobManager {
	constructor(private readonly ctx: SchedulerContext) {}

	/**
	 * Cancel a pending or scheduled job.
	 *
	 * Sets the job status to 'cancelled' and emits a 'job:cancelled' event.
	 * If the job is already cancelled, this is a no-op and returns the job.
	 * Cannot cancel jobs that are currently 'processing', 'completed', or 'failed'.
	 *
	 * @param jobId - The ID of the job to cancel
	 * @returns The cancelled job, or null if not found
	 * @throws {JobStateError} If job is in an invalid state for cancellation
	 *
	 * @example Cancel a pending job
	 * ```typescript
	 * const job = await monque.enqueue('report', { type: 'daily' });
	 * await monque.cancelJob(job._id.toString());
	 * ```
	 */
	async cancelJob(jobId: string): Promise<PersistedJob<unknown> | null> {
		if (!ObjectId.isValid(jobId)) return null;

		const _id = new ObjectId(jobId);

		const now = new Date();
		const result = await this.ctx.collection.findOneAndUpdate(
			{ _id, status: JobStatus.PENDING },
			{
				$set: {
					status: JobStatus.CANCELLED,
					updatedAt: now,
				},
			},
			{ returnDocument: 'after' },
		);

		if (!result) {
			// Distinguish not-found vs wrong-state with a single findOne
			const jobDoc = await this.ctx.collection.findOne({ _id });
			if (!jobDoc) return null;

			if (jobDoc['status'] === JobStatus.CANCELLED) {
				return this.ctx.documentToPersistedJob(jobDoc);
			}

			throw new JobStateError(
				`Cannot cancel job in status '${jobDoc['status']}'`,
				jobId,
				jobDoc['status'],
				'cancel',
			);
		}

		const job = this.ctx.documentToPersistedJob(result);
		this.ctx.emit('job:cancelled', { job });
		return job;
	}

	/**
	 * Retry a failed or cancelled job.
	 *
	 * Resets the job to 'pending' status, clears failure count/reason, and sets
	 * nextRunAt to now (immediate retry). Emits a 'job:retried' event.
	 *
	 * @param jobId - The ID of the job to retry
	 * @returns The updated job, or null if not found
	 * @throws {JobStateError} If job is in an invalid state for retry (must be failed or cancelled)
	 *
	 * @example Retry a failed job
	 * ```typescript
	 * monque.on('job:fail', async ({ job }) => {
	 *   console.log(`Job ${job._id} failed, retrying manually...`);
	 *   await monque.retryJob(job._id.toString());
	 * });
	 * ```
	 */
	async retryJob(jobId: string): Promise<PersistedJob<unknown> | null> {
		if (!ObjectId.isValid(jobId)) return null;

		const _id = new ObjectId(jobId);

		const now = new Date();
		const result = await this.ctx.collection.findOneAndUpdate(
			{
				_id,
				status: { $in: [JobStatus.FAILED, JobStatus.CANCELLED] },
			},
			{
				$set: {
					status: JobStatus.PENDING,
					failCount: 0,
					nextRunAt: now,
					updatedAt: now,
				},
				$unset: {
					failReason: '',
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
				},
			},
			{ returnDocument: 'before' },
		);

		if (!result) {
			const currentJob = await this.ctx.collection.findOne({ _id });
			if (!currentJob) return null;

			throw new JobStateError(
				`Cannot retry job in status '${currentJob['status']}'`,
				jobId,
				currentJob['status'],
				'retry',
			);
		}

		const previousStatus = result['status'] as 'failed' | 'cancelled';

		const updatedDoc = { ...result };
		updatedDoc['status'] = JobStatus.PENDING;
		updatedDoc['failCount'] = 0;
		updatedDoc['nextRunAt'] = now;
		updatedDoc['updatedAt'] = now;
		delete updatedDoc['failReason'];
		delete updatedDoc['lockedAt'];
		delete updatedDoc['claimedBy'];
		delete updatedDoc['lastHeartbeat'];

		const job = this.ctx.documentToPersistedJob(updatedDoc);
		this.ctx.notifyPendingJob(job.name, job.nextRunAt);
		this.ctx.emit('job:retried', { job, previousStatus });
		return job;
	}

	/**
	 * Reschedule a pending job to run at a different time.
	 *
	 * Only works for jobs in 'pending' status.
	 *
	 * @param jobId - The ID of the job to reschedule
	 * @param runAt - The new Date when the job should run
	 * @returns The updated job, or null if not found
	 * @throws {JobStateError} If job is not in pending state
	 *
	 * @example Delay a job by 1 hour
	 * ```typescript
	 * const nextHour = new Date(Date.now() + 60 * 60 * 1000);
	 * await monque.rescheduleJob(jobId, nextHour);
	 * ```
	 */
	async rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null> {
		if (!ObjectId.isValid(jobId)) return null;

		const _id = new ObjectId(jobId);

		const now = new Date();
		const result = await this.ctx.collection.findOneAndUpdate(
			{ _id, status: JobStatus.PENDING },
			{
				$set: {
					nextRunAt: runAt,
					updatedAt: now,
				},
			},
			{ returnDocument: 'after' },
		);

		if (!result) {
			const currentJobDoc = await this.ctx.collection.findOne({ _id });
			if (!currentJobDoc) return null;

			throw new JobStateError(
				`Cannot reschedule job in status '${currentJobDoc['status']}'`,
				jobId,
				currentJobDoc['status'],
				'reschedule',
			);
		}

		const job = this.ctx.documentToPersistedJob(result);
		this.ctx.notifyPendingJob(job.name, job.nextRunAt);
		return job;
	}

	/**
	 * Permanently delete a job.
	 *
	 * This action is irreversible. Emits a 'job:deleted' event upon success.
	 * Can delete a job in any state.
	 *
	 * @param jobId - The ID of the job to delete
	 * @returns true if deleted, false if job not found
	 *
	 * @example Delete a cleanup job
	 * ```typescript
	 * const deleted = await monque.deleteJob(jobId);
	 * if (deleted) {
	 *   console.log('Job permanently removed');
	 * }
	 * ```
	 */
	async deleteJob(jobId: string): Promise<boolean> {
		if (!ObjectId.isValid(jobId)) return false;

		const _id = new ObjectId(jobId);

		const result = await this.ctx.collection.deleteOne({ _id });

		if (result.deletedCount > 0) {
			this.ctx.emit('job:deleted', { jobId });
			return true;
		}

		return false;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Bulk Operations
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Cancel multiple jobs matching the given filter via a single updateMany call.
	 *
	 * Only cancels jobs in 'pending' status — the status guard is applied regardless
	 * of what the filter specifies. Jobs in other states are silently skipped (not
	 * matched by the query). Emits a 'jobs:cancelled' event with the count of
	 * successfully cancelled jobs.
	 *
	 * @param filter - Selector for which jobs to cancel (name, status, date range)
	 * @returns Result with count of cancelled jobs (errors array always empty for bulk ops)
	 *
	 * @example Cancel all pending jobs for a queue
	 * ```typescript
	 * const result = await monque.cancelJobs({
	 *   name: 'email-queue',
	 *   status: 'pending'
	 * });
	 * console.log(`Cancelled ${result.count} jobs`);
	 * ```
	 */
	async cancelJobs(filter: JobSelector): Promise<BulkOperationResult> {
		const query = buildSelectorQuery(filter);

		// Enforce allowed status, but respect explicit status filters
		if (filter.status !== undefined) {
			const requested = Array.isArray(filter.status) ? filter.status : [filter.status];
			if (!requested.includes(JobStatus.PENDING)) {
				return { count: 0, errors: [] };
			}
		}
		query['status'] = JobStatus.PENDING;

		try {
			const now = new Date();
			const result = await this.ctx.collection.updateMany(query, {
				$set: {
					status: JobStatus.CANCELLED,
					updatedAt: now,
				},
			});

			const count = result.modifiedCount;

			if (count > 0) {
				this.ctx.emit('jobs:cancelled', { count });
			}

			return { count, errors: [] };
		} catch (error) {
			if (error instanceof MonqueError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error during cancelJobs';
			throw new ConnectionError(
				`Failed to cancel jobs: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Retry multiple jobs matching the given filter via a single pipeline-style updateMany call.
	 *
	 * Only retries jobs in 'failed' or 'cancelled' status — the status guard is applied
	 * regardless of what the filter specifies. Jobs in other states are silently skipped.
	 * Uses `$rand` for per-document staggered `nextRunAt` to avoid thundering herd on retry.
	 * Emits a 'jobs:retried' event with the count of successfully retried jobs.
	 *
	 * @param filter - Selector for which jobs to retry (name, status, date range)
	 * @returns Result with count of retried jobs (errors array always empty for bulk ops)
	 *
	 * @example Retry all failed jobs
	 * ```typescript
	 * const result = await monque.retryJobs({
	 *   status: 'failed'
	 * });
	 * console.log(`Retried ${result.count} jobs`);
	 * ```
	 */
	async retryJobs(filter: JobSelector): Promise<BulkOperationResult> {
		const query = buildSelectorQuery(filter);

		// Enforce allowed statuses, but respect explicit status filters
		const retryable = [JobStatus.FAILED, JobStatus.CANCELLED] as const;
		if (filter.status !== undefined) {
			const requested = Array.isArray(filter.status) ? filter.status : [filter.status];
			const allowed = requested.filter(
				(status): status is (typeof retryable)[number] =>
					status === JobStatus.FAILED || status === JobStatus.CANCELLED,
			);
			if (allowed.length === 0) {
				return { count: 0, errors: [] };
			}
			query['status'] = allowed.length === 1 ? allowed[0] : { $in: allowed };
		} else {
			query['status'] = { $in: retryable };
		}

		const spreadWindowMs = 30_000; // 30s max spread for staggered retry

		try {
			const now = new Date();
			const result = await this.ctx.collection.updateMany(query, [
				{
					$set: {
						status: JobStatus.PENDING,
						failCount: 0,
						nextRunAt: {
							$add: [now, { $multiply: [{ $rand: {} }, spreadWindowMs] }],
						},
						updatedAt: now,
					},
				},
				{
					$unset: ['failReason', 'lockedAt', 'claimedBy', 'lastHeartbeat'],
				},
			]);

			const count = result.modifiedCount;

			if (count > 0) {
				this.ctx.emit('jobs:retried', { count });
			}

			return { count, errors: [] };
		} catch (error) {
			if (error instanceof MonqueError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error during retryJobs';
			throw new ConnectionError(
				`Failed to retry jobs: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Delete multiple jobs matching the given filter.
	 *
	 * Deletes jobs in any status. Uses a batch delete for efficiency.
	 * Emits a 'jobs:deleted' event with the count of deleted jobs.
	 * Does not emit individual 'job:deleted' events to avoid noise.
	 *
	 * @param filter - Selector for which jobs to delete (name, status, date range)
	 * @returns Result with count of deleted jobs (errors array always empty for delete)
	 *
	 * @example Delete old completed jobs
	 * ```typescript
	 * const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	 * const result = await monque.deleteJobs({
	 *   status: 'completed',
	 *   olderThan: weekAgo
	 * });
	 * console.log(`Deleted ${result.count} jobs`);
	 * ```
	 */
	async deleteJobs(filter: JobSelector): Promise<BulkOperationResult> {
		const query = buildSelectorQuery(filter);

		try {
			// Use deleteMany for efficiency
			const result = await this.ctx.collection.deleteMany(query);

			if (result.deletedCount > 0) {
				this.ctx.emit('jobs:deleted', { count: result.deletedCount });
			}

			return {
				count: result.deletedCount,
				errors: [],
			};
		} catch (error) {
			if (error instanceof MonqueError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error during deleteJobs';
			throw new ConnectionError(
				`Failed to delete jobs: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}
}
