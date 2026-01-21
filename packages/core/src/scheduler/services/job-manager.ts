import { ObjectId, type WithId } from 'mongodb';

import {
	type BulkOperationResult,
	type Job,
	type JobSelector,
	JobStatus,
	type PersistedJob,
} from '@/jobs';
import { buildSelectorQuery } from '@/scheduler';
import { JobStateError } from '@/shared';

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
		const _id = new ObjectId(jobId);

		// Fetch job first to allow emitting the full job object in the event
		const jobDoc = await this.ctx.collection.findOne({ _id });
		if (!jobDoc) return null;

		const currentJob = jobDoc as unknown as WithId<Job>;

		if (currentJob.status === JobStatus.CANCELLED) {
			return this.ctx.documentToPersistedJob(currentJob);
		}

		if (currentJob.status !== JobStatus.PENDING) {
			throw new JobStateError(
				`Cannot cancel job in status '${currentJob.status}'`,
				jobId,
				currentJob.status,
				'cancel',
			);
		}

		const result = await this.ctx.collection.findOneAndUpdate(
			{ _id, status: JobStatus.PENDING },
			{
				$set: {
					status: JobStatus.CANCELLED,
					updatedAt: new Date(),
				},
			},
			{ returnDocument: 'after' },
		);

		if (!result) {
			// Race condition: job changed state between check and update
			throw new JobStateError(
				'Job status changed during cancellation attempt',
				jobId,
				'unknown',
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
		const _id = new ObjectId(jobId);
		const currentJob = await this.ctx.collection.findOne({ _id });

		if (!currentJob) return null;

		if (currentJob['status'] !== JobStatus.FAILED && currentJob['status'] !== JobStatus.CANCELLED) {
			throw new JobStateError(
				`Cannot retry job in status '${currentJob['status']}'`,
				jobId,
				currentJob['status'],
				'retry',
			);
		}

		const previousStatus = currentJob['status'] as 'failed' | 'cancelled';

		const result = await this.ctx.collection.findOneAndUpdate(
			{
				_id,
				status: { $in: [JobStatus.FAILED, JobStatus.CANCELLED] },
			},
			{
				$set: {
					status: JobStatus.PENDING,
					failCount: 0,
					nextRunAt: new Date(),
					updatedAt: new Date(),
				},
				$unset: {
					failReason: '',
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
					heartbeatInterval: '',
				},
			},
			{ returnDocument: 'after' },
		);

		if (!result) {
			throw new JobStateError('Job status changed during retry attempt', jobId, 'unknown', 'retry');
		}

		const job = this.ctx.documentToPersistedJob(result);
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
		const _id = new ObjectId(jobId);
		const currentJobDoc = await this.ctx.collection.findOne({ _id });

		if (!currentJobDoc) return null;

		const currentJob = currentJobDoc as unknown as WithId<Job>;

		if (currentJob.status !== JobStatus.PENDING) {
			throw new JobStateError(
				`Cannot reschedule job in status '${currentJob.status}'`,
				jobId,
				currentJob.status,
				'reschedule',
			);
		}

		const result = await this.ctx.collection.findOneAndUpdate(
			{ _id, status: JobStatus.PENDING },
			{
				$set: {
					nextRunAt: runAt,
					updatedAt: new Date(),
				},
			},
			{ returnDocument: 'after' },
		);

		if (!result) {
			throw new JobStateError(
				'Job status changed during reschedule attempt',
				jobId,
				'unknown',
				'reschedule',
			);
		}

		return this.ctx.documentToPersistedJob(result);
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
	 * Cancel multiple jobs matching the given filter.
	 *
	 * Only cancels jobs in 'pending' status. Jobs in other states are collected
	 * as errors in the result. Emits a 'jobs:cancelled' event with the IDs of
	 * successfully cancelled jobs.
	 *
	 * @param filter - Selector for which jobs to cancel (name, status, date range)
	 * @returns Result with count of cancelled jobs and any errors encountered
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
		const baseQuery = buildSelectorQuery(filter);
		const errors: Array<{ jobId: string; error: string }> = [];
		const cancelledIds: string[] = [];

		// Find all matching jobs and stream them to avoid memory pressure
		const cursor = this.ctx.collection.find(baseQuery);

		for await (const doc of cursor) {
			const job = doc as unknown as WithId<Job>;
			const jobId = job._id.toString();

			if (job.status !== JobStatus.PENDING && job.status !== JobStatus.CANCELLED) {
				errors.push({
					jobId,
					error: `Cannot cancel job in status '${job.status}'`,
				});
				continue;
			}

			// Skip already cancelled jobs (idempotent)
			if (job.status === JobStatus.CANCELLED) {
				cancelledIds.push(jobId);
				continue;
			}

			// Atomically update to cancelled
			const result = await this.ctx.collection.findOneAndUpdate(
				{ _id: job._id, status: JobStatus.PENDING },
				{
					$set: {
						status: JobStatus.CANCELLED,
						updatedAt: new Date(),
					},
				},
				{ returnDocument: 'after' },
			);

			if (result) {
				cancelledIds.push(jobId);
			} else {
				// Race condition: status changed
				errors.push({
					jobId,
					error: 'Job status changed during cancellation',
				});
			}
		}

		if (cancelledIds.length > 0) {
			this.ctx.emit('jobs:cancelled', {
				jobIds: cancelledIds,
				count: cancelledIds.length,
			});
		}

		return {
			count: cancelledIds.length,
			errors,
		};
	}

	/**
	 * Retry multiple jobs matching the given filter.
	 *
	 * Only retries jobs in 'failed' or 'cancelled' status. Jobs in other states
	 * are collected as errors in the result. Emits a 'jobs:retried' event with
	 * the IDs of successfully retried jobs.
	 *
	 * @param filter - Selector for which jobs to retry (name, status, date range)
	 * @returns Result with count of retried jobs and any errors encountered
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
		const baseQuery = buildSelectorQuery(filter);
		const errors: Array<{ jobId: string; error: string }> = [];
		const retriedIds: string[] = [];

		const cursor = this.ctx.collection.find(baseQuery);

		for await (const doc of cursor) {
			const job = doc as unknown as WithId<Job>;
			const jobId = job._id.toString();

			if (job.status !== JobStatus.FAILED && job.status !== JobStatus.CANCELLED) {
				errors.push({
					jobId,
					error: `Cannot retry job in status '${job.status}'`,
				});
				continue;
			}

			const result = await this.ctx.collection.findOneAndUpdate(
				{
					_id: job._id,
					status: { $in: [JobStatus.FAILED, JobStatus.CANCELLED] },
				},
				{
					$set: {
						status: JobStatus.PENDING,
						failCount: 0,
						nextRunAt: new Date(),
						updatedAt: new Date(),
					},
					$unset: {
						failReason: '',
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
						heartbeatInterval: '',
					},
				},
				{ returnDocument: 'after' },
			);

			if (result) {
				retriedIds.push(jobId);
			} else {
				errors.push({
					jobId,
					error: 'Job status changed during retry attempt',
				});
			}
		}

		if (retriedIds.length > 0) {
			this.ctx.emit('jobs:retried', {
				jobIds: retriedIds,
				count: retriedIds.length,
			});
		}

		return {
			count: retriedIds.length,
			errors,
		};
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

		// Use deleteMany for efficiency
		const result = await this.ctx.collection.deleteMany(query);

		if (result.deletedCount > 0) {
			this.ctx.emit('jobs:deleted', { count: result.deletedCount });
		}

		return {
			count: result.deletedCount,
			errors: [],
		};
	}
}
