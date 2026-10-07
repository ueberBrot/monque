import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import { type Collection, type Db, type Document, ObjectId, type WithId } from "mongodb";

import type { MonqueEventMap } from "@/events";
import {
  type BulkOperationResult,
  type CursorOptions,
  type CursorPage,
  documentToPersistedJob,
  type EnqueueJob,
  type EnqueueManyResult,
  type EnqueueOptions,
  type GetJobsFilter,
  type Job,
  type JobHandler,
  type JobSelector,
  JobStatus,
  type JobSummaryPage,
  type JobWriteOptions,
  type NowOptions,
  type PersistedJob,
  type QueueStats,
  type QueueViewSummary,
  type ScheduleOptions,
} from "@/jobs";
import {
  ConnectionError,
  ShutdownTimeoutError,
  validateJobName,
  WorkerRegistrationError,
} from "@/shared";
import type { WorkerOptions, WorkerRegistration } from "@/workers";

import { attempt, fromPromise } from "./effects.js";
import { makeSchedulerLayer, SchedulerServices } from "./runtime.js";
import type { JobManager } from "./services/job-manager.js";
import { CLEANUP_STATUSES } from "./services/lifecycle-manager.js";
import type { ResolvedMonqueOptions, SchedulerContext } from "./services/types.js";
import type { MonqueOptions, ProcessingState } from "./types.js";
import {
  validateIntegerOption,
  validateOptions,
  validateRetryOptions,
} from "./validate-options.js";

/**
 * Default configuration values
 */
const DEFAULTS = {
  collectionName: "monque_jobs",
  pollInterval: 1000,
  safetyPollInterval: 30_000,
  maxRetries: 10,
  baseRetryInterval: 1000,
  shutdownTimeout: 30000,
  workerConcurrency: 5,
  lockTimeout: 1_800_000, // 30 minutes
  recoverStaleJobs: true,
  heartbeatInterval: 30000, // 30 seconds
} as const;

type SchedulerRuntime = ManagedRuntime.ManagedRuntime<SchedulerServices, never>;

/**
 * Monque - MongoDB-backed job scheduler
 *
 * A type-safe job scheduler with atomic locking, exponential backoff, cron scheduling,
 * stale job recovery, and event-driven observability. Built on native MongoDB driver.
 *
 * @example Complete lifecycle
 * ```typescript
 * import { Monque } from '@monque/core';
 * import { MongoClient } from 'mongodb';
 *
 * const client = new MongoClient('mongodb://localhost:27017');
 * await client.connect();
 * const db = client.db('myapp');
 *
 * // Create instance with options
 * const monque = new Monque(db, {
 *   collectionName: 'jobs',
 *   pollInterval: 1000,
 *   maxRetries: 10,
 *   shutdownTimeout: 30000,
 * });
 *
 * // Initialize (sets up indexes and recovers stale jobs)
 * await monque.initialize();
 *
 * // Register workers with type safety
 * type EmailJob = {
 *   to: string;
 *   subject: string;
 *   body: string;
 * };
 *
 * monque.register<EmailJob>('send-email', async (job) => {
 *   await emailService.send(job.data.to, job.data.subject, job.data.body);
 * });
 *
 * // Monitor events for observability
 * monque.on('job:complete', ({ job, duration }) => {
 *   logger.info(`Job ${job.name} completed in ${duration}ms`);
 * });
 *
 * monque.on('job:fail', ({ job, error, willRetry }) => {
 *   logger.error(`Job ${job.name} failed:`, error);
 * });
 *
 * // Start processing
 * monque.start();
 *
 * // Enqueue jobs
 * await monque.enqueue('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   body: 'Thanks for signing up.'
 * });
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await monque.stop();
 *   await client.close();
 *   process.exit(0);
 * });
 * ```
 */
