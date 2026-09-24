import { JobStatus, type PersistedJob } from '@/jobs';
import { toError } from '@/shared';
import type { WorkerRegistration } from '@/workers';

import { JobLifecycle } from './job-lifecycle.js';
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
	/** Guard flag to prevent concurrent poll() execution */
	private _isPolling = false;

	/** Flag to request a re-poll after the current poll finishes */
	private _repollRequested = false;

	/**
	 * O(1) counter tracking the total number of active jobs across all workers.
	 *
	 * Incremented when a job is added to `worker.activeJobs` in `_doPoll`,
	 * decremented in the `processJob` finally block. Used for instance-level throttling.
	 */
	private _totalActiveJobs = 0;

	private readonly lifecycle: JobLifecycle;

	constructor(
		private readonly ctx: SchedulerContext,
		lifecycle?: JobLifecycle,
	) {
		this.lifecycle = lifecycle ?? new JobLifecycle(ctx);
	}

	/**
	 * Get the number of available slots considering the global instanceConcurrency limit.
	 *
	 * @param workerAvailableSlots - Available slots for the specific worker
	 * @returns Number of slots available after applying global limit
	 */
	private getGloballyAvailableSlots(workerAvailableSlots: number): number {
		const { instanceConcurrency } = this.ctx.options;

		if (instanceConcurrency === undefined) {
			return workerAvailableSlots;
		}

		const globalAvailable = instanceConcurrency - this._totalActiveJobs;

		return Math.min(workerAvailableSlots, globalAvailable);
	}

	/**
	 * Poll for available jobs and process them.
	 *
	 * Called at regular intervals (configured by `pollInterval`). For each registered worker,
	 * attempts to acquire jobs up to the worker's available concurrency slots.
	 * Aborts early if the scheduler is stopping (`isRunning` is false) or if
	 * the instance-level `instanceConcurrency` limit is reached.
	 *
	 * If a poll is requested while one is already running, it is queued and
	 * executed as a full poll after the current one finishes. This prevents
	 * change-stream-triggered polls from being silently dropped.
	 *
	 * @param targetNames - Optional set of worker names to poll. When provided, only the
	 * specified workers are checked. Used by change stream handler for targeted polling.
	 */
	async poll(targetNames?: ReadonlySet<string>): Promise<void> {
		if (!this.ctx.isRunning()) {
			return;
		}

		if (this._isPolling) {
			// Queue a re-poll so work discovered during this poll isn't missed
			this._repollRequested = true;
			return;
		}

		this._isPolling = true;

		try {
			do {
				this._repollRequested = false;
				await this._doPoll(targetNames);
				// Re-polls are always full polls to catch all pending work
				targetNames = undefined;
			} while (this._repollRequested && this.ctx.isRunning());
		} finally {
			this._isPolling = false;
		}
	}

	/**
	 * Internal poll implementation.
	 */
	private async _doPoll(targetNames?: ReadonlySet<string>): Promise<void> {
		// Early exit if global instanceConcurrency is reached
		const { instanceConcurrency } = this.ctx.options;

		if (instanceConcurrency !== undefined && this._totalActiveJobs >= instanceConcurrency) {
			return;
		}

		for (const [name, worker] of this.ctx.workers) {
			// Skip workers not in the target set (if provided)
			if (targetNames && !targetNames.has(name)) {
				continue;
			}

			// Check if worker has capacity
			const workerAvailableSlots = worker.concurrency - worker.activeJobs.size;

			if (workerAvailableSlots <= 0) {
				continue;
			}

			// Apply global concurrency limit
			const availableSlots = this.getGloballyAvailableSlots(workerAvailableSlots);

			if (availableSlots <= 0) {
				// Global limit reached, stop processing all workers
				return;
			}

			// Try to acquire jobs up to available slots in parallel
			if (!this.ctx.isRunning()) {
				return;
			}

			const acquisitionPromises: Promise<void>[] = [];
			for (let i = 0; i < availableSlots; i++) {
				acquisitionPromises.push(
					this.lifecycle
						.claimNext(name)
						.then(async (job) => {
							if (!job) {
								return;
							}

							if (this.ctx.isRunning()) {
								// Add to activeJobs immediately to correctly track concurrency
								worker.activeJobs.set(job._id.toString(), job);
								this._totalActiveJobs++;

								this.processJob(job, worker).catch((error: unknown) => {
									this.ctx.emit('job:error', { error: toError(error), job });
								});
							} else {
								try {
									await this.lifecycle.releaseOwnedClaim(job);
								} catch {
									// Best-effort shutdown cleanup.
								}
							}
						})
						.catch((error: unknown) => {
							this.ctx.emit('job:error', { error: toError(error) });
						}),
				);
			}

			await Promise.allSettled(acquisitionPromises);
		}
	}

	/**
	 * Execute a job using its registered worker handler.
	 *
	 * Tracks the job as active during processing, emits lifecycle events, and handles
	 * both success and failure cases through the Owned Job lifecycle module.
	 *
	 * Events are only emitted when the underlying atomic status transition succeeds,
	 * ensuring event consumers receive reliable, consistent data backed by the actual
	 * database state.
	 *
	 * @param job - The job to process
	 * @param worker - The worker registration containing the handler and active job tracking
	 */
	private async processJob(job: PersistedJob, worker: WorkerRegistration): Promise<void> {
		const jobId = job._id.toString();
		const startTime = Date.now();

		try {
			this.ctx.emit('job:start', job);
			await worker.handler(job);

			// Job completed successfully
			const duration = Date.now() - startTime;
			const updatedJob = await this.lifecycle.completeOwned(job);

			if (updatedJob) {
				this.ctx.emit('job:complete', { job: updatedJob, duration });
			}
		} catch (error) {
			// Job failed
			const err = toError(error);
			const updatedJob = await this.lifecycle.failOwned(job, err);

			if (updatedJob) {
				const willRetry = updatedJob.status === JobStatus.PENDING;
				this.ctx.emit('job:fail', { job: updatedJob, error: err, willRetry });
			}
		} finally {
			worker.activeJobs.delete(jobId);
			this._totalActiveJobs--;
			this.ctx.notifyJobFinished();
		}
	}
}
