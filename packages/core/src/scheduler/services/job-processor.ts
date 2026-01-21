import { isPersistedJob, type Job, JobStatus, type PersistedJob } from '@/jobs';
import { calculateBackoff, getNextCronDate } from '@/shared';
import type { WorkerRegistration } from '@/workers';

import type { SchedulerContext } from './types.js';

/**
 * Internal service for job processing and execution.
 *
 * Manages the poll loop, atomic job acquisition, handler execution,
 * and job completion/failure with exponential backoff retry logic.
 *
 * @internal Not part of public API.
 */
export class JobProcessor {
	constructor(private readonly ctx: SchedulerContext) {}

	/**
	 * Poll for available jobs and process them.
	 *
	 * Called at regular intervals (configured by `pollInterval`). For each registered worker,
	 * attempts to acquire jobs up to the worker's available concurrency slots.
	 * Aborts early if the scheduler is stopping (`isRunning` is false).
	 */
	async poll(): Promise<void> {
		if (!this.ctx.isRunning()) {
			return;
		}

		for (const [name, worker] of this.ctx.workers) {
			// Check if worker has capacity
			const availableSlots = worker.concurrency - worker.activeJobs.size;

			if (availableSlots <= 0) {
				continue;
			}

			// Try to acquire jobs up to available slots
			for (let i = 0; i < availableSlots; i++) {
				if (!this.ctx.isRunning()) {
					return;
				}
				const job = await this.acquireJob(name);

				if (job) {
					this.processJob(job, worker).catch((error: unknown) => {
						this.ctx.emit('job:error', { error: error as Error, job });
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
	 * Returns `null` immediately if scheduler is stopping (`isRunning` is false).
	 *
	 * @param name - The job type to acquire
	 * @returns The acquired job with updated status, claimedBy, and heartbeat info, or `null` if no jobs available
	 */
	async acquireJob(name: string): Promise<PersistedJob | null> {
		if (!this.ctx.isRunning()) {
			return null;
		}

		const now = new Date();

		const result = await this.ctx.collection.findOneAndUpdate(
			{
				name,
				status: JobStatus.PENDING,
				nextRunAt: { $lte: now },
				$or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
			},
			{
				$set: {
					status: JobStatus.PROCESSING,
					claimedBy: this.ctx.instanceId,
					lockedAt: now,
					lastHeartbeat: now,
					heartbeatInterval: this.ctx.options.heartbeatInterval,
					updatedAt: now,
				},
			},
			{
				sort: { nextRunAt: 1 },
				returnDocument: 'after',
			},
		);

		if (!this.ctx.isRunning()) {
			return null;
		}

		if (!result) {
			return null;
		}

		return this.ctx.documentToPersistedJob(result);
	}

	/**
	 * Execute a job using its registered worker handler.
	 *
	 * Tracks the job as active during processing, emits lifecycle events, and handles
	 * both success and failure cases. On success, calls `completeJob()`. On failure,
	 * calls `failJob()` which implements exponential backoff retry logic.
	 *
	 * @param job - The job to process
	 * @param worker - The worker registration containing the handler and active job tracking
	 */
	async processJob(job: PersistedJob, worker: WorkerRegistration): Promise<void> {
		const jobId = job._id.toString();
		worker.activeJobs.set(jobId, job);

		const startTime = Date.now();
		this.ctx.emit('job:start', job);

		try {
			await worker.handler(job);

			// Job completed successfully
			const duration = Date.now() - startTime;
			await this.completeJob(job);
			this.ctx.emit('job:complete', { job, duration });
		} catch (error) {
			// Job failed
			const err = error instanceof Error ? error : new Error(String(error));
			await this.failJob(job, err);

			const willRetry = job.failCount + 1 < this.ctx.options.maxRetries;
			this.ctx.emit('job:fail', { job, error: err, willRetry });
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
	 * @param job - The job that completed successfully
	 */
	async completeJob(job: Job): Promise<void> {
		if (!isPersistedJob(job)) {
			return;
		}

		if (job.repeatInterval) {
			// Recurring job - schedule next run
			const nextRunAt = getNextCronDate(job.repeatInterval);
			await this.ctx.collection.updateOne(
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
			await this.ctx.collection.updateOne(
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
	 * @param job - The job that failed
	 * @param error - The error that caused the failure
	 */
	async failJob(job: Job, error: Error): Promise<void> {
		if (!isPersistedJob(job)) {
			return;
		}

		const newFailCount = job.failCount + 1;

		if (newFailCount >= this.ctx.options.maxRetries) {
			// Permanent failure
			await this.ctx.collection.updateOne(
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
				this.ctx.options.baseRetryInterval,
				this.ctx.options.maxBackoffDelay,
			);

			await this.ctx.collection.updateOne(
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
	 * Update heartbeats for all jobs claimed by this scheduler instance.
	 *
	 * This method runs periodically while the scheduler is running to indicate
	 * that jobs are still being actively processed.
	 *
	 * `lastHeartbeat` is primarily an observability signal (monitoring/debugging).
	 * Stale recovery is based on `lockedAt` + `lockTimeout`.
	 */
	async updateHeartbeats(): Promise<void> {
		if (!this.ctx.isRunning()) {
			return;
		}

		const now = new Date();

		await this.ctx.collection.updateMany(
			{
				claimedBy: this.ctx.instanceId,
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
}