export class Monque extends EventEmitter {
  private readonly db: Db;
  private readonly options: ResolvedMonqueOptions;
  private collection: Collection<Document> | null = null;
  private workers: Map<string, WorkerRegistration> = new Map();
  readonly #state = {
    running: false,
    paused: false,
    pausedWorkers: new Set<string>(),
  };

  /** Each shutdown tracks its own in-progress jobs across synchronous restarts. */
  #drainChecks = new Set<() => void>();
  #runGeneration = 0;

  /** Published together after initialization succeeds. */
  #initialized: { runtime: SchedulerRuntime; services: SchedulerServices["Service"] } | null = null;
  #initialization: Promise<void> | null = null;

  constructor(db: Db, options: MonqueOptions = {}) {
    super();
    this.setMaxListeners(20);
    this.db = db;
    this.options = {
      collectionName: options.collectionName ?? DEFAULTS.collectionName,
      pollInterval: options.pollInterval ?? DEFAULTS.pollInterval,
      safetyPollInterval: options.safetyPollInterval ?? DEFAULTS.safetyPollInterval,
      maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
      baseRetryInterval: options.baseRetryInterval ?? DEFAULTS.baseRetryInterval,
      shutdownTimeout: options.shutdownTimeout ?? DEFAULTS.shutdownTimeout,
      workerConcurrency:
        options.workerConcurrency ?? options.defaultConcurrency ?? DEFAULTS.workerConcurrency,
      lockTimeout: options.lockTimeout ?? DEFAULTS.lockTimeout,
      ...(options.leaseDuration !== undefined ? { leaseDuration: options.leaseDuration } : {}),
      recoverStaleJobs: options.recoverStaleJobs ?? DEFAULTS.recoverStaleJobs,
      maxBackoffDelay: options.maxBackoffDelay,
      instanceConcurrency: options.instanceConcurrency ?? options.maxConcurrency,
      schedulerInstanceId: options.schedulerInstanceId ?? randomUUID(),
      heartbeatInterval: options.heartbeatInterval ?? DEFAULTS.heartbeatInterval,
      jobRetention: options.jobRetention,
      skipIndexCreation: options.skipIndexCreation ?? false,
      maxPayloadSize: options.maxPayloadSize,
      statsCacheTtlMs: options.statsCacheTtlMs ?? 5000,
    };

    validateOptions(this.options);

    if (options.defaultConcurrency !== undefined) {
      console.warn(
        '[@monque/core] "defaultConcurrency" is deprecated and will be removed in a future major version. Use "workerConcurrency" instead.',
      );
    }
    if (options.maxConcurrency !== undefined) {
      console.warn(
        '[@monque/core] "maxConcurrency" is deprecated and will be removed in a future major version. Use "instanceConcurrency" instead.',
      );
    }
  }

  /**
   * Initialize the scheduler by setting up the MongoDB collection and indexes.
   * Must be called before start().
   *
   * @throws {ConnectionError} If collection or index creation fails
   */
  async initialize(): Promise<void> {
    if (this.#initialized) return;
    if (this.#initialization) return this.#initialization;

    this.#initialization = Effect.runPromise(this.#initializeRuntime());
    try {
      await this.#initialization;
    } finally {
      this.#initialization = null;
    }
  }

  #initializeRuntime(): Effect.Effect<void, ConnectionError> {
    let candidate: SchedulerRuntime | null = null;
    return Effect.gen({ self: this }, function* () {
      const collection = yield* attempt(() => this.db.collection(this.options.collectionName));
      this.collection = collection;
      if (!this.options.skipIndexCreation) yield* this.createIndexes();
      // Missing MongoDB sort keys are not numeric zero (notably against negatives).
      // Normalize before any claims, including when applications manage indexes.
      yield* fromPromise(() =>
        collection.updateMany({ priority: { $exists: false } }, { $set: { priority: 0 } }),
      );

      const ctx = yield* attempt(() => this.buildContext());
      const runtime: SchedulerRuntime = ManagedRuntime.make(
        makeSchedulerLayer(ctx, {
          runFork: (effect) => runtime.runFork(effect),
        }).pipe(Layer.orDie),
      );
      candidate = runtime;
      const context = yield* runtime.contextEffect;
      this.#initialized = { runtime, services: Context.get(context, SchedulerServices) };
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        const message =
          error instanceof Error ? error.message : "Unknown error during initialization";
        const release = candidate ? candidate.disposeEffect.pipe(Effect.ignoreCause) : Effect.void;
        return release.pipe(
          Effect.andThen(
            Effect.fail(new ConnectionError(`Failed to initialize Monque: ${message}`)),
          ),
        );
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Initialized runtime
  // ─────────────────────────────────────────────────────────────────────────────

  /** @throws {ConnectionError} if not initialized */
  get #runtime(): SchedulerRuntime {
    if (!this.#initialized) {
      throw new ConnectionError("Monque not initialized. Call initialize() first.");
    }

    return this.#initialized.runtime;
  }

  /**
   * Build the shared context for internal services.
   */
  private buildContext(): SchedulerContext {
    if (!this.collection) {
      throw new ConnectionError("Collection not initialized");
    }

    return {
      collection: this.collection,
      options: this.options,
      instanceId: this.options.schedulerInstanceId,
      workers: this.workers,
      isRunning: () => this.#state.running,
      isPaused: (name?: string) => this.isPaused(name),
      emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) =>
        this.emit(event, payload),
      notifyPendingJob: (name: string | undefined, nextRunAt: Date) => {
        if (!this.#state.running) {
          return;
        }

        this.#initialized?.services.notifications.notifyPendingJob(name, nextRunAt);
      },
      notifyJobFinished: (name) => this.onJobFinished(name),
      documentToPersistedJob: <T>(doc: WithId<Document>) => documentToPersistedJob<T>(doc),
    };
  }
  /**
   * Create required MongoDB indexes for efficient job processing.
   *
   * The following indexes are created:
   * - `{status, nextRunAt}` - For efficient job polling queries
   * - `{name, uniqueKey}` - Partial unique index for deduplication (pending/processing only)
   * - `{name, status}` - For job lookup by type
   * - `{createdAt, _id}` - For dashboard browsing sorted by creation time
   * - `{updatedAt, _id}` - For dashboard browsing sorted by update time
   * - `{nextRunAt, _id}` - For dashboard browsing sorted by next run time
   * - `{claimedBy, status}` - For finding jobs owned by a specific scheduler instance
   * - `{lastHeartbeat, status}` - For monitoring/debugging queries (e.g., inspecting heartbeat age)
   * - `{name, status, nextRunAt, claimedBy}` - For atomic claim queries (find unclaimed pending jobs per worker)
   * - `{lockedAt, lastHeartbeat, status}` - Supports recovery scans and monitoring access patterns
   */
  private readonly createIndexes = Effect.fnUntraced(function* (
    this: Monque,
  ): Effect.fn.Return<void, unknown> {
    const collection = this.collection;
    if (!collection) return yield* Effect.fail(new ConnectionError("Collection not initialized"));

    yield* fromPromise(() =>
      collection.createIndexes([
        // Compound index for job polling - status + nextRunAt for efficient queries
        { key: { status: 1, nextRunAt: 1 }, background: true },
        // Partial unique index for deduplication - scoped by name + uniqueKey
        // Only enforced where uniqueKey exists and status is pending/processing
        {
          key: { name: 1, uniqueKey: 1 },
          unique: true,
          partialFilterExpression: {
            uniqueKey: { $exists: true },
            status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
          },
          background: true,
        },
        // Index for job lookup by name
        { key: { name: 1, status: 1 }, background: true },
        // Dashboard-grade listing indexes with a stable identifier tie-breaker.
        { key: { createdAt: -1, _id: -1 }, background: true },
        { key: { name: 1, createdAt: -1, _id: -1 }, background: true },
        { key: { status: 1, createdAt: -1, _id: -1 }, background: true },
        { key: { updatedAt: -1, _id: -1 }, background: true },
        { key: { nextRunAt: -1, _id: -1 }, background: true },
        // Compound index for finding jobs claimed by a specific scheduler instance.
        // Used for heartbeat updates and cleanup on shutdown.
        { key: { claimedBy: 1, status: 1 }, background: true },
        // Compound index for monitoring/debugging via heartbeat timestamps.
        // Note: stale recovery uses lockedAt + lockTimeout as the source of truth.
        { key: { lastHeartbeat: 1, status: 1 }, background: true },
        // Compound index for atomic claim queries.
        // Prefix with `name` to match the acquireJob query shape: { name, status, nextRunAt, claimedBy }.
        // This enables per-worker index prefix scans instead of scanning across all job types.
        { key: { name: 1, status: 1, nextRunAt: 1, claimedBy: 1 }, background: true },
        // Ordered claims need their own index; retain the deadline-first index above
        // for discovery and future wakeups independently of priority.
        { key: { name: 1, status: 1, priority: -1, nextRunAt: 1, _id: 1 }, background: true },
        // Expanded index that supports recovery scans (status + lockedAt) plus heartbeat monitoring patterns.
        { key: { status: 1, lockedAt: 1, lastHeartbeat: 1 }, background: true },
        // Index for efficient lifecycle manager cleanup when jobRetention is configured.
        // Allows fast queries for deleteMany({ status, updatedAt: { $lt: cutoff } }).
        ...(this.options.jobRetention
          ? [
              {
                key: { status: 1, updatedAt: 1 } as const,
                background: true,
                partialFilterExpression: {
                  status: { $in: CLEANUP_STATUSES },
                  updatedAt: { $exists: true },
                },
              },
            ]
          : []),
        ...(this.options.jobRetention?.cancelled != null
          ? [
              {
                key: { updatedAt: 1 } as const,
                name: "monque_cancelled_retention",
                background: true,
                partialFilterExpression: { status: JobStatus.CANCELLED },
              },
            ]
          : []),
      ]),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Job Scheduling (delegates to JobIntake)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Enqueue a job for processing.
   *
   * Jobs are stored in MongoDB and processed by registered workers. Supports
   * delayed execution via `runAt` and deduplication via `uniqueKey`.
   *
   * When a `uniqueKey` is provided, only one pending or processing job with that key
   * can exist. Completed or failed jobs don't block new jobs with the same key.
   *
   * Failed jobs are automatically retried with exponential backoff up to `maxRetries`
   * (default: 10 attempts). The delay between retries is calculated as `2^failCount × baseRetryInterval`.
   *
   * @template T - The job data payload type (must be JSON-serializable)
   * @param name - Job type identifier, must match a registered worker
   * @param data - Job payload, will be passed to the worker handler
   * @param options - Scheduling and deduplication options
   * @returns Promise resolving to the created or existing job document
   * @throws {InvalidJobIdentifierError} If `name` or `uniqueKey` fails public identifier validation
   * @throws {ConnectionError} If database operation fails or scheduler not initialized
   * @throws {PayloadTooLargeError} If payload exceeds configured `maxPayloadSize`
   * @throws {InvalidJobPriorityError} If priority is not a signed safe integer
   *
   * @example Basic job enqueueing
   * ```typescript
   * await monque.enqueue('send-email', {
   *   to: 'user@example.com',
   *   subject: 'Welcome!',
   *   body: 'Thanks for signing up.'
   * });
   * ```
   *
   * @example Delayed execution
   * ```typescript
   * const oneHourLater = new Date(Date.now() + 3600000);
   * await monque.enqueue('reminder', { message: 'Check in!' }, {
   *   runAt: oneHourLater
   * });
   * ```
   *
   * @example Prevent duplicates with unique key
   * ```typescript
   * await monque.enqueue('sync-user', { userId: '123' }, {
   *   uniqueKey: 'sync-user-123'
   * });
   * // Subsequent enqueues with same uniqueKey return existing pending/processing job
   * ```
   *
   * @see {@link JobIntake.enqueue}
   */
  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ intake }) => intake.enqueue(name, data, options)),
    );
  }

  /**
   * Submit a batch with per-job scheduling and deduplication. Input validation finishes before writing.
   * A database failure can leave some jobs persisted; ConnectionError.cause retains
   * the driver's error and partial result. Use unique keys when retrying a batch.
   * Pass a session to join a caller-owned transaction; transaction errors remain native.
   */
  async enqueueMany(
    jobs: readonly EnqueueJob[],
    options: JobWriteOptions = {},
  ): Promise<EnqueueManyResult> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ intake }) => intake.enqueueMany(jobs, options)),
    );
  }

  /**
   * Enqueue a job for immediate processing.
   *
   * Convenience method equivalent to `enqueue(name, data, { runAt: new Date() })`.
   * Jobs are picked up on the next poll cycle (typically within 1 second based on `pollInterval`).
   *
   * @template T - The job data payload type (must be JSON-serializable)
   * @param name - Job type identifier, must match a registered worker
   * @param data - Job payload, will be passed to the worker handler
   * @returns Promise resolving to the created job document
   * @throws {InvalidJobIdentifierError} If `name` fails public identifier validation
   * @throws {ConnectionError} If database operation fails or scheduler not initialized
   *
   * @example Send email immediately
   * ```typescript
   * await monque.now('send-email', {
   *   to: 'admin@example.com',
   *   subject: 'Alert',
   *   body: 'Immediate attention required'
   * });
   * ```
   *
   * @example Process order in background
   * ```typescript
   * const order = await createOrder(data);
   * await monque.now('process-order', { orderId: order.id });
   * return order; // Return immediately, processing happens async
   * ```
   *
   * @see {@link JobIntake.now}
   */
  async now<T>(name: string, data: T, options: NowOptions = {}): Promise<PersistedJob<T>> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ intake }) => intake.now(name, data, options)),
    );
  }

  /**
   * Schedule a recurring job with a cron expression.
   *
   * Creates a job that automatically re-schedules itself based on the cron pattern.
   * Uses standard 5-field cron format: minute, hour, day of month, month, day of week.
   * Also supports predefined expressions like `@daily`, `@weekly`, `@monthly`, etc.
   * After successful completion, the job is reset to `pending` status and scheduled
   * for its next run based on the cron expression.
   * An optional IANA `timezone` is used for every occurrence, including daylight saving
   * transitions. When omitted, the server's local timezone is used.
   *
   * When a `uniqueKey` is provided, only one pending or processing job with that key
   * can exist. This prevents duplicate scheduled jobs on application restart.
   *
   * @template T - The job data payload type (must be JSON-serializable)
   * @param cron - Cron expression (5 fields or predefined expression)
   * @param name - Job type identifier, must match a registered worker
   * @param data - Job payload, will be passed to the worker handler on each run
   * @param options - Scheduling options (uniqueKey for deduplication, timezone for cron evaluation)
   * @returns Promise resolving to the created job document with `repeatInterval` set
   * @throws {InvalidJobIdentifierError} If `name` or `uniqueKey` fails public identifier validation
   * @throws {InvalidCronError} If the cron expression or timezone is invalid
   * @throws {ConnectionError} If database operation fails or scheduler not initialized
   * @throws {PayloadTooLargeError} If payload exceeds configured `maxPayloadSize`
   *
   * @example Hourly cleanup job
   * ```typescript
   * await monque.schedule('0 * * * *', 'cleanup-temp-files', {
   *   directory: '/tmp/uploads'
   * });
   * ```
   *
   * @example Prevent duplicate scheduled jobs with unique key
   * ```typescript
   * await monque.schedule('0 * * * *', 'hourly-report', { type: 'sales' }, {
   *   uniqueKey: 'hourly-report-sales'
   * });
   * // Subsequent calls with same uniqueKey return existing pending/processing job
   * ```
   *
   * @example Daily report at midnight (using predefined expression)
   * ```typescript
   * await monque.schedule('@daily', 'daily-report', {
   *   reportType: 'sales',
   *   recipients: ['analytics@example.com']
   * });
   * ```
   *
   * @see {@link JobIntake.schedule}
   */
  async schedule<T>(
    cron: string,
    name: string,
    data: T,
    options: ScheduleOptions = {},
  ): Promise<PersistedJob<T>> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ intake }) => intake.schedule(cron, name, data, options)),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Job Management (delegates to JobManager)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Cancel a pending or scheduled job.
   *
   * Sets the job status to 'cancelled' only when canceling from pending status.
   * Emits a 'job:cancelled' event only when a state transition occurs.
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
   *
   * @see {@link JobManager.cancelJob}
   */
  async cancelJob(jobId: string): Promise<PersistedJob<unknown> | null> {
    return this.#runJobMutation((manager) => manager.cancelJob(jobId));
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
   *
   * @see {@link JobManager.retryJob}
   */
  async retryJob(jobId: string): Promise<PersistedJob<unknown> | null> {
    return this.#runJobMutation((manager) => manager.retryJob(jobId));
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
   *
   * @see {@link JobManager.rescheduleJob}
   */
  async rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null> {
    return this.#runJobMutation((manager) => manager.rescheduleJob(jobId, runAt));
  }

  /**
   * Change a pending Job's priority without changing its scheduled time.
   *
   * Higher signed safe integers run first among due Jobs with the same name.
   * The new priority also applies to subsequent runs of a recurring Job.
   *
   * @param jobId - The ID of the pending Job
   * @param priority - The new signed safe integer priority
   * @returns The updated Job, or null for missing or invalid identifiers
   * @throws {InvalidJobPriorityError} If priority is not a signed safe integer
   * @throws {JobStateError} If the Job is no longer pending, including a lost claim race
   */
  async setJobPriority(jobId: string, priority: number): Promise<PersistedJob<unknown> | null> {
    return this.#runJobMutation((manager) => manager.setJobPriority(jobId, priority));
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
   *
   * @see {@link JobManager.deleteJob}
   */
  async deleteJob(jobId: string): Promise<boolean> {
    return this.#runJobMutation((manager) => manager.deleteJob(jobId));
  }

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
   *
   * @see {@link JobManager.cancelJobs}
   */
  async cancelJobs(filter: JobSelector): Promise<BulkOperationResult> {
    return this.#runJobMutation((manager) => manager.cancelJobs(filter));
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
   *
   * @see {@link JobManager.retryJobs}
   */
  async retryJobs(filter: JobSelector): Promise<BulkOperationResult> {
    return this.#runJobMutation((manager) => manager.retryJobs(filter));
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
   *
   * @see {@link JobManager.deleteJobs}
   */
  async deleteJobs(filter: JobSelector): Promise<BulkOperationResult> {
    return this.#runJobMutation((manager) => manager.deleteJobs(filter));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Job Queries (delegates to JobQueryService)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single job by its MongoDB ObjectId or hexadecimal ID string.
   *
   * Useful for retrieving job details when you have a job ID from events,
   * logs, or stored references.
   *
   * @template T - The expected type of the job data payload
   * @param id - The job's ObjectId or hexadecimal ID string
   * @returns Promise resolving to the job if found, null for missing or invalid IDs
   * @throws {ConnectionError} If scheduler not initialized
   *
   * @example Look up job from event
   * ```typescript
   * monque.on('job:fail', async ({ job }) => {
   *   // Later, retrieve the job to check its status
   *   const currentJob = await monque.getJob(job._id);
   *   console.log(`Job status: ${currentJob?.status}`);
   * });
   * ```
   *
   * @example Admin endpoint
   * ```typescript
   * app.get('/jobs/:id', async (req, res) => {
   *   const job = await monque.getJob(new ObjectId(req.params.id));
   *   if (!job) {
   *     return res.status(404).json({ error: 'Job not found' });
   *   }
   *   res.json(job);
   * });
   * ```
   *
   * @see {@link JobQueryService.getJob}
   */
  async getJob<T = unknown>(id: ObjectId | string): Promise<PersistedJob<T> | null> {
    const runtime = this.#runtime;
    if (!ObjectId.isValid(id)) return null;
    return runtime.runPromise(
      SchedulerServices.use(({ queries: query }) => query.getJob<T>(new ObjectId(id))),
    );
  }

  /**
   * Query jobs from the queue with optional filters.
   *
   * Provides read-only access to job data for monitoring, debugging, and
   * administrative purposes. Results are ordered by `nextRunAt` ascending.
   *
   * @template T - The expected type of the job data payload
   * @param filter - Optional filter criteria
   * @returns Promise resolving to array of matching jobs
   * @throws {ConnectionError} If scheduler not initialized
   *
   * @example Get all pending jobs
   * ```typescript
   * const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
   * console.log(`${pendingJobs.length} jobs waiting`);
   * ```
   *
   * @example Get failed email jobs
   * ```typescript
   * const failedEmails = await monque.getJobs({
   *   name: 'send-email',
   *   status: JobStatus.FAILED,
   * });
   * for (const job of failedEmails) {
   *   console.error(`Job ${job._id} failed: ${job.failReason}`);
   * }
   * ```
   *
   * @example Paginated job listing
   * ```typescript
   * const page1 = await monque.getJobs({ limit: 50, skip: 0 });
   * const page2 = await monque.getJobs({ limit: 50, skip: 50 });
   * ```
   *
   * @example Use with type guards from @monque/core
   * ```typescript
   * import { isPendingJob, isRecurringJob } from '@monque/core';
   *
   * const jobs = await monque.getJobs();
   * const pendingRecurring = jobs.filter(job => isPendingJob(job) && isRecurringJob(job));
   * ```
   *
   * @see {@link JobQueryService.getJobs}
   */
  async getJobs<T = unknown>(filter: GetJobsFilter = {}): Promise<PersistedJob<T>[]> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ queries: query }) => query.getJobs<T>(filter)),
    );
  }

  /**
   * Get a paginated list of jobs using opaque cursors.
   *
   * Provides stable pagination for large job lists. Supports forward and backward
   * navigation, filtering, and efficient database access via index-based cursor queries.
   *
   * @template T - The job data payload type
   * @param options - Pagination options (cursor, limit, direction, filter)
   * @returns Page of jobs with next/prev cursors
   * @throws {InvalidCursorError} If the provided cursor is malformed
   * @throws {ConnectionError} If database operation fails or scheduler not initialized
   *
   * @example List pending jobs
   * ```typescript
   * const page = await monque.getJobsWithCursor({
   *   limit: 20,
   *   filter: { status: 'pending' }
   * });
   * const jobs = page.jobs;
   *
   * // Get next page
   * if (page.hasNextPage) {
   *   const page2 = await monque.getJobsWithCursor({
   *     cursor: page.cursor,
   *     limit: 20
   *   });
   * }
   * ```
   *
   * @see {@link JobQueryService.getJobsWithCursor}
   */

  async getJobsWithCursor<T = unknown>(options: CursorOptions = {}): Promise<CursorPage<T>> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ queries: query }) => query.getJobsWithCursor<T>(options)),
    );
  }

  /** List job metadata without reading payloads; shares the full listing cursor format. */
  async getJobSummariesWithCursor(options: CursorOptions = {}): Promise<JobSummaryPage> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ queries: query }) => query.getJobSummariesWithCursor(options)),
    );
  }

  /**
   * Get aggregate statistics for the job queue.
   *
   * Uses MongoDB aggregation pipeline for efficient server-side calculation.
   * Returns counts per status and optional average processing duration for completed jobs.
   *
   * Results are cached per unique filter with a configurable TTL (default 5s).
   * Set `statsCacheTtlMs: 0` to disable caching.
   *
   * @param filter - Optional filter to scope statistics by job name
   * @returns Promise resolving to queue statistics
   * @throws {AggregationTimeoutError} If aggregation exceeds 30 second timeout
   * @throws {ConnectionError} If database operation fails
   *
   * @example Get overall queue statistics
   * ```typescript
   * const stats = await monque.getQueueStats();
   * console.log(`Pending: ${stats.pending}, Failed: ${stats.failed}`);
   * ```
   *
   * @example Get statistics for a specific job type
   * ```typescript
   * const emailStats = await monque.getQueueStats({ name: 'send-email' });
   * console.log(`${emailStats.total} email jobs in queue`);
   * ```
   *
   * @see {@link JobQueryService.getQueueStats}
   */
  async getQueueStats(filter?: Pick<JobSelector, "name">): Promise<QueueStats> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ queries: query }) => query.getQueueStats(filter)),
    );
  }

  /**
   * Get operator-facing Queue View summaries grouped by Job Name.
   *
   * Includes every Job Name with persisted Jobs, every locally registered Worker,
   * per-name Job statistics, and local Worker capacity snapshots. Results are
   * sorted by Job Name. An optional name filter limits aggregation to that Job Name.
   *
   * @param filter - Optional exact Job Name filter
   * @returns Promise resolving to immutable Queue View summaries
   *
   * @example Inspect Queue Views
   * ```typescript
   * const summaries = await monque.getQueueViewSummaries();
   *
   * for (const summary of summaries) {
   *   console.log(summary.name, summary.stats.total, summary.worker?.activeCount ?? 0);
   * }
   * ```
   *
   * @see {@link JobQueryService.getQueueViewSummaries}
   */
  async getQueueViewSummaries(
    filter?: Pick<JobSelector, "name">,
  ): Promise<readonly QueueViewSummary[]> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ queries: query }) => query.getQueueViewSummaries(filter)),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Worker Registration
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register a worker to process jobs of a specific type.
   *
   * Workers can be registered before or after calling `start()`. Each worker
   * processes jobs concurrently up to its configured concurrency limit (default: 5).
   *
   * The handler function receives the full job object including metadata (`_id`, `status`,
   * `failCount`, etc.). If the handler throws an error, the job is retried with exponential
   * backoff up to `maxRetries` times. After exhausting retries, the job is marked as `failed`.
   *
   * Events are emitted during job processing: `job:start`, `job:complete`, `job:fail`, and `job:error`.
   *
   * **Duplicate Registration**: By default, registering a worker for a job name that already has
   * a worker will throw a `WorkerRegistrationError`. This fail-fast behavior prevents accidental
   * replacement of handlers. To explicitly replace a worker, pass `{ replace: true }`.
   *
   * @template T - The job data payload type for type-safe access to `job.data`
   * @param name - Job type identifier to handle
   * @param handler - Async function to execute for each job
   * @param options - Worker configuration
   * @param options.concurrency - Maximum concurrent jobs for this worker (default: `defaultConcurrency`)
   * @param options.replace - When `true`, replace existing worker instead of throwing error
   * @throws {InvalidJobIdentifierError} If `name` fails public identifier validation
   * @throws {WorkerRegistrationError} When a worker is already registered for `name` and `replace` is not `true`
   *
   * @example Basic email worker
   * ```typescript
   * interface EmailJob {
   *   to: string;
   *   subject: string;
   *   body: string;
   * }
   *
   * monque.register<EmailJob>('send-email', async (job) => {
   *   await emailService.send(job.data.to, job.data.subject, job.data.body);
   * });
   * ```
   *
   * @example Worker with custom concurrency
   * ```typescript
   * // Limit to 2 concurrent video processing jobs (resource-intensive)
   * monque.register('process-video', async (job) => {
   *   await videoProcessor.transcode(job.data.videoId);
   * }, { concurrency: 2 });
   * ```
   *
   * @example Replacing an existing worker
   * ```typescript
   * // Replace the existing handler for 'send-email'
   * monque.register('send-email', newEmailHandler, { replace: true });
   * ```
   *
   * @example Worker with error handling
   * ```typescript
   * monque.register('sync-user', async (job) => {
   *   try {
   *     await externalApi.syncUser(job.data.userId);
   *   } catch (error) {
   *     // Job will retry with exponential backoff
   *     // Delay = 2^failCount × baseRetryInterval (default: 1000ms)
   *     throw new Error(`Sync failed: ${error.message}`);
   *   }
   * });
   * ```
   */
  register<T>(name: string, handler: JobHandler<T>, options: WorkerOptions<T> = {}): void {
    validateJobName(name);
    const concurrency = options.concurrency ?? this.options.workerConcurrency;
    validateIntegerOption("concurrency", concurrency);
    const retryOptions = {
      maxRetries: options.maxRetries ?? this.options.maxRetries,
      baseRetryInterval: options.baseRetryInterval ?? this.options.baseRetryInterval,
      maxBackoffDelay: options.maxBackoffDelay ?? this.options.maxBackoffDelay,
    };
    validateRetryOptions(retryOptions);

    // Check for existing worker and throw unless replace is explicitly true
    if (this.workers.has(name) && options.replace !== true) {
      throw new WorkerRegistrationError(
        `Worker already registered for job name "${name}". Use { replace: true } to replace.`,
        name,
      );
    }

    this.workers.set(name, {
      handler: handler as JobHandler,
      concurrency,
      retryOptions,
      ...(options.schema === undefined ? {} : { schema: options.schema }),
      activeJobs: this.workers.get(name)?.activeJobs ?? new Map(),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API - Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /** Pause new executions locally, optionally for one job name. Running jobs continue. */
  pause(name?: string): void {
    if (name === undefined) this.#state.paused = true;
    else {
      validateJobName(name);
      this.#state.pausedWorkers.add(name);
    }
  }

  /** Resume local executions. Resuming the instance preserves individually paused workers. */
  resume(name?: string): void {
    if (name === undefined) this.#state.paused = false;
    else {
      validateJobName(name);
      this.#state.pausedWorkers.delete(name);
    }
    this.#initialized?.services.notifications.notifyRunnableJob(name);
  }

  /** Whether the local instance, or the named worker, is effectively paused. */
  isPaused(name?: string): boolean {
    if (name !== undefined) validateJobName(name);
    const state = this.#state;
    return state.paused || (name !== undefined && state.pausedWorkers.has(name));
  }

  /** Identify the local scheduler and inspect global or named-worker processing state. */
  getProcessingState(name?: string): ProcessingState {
    return {
      instanceId: this.options.schedulerInstanceId,
      ...(name === undefined ? {} : { name }),
      paused: this.isPaused(name),
      globallyPaused: this.#state.paused,
    };
  }

  /**
   * Start polling for and processing jobs.
   *
   * Begins polling MongoDB at the configured interval (default: 1 second) to pick up
   * pending jobs and dispatch them to registered workers. Must call `initialize()` first.
   * Workers can be registered before or after calling `start()`.
   *
   * Jobs are processed concurrently up to each worker's configured concurrency limit.
   * The scheduler continues running until `stop()` is called.
   *
   * @example Basic startup
   * ```typescript
   * const monque = new Monque(db);
   * await monque.initialize();
   *
   * monque.register('send-email', emailHandler);
   * monque.register('process-order', orderHandler);
   *
   * monque.start(); // Begin processing jobs
   * ```
   *
   * @example With event monitoring
   * ```typescript
   * monque.on('job:start', (job) => {
   *   logger.info(`Starting job ${job.name}`);
   * });
   *
   * monque.on('job:complete', ({ job, duration }) => {
   *   metrics.recordJobDuration(job.name, duration);
   * });
   *
   * monque.on('job:fail', ({ job, error, willRetry }) => {
   *   logger.error(`Job ${job.name} failed:`, error);
   *   if (!willRetry) {
   *     alerting.sendAlert(`Job permanently failed: ${job.name}`);
   *   }
   * });
   *
   * monque.start();
   * ```
   *
   * @throws {ConnectionError} If scheduler not initialized (call `initialize()` first)
   */
  start(): void {
    if (this.#state.running) {
      return;
    }

    if (!this.#initialized) {
      throw new ConnectionError("Monque not initialized. Call initialize() before start().");
    }

    const { services } = this.#initialized;
    this.#runGeneration++;
    this.#state.running = true;

    // Set up change streams as the primary notification mechanism
    services.streams.setup();

    services.notifications.start();

    // Start heartbeat and retention timers
    services.timers.startTimers();
  }

  /**
   * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
   *
   * Stops polling for new jobs and waits for all active jobs to finish processing.
   * Times out after the configured `shutdownTimeout` (default: 30 seconds), emitting
   * a `job:error` event with a `ShutdownTimeoutError` containing incomplete jobs.
   * On timeout, jobs still in progress are left as `processing` for stale job recovery.
   * Restarting does not extend this shutdown to jobs started after it began.
   *
   * It's safe to call `stop()` multiple times - subsequent calls are no-ops if already stopped.
   *
   * @returns Promise that resolves when all jobs complete or timeout is reached
   *
   * @example Graceful application shutdown
   * ```typescript
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down gracefully...');
   *   await monque.stop(); // Wait for jobs to complete
   *   await mongoClient.close();
   *   process.exit(0);
   * });
   * ```
   *
   * @example With timeout handling
   * ```typescript
   * monque.on('job:error', ({ error }) => {
   *   if (error.name === 'ShutdownTimeoutError') {
   *     logger.warn('Forced shutdown after timeout:', error.incompleteJobs);
   *   }
   * });
   *
   * await monque.stop();
   * ```
   */

  async stop(): Promise<void> {
    if (!this.#state.running) {
      return;
    }

    await this.#runtime.runPromise(this.#stopScheduler());
  }

  readonly #stopScheduler = Effect.fnUntraced(function* (this: Monque) {
    const generation = this.#runGeneration;
    const drainingJobs = new Set(this.getActiveJobsList());
    const getIncompleteJobs = () => this.getActiveJobsList().filter((job) => drainingJobs.has(job));
    const { timers, notifications, queries: query, streams } = yield* SchedulerServices;

    timers.stopTimers(this.options.leaseDuration !== undefined);
    notifications.close();

    this.#state.running = false;

    query.clearStatsCache();
    yield* streams.close().pipe(Effect.ignoreCause);

    let timedOut = false;
    if (getIncompleteJobs().length > 0) {
      const drain = yield* Deferred.make<void>();
      const checkDrain = () => {
        if (getIncompleteJobs().length === 0) Deferred.doneUnsafe(drain, Effect.void);
      };
      this.#drainChecks.add(checkDrain);
      checkDrain();
      const result = yield* Deferred.await(drain).pipe(
        Effect.timeoutOption(this.options.shutdownTimeout),
        Effect.ensuring(Effect.sync(() => this.#drainChecks.delete(checkDrain))),
      );
      timedOut = Option.isNone(result);
    }

    if (generation === this.#runGeneration) {
      timers.stopTimers();
    }

    if (timedOut) {
      const incompleteJobs = getIncompleteJobs();

      const error = new ShutdownTimeoutError(
        `Shutdown timed out after ${this.options.shutdownTimeout}ms with ${incompleteJobs.length} incomplete jobs`,
        incompleteJobs,
      );
      this.emit("job:error", { error });
    }
  });

  /**
   * Check if the scheduler is healthy (running and connected).
   *
   * Returns `true` when the scheduler is started, initialized, and has an active
   * MongoDB collection reference. Useful for health check endpoints and monitoring.
   *
   * A healthy scheduler:
   * - Has called `initialize()` successfully
   * - Has called `start()` and is actively polling
   * - Has a valid MongoDB collection reference
   *
   * @returns `true` if scheduler is running and connected, `false` otherwise
   *
   * @example Express health check endpoint
   * ```typescript
   * app.get('/health', (req, res) => {
   *   const healthy = monque.isHealthy();
   *   res.status(healthy ? 200 : 503).json({
   *     status: healthy ? 'ok' : 'unavailable',
   *     scheduler: healthy,
   *     timestamp: new Date().toISOString()
   *   });
   * });
   * ```
   *
   * @example Kubernetes readiness probe
   * ```typescript
   * app.get('/readyz', (req, res) => {
   *   if (monque.isHealthy() && dbConnected) {
   *     res.status(200).send('ready');
   *   } else {
   *     res.status(503).send('not ready');
   *   }
   * });
   * ```
   *
   * @example Periodic health monitoring
   * ```typescript
   * setInterval(() => {
   *   if (!monque.isHealthy()) {
   *     logger.error('Scheduler unhealthy');
   *     metrics.increment('scheduler.unhealthy');
   *   }
   * }, 60000); // Check every minute
   * ```
   */
  isHealthy(): boolean {
    return this.#state.running && this.#initialized !== null && this.collection !== null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /** Invalidate query caches after every management mutation, including partial failures. */
  async #runJobMutation<T>(
    operation: (manager: JobManager) => Effect.Effect<T, unknown>,
  ): Promise<T> {
    return this.#runtime.runPromise(
      SchedulerServices.use(({ manager, queries }) =>
        Effect.suspend(() => operation(manager)).pipe(
          Effect.ensuring(Effect.sync(() => queries.clearStatsCache())),
        ),
      ),
    );
  }

  /**
   * Wake polling when local capacity is freed and check each shutdown's drain.
   *
   * @private
   */
  private onJobFinished(name: string): void {
    this.#initialized?.services.notifications.notifyRunnableJob(name);
    for (const checkDrain of this.#drainChecks) checkDrain();
  }

  /**
   * Get list of active job documents (for shutdown timeout error).
   *
   * @private
   * @returns Array of active Job objects
   */
  private getActiveJobsList(): Job[] {
    const activeJobs: Job[] = [];
    for (const worker of this.workers.values()) {
      activeJobs.push(...worker.activeJobs.values());
    }
    return activeJobs;
  }

  /**
   * Type-safe event emitter methods
   */
  override emit<K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]): boolean {
    return super.emit(event, payload);
  }

  override on<K extends keyof MonqueEventMap>(
    event: K,
    listener: (payload: MonqueEventMap[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof MonqueEventMap>(
    event: K,
    listener: (payload: MonqueEventMap[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  override off<K extends keyof MonqueEventMap>(
    event: K,
    listener: (payload: MonqueEventMap[K]) => void,
  ): this {
    return super.off(event, listener);
  }
}
