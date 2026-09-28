import { JobStatus, type PersistedJob } from "@/jobs";
import { PayloadValidationError, toError } from "@/shared";
import type { WorkerRegistration } from "@/workers";

import { JobLifecycle } from "./job-lifecycle.js";
import type { SchedulerContext } from "./types.js";

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
  private lastServedWorker: string | undefined;

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
   * specified workers are checked unless they share an instance concurrency limit.
   * Used by change stream handler for targeted polling.
   */
  async poll(targetNames?: ReadonlySet<string>): Promise<void> {
    if (!this.ctx.isRunning() || this.ctx.isPaused()) {
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
      } while (this._repollRequested && this.ctx.isRunning() && !this.ctx.isPaused());
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

    let names: Iterable<string> = this.ctx.workers.keys();
    if (instanceConcurrency !== undefined) {
      const entries = [...names];
      const next = entries.findIndex((name) => name === this.lastServedWorker) + 1;
      names = entries.slice(next).concat(entries.slice(0, next));
      // A targeted notification must not bypass workers waiting for a shared slot.
      targetNames = undefined;
    }

    for (const name of names) {
      const worker = this.ctx.workers.get(name);
      if (!worker || this.ctx.isPaused(name)) continue;
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

      // Probe once, then grow batches while jobs remain available.
      if (!this.ctx.isRunning()) {
        return;
      }

      let remaining = availableSlots;
      for (let batchSize = 1; remaining > 0 && this.ctx.isRunning(); batchSize *= 2) {
        const size = Math.min(batchSize, remaining);
        let found = 0;
        const acquisitionPromises: Promise<void>[] = [];
        for (let i = 0; i < size; i++) {
          acquisitionPromises.push(
            this.lifecycle
              .claimNext(name)
              .then(async (job) => {
                if (!job) return;
                found++;
                this.lastServedWorker = name;
                await this.dispatchClaim(job, worker, name);
              })
              .catch((error: unknown) => {
                this.ctx.emit("job:error", { error: toError(error) });
              }),
          );
        }

        await Promise.allSettled(acquisitionPromises);
        if (found < size) {
          break;
        }
        remaining -= size;
      }
    }
  }

  private async dispatchClaim(
    job: PersistedJob,
    worker: WorkerRegistration,
    name: string,
  ): Promise<void> {
    if (!this.ctx.isRunning() || this.ctx.isPaused(name)) {
      try {
        await this.lifecycle.releaseOwnedClaim(job);
      } catch (error) {
        if (this.ctx.isRunning()) this.ctx.emit("job:error", { error: toError(error), job });
      }
      return;
    }

    worker.activeJobs.set(job.claimId ?? job._id.toString(), job);
    this._totalActiveJobs++;
    this.processJob(job, worker).catch((error: unknown) => {
      this.ctx.emit("job:error", { error: toError(error), job });
    });
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
    const claimId = job.claimId ?? job._id.toString();
    const startTime = Date.now();

    try {
      this.ctx.emit("job:start", job);
      let handlerJob = job;
      if (worker.schema) {
        const result = await worker.schema["~standard"].validate(job.data);
        if (result.issues) throw new PayloadValidationError(job.name, result.issues);
        handlerJob = { ...job, data: result.value };
      }
      await worker.handler(handlerJob);

      // Job completed successfully
      const duration = Date.now() - startTime;
      const updatedJob = await this.lifecycle.completeOwned(job);

      if (updatedJob) {
        this.ctx.emit("job:complete", { job: updatedJob, duration });
      }
    } catch (error) {
      // Job failed
      const err = toError(error);
      const updatedJob = await this.lifecycle.failOwned(job, err, worker.retryOptions);

      if (updatedJob) {
        const willRetry = updatedJob.status === JobStatus.PENDING;
        this.ctx.emit("job:fail", { job: updatedJob, error: err, willRetry });
      }
    } finally {
      worker.activeJobs.delete(claimId);
      this._totalActiveJobs--;
      this.ctx.notifyJobFinished(job.name);
    }
  }
}
