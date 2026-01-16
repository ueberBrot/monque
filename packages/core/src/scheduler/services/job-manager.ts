import { ObjectId, type WithId } from 'mongodb';

import { type Job, JobStatus, type PersistedJob } from '@/jobs';
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

		// Fetch job first to allow emitting the full job object in the event
		const jobDoc = await this.ctx.collection.findOne({ _id });
		if (!jobDoc) return false;

		const result = await this.ctx.collection.deleteOne({ _id });

		if (result.deletedCount > 0) {
			this.ctx.emit('job:deleted', { jobId });
			return true;
		}

		return false;
	}
}
