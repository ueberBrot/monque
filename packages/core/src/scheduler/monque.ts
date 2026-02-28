import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Collection, Db, Document, ObjectId, WithId } from 'mongodb';

import type { MonqueEventMap } from '@/events';
import {
	type BulkOperationResult,
	type CursorOptions,
	type CursorPage,
	documentToPersistedJob,
	type EnqueueOptions,
	type GetJobsFilter,
	type Job,
	type JobHandler,
	type JobSelector,
	JobStatus,
	type PersistedJob,
	type QueueStats,
	type ScheduleOptions,
} from '@/jobs';
import { ConnectionError, ShutdownTimeoutError, WorkerRegistrationError } from '@/shared';
import type { WorkerOptions, WorkerRegistration } from '@/workers';

import {
	ChangeStreamHandler,
	JobManager,
	JobProcessor,
	JobQueryService,
	JobScheduler,
	LifecycleManager,
	type ResolvedMonqueOptions,
	type SchedulerContext,
} from './services/index.js';
import type { MonqueOptions } from './types.js';

/**
 * Default configuration values
 */
const DEFAULTS = {
	collectionName: 'monque_jobs',
	pollInterval: 1000,
	maxRetries: 10,
	baseRetryInterval: 1000,
	shutdownTimeout: 30000,
	workerConcurrency: 5,
	lockTimeout: 1_800_000, // 30 minutes
	recoverStaleJobs: true,
	heartbeatInterval: 30000, // 30 seconds
	retentionInterval: 3600_000, // 1 hour
} as const;

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
	private isRunning = false;
	private isInitialized = false;

	// Internal services (initialized in initialize())
	private _scheduler: JobScheduler | null = null;
	private _manager: JobManager | null = null;
	private _query: JobQueryService | null = null;
	private _processor: JobProcessor | null = null;
	private _changeStreamHandler: ChangeStreamHandler | null = null;
	private _lifecycleManager: LifecycleManager | null = null;

	constructor(db: Db, options: MonqueOptions = {}) {
		super();
		this.db = db;
		this.options = {
			collectionName: options.collectionName ?? DEFAULTS.collectionName,
			pollInterval: options.pollInterval ?? DEFAULTS.pollInterval,
			maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
			baseRetryInterval: options.baseRetryInterval ?? DEFAULTS.baseRetryInterval,
			shutdownTimeout: options.shutdownTimeout ?? DEFAULTS.shutdownTimeout,
			workerConcurrency:
				options.workerConcurrency ?? options.defaultConcurrency ?? DEFAULTS.workerConcurrency,
			lockTimeout: options.lockTimeout ?? DEFAULTS.lockTimeout,
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
	}

	/**
	 * Initialize the scheduler by setting up the MongoDB collection and indexes.
	 * Must be called before start().
	 *
	 * @throws {ConnectionError} If collection or index creation fails
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			this.collection = this.db.collection(this.options.collectionName);

			// Create indexes for efficient queries (unless externally managed)
			if (!this.options.skipIndexCreation) {
				await this.createIndexes();
			}

			// Recover stale jobs if enabled
			if (this.options.recoverStaleJobs) {
				await this.recoverStaleJobs();
			}

			// Check for instance ID collisions (after stale recovery to avoid false positives)
			await this.checkInstanceCollision();

			// Initialize services with shared context
			const ctx = this.buildContext();
			this._scheduler = new JobScheduler(ctx);
			this._manager = new JobManager(ctx);
			this._query = new JobQueryService(ctx);
			this._processor = new JobProcessor(ctx);
			this._changeStreamHandler = new ChangeStreamHandler(ctx, () => this.processor.poll());
			this._lifecycleManager = new LifecycleManager(ctx);

			this.isInitialized = true;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown error during initialization';
			throw new ConnectionError(`Failed to initialize Monque: ${message}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Service Accessors (throw if not initialized)
	// ─────────────────────────────────────────────────────────────────────────────

	/** @throws {ConnectionError} if not initialized */
	private get scheduler(): JobScheduler {
		if (!this._scheduler) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}

		return this._scheduler;
	}

	/** @throws {ConnectionError} if not initialized */
	private get manager(): JobManager {
		if (!this._manager) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}

		return this._manager;
	}

	/** @throws {ConnectionError} if not initialized */
	private get query(): JobQueryService {
		if (!this._query) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}

		return this._query;
	}

	/** @throws {ConnectionError} if not initialized */
	private get processor(): JobProcessor {
		if (!this._processor) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}

		return this._processor;
	}

	/** @throws {ConnectionError} if not initialized */
	private get changeStreamHandler(): ChangeStreamHandler {
		if (!this._changeStreamHandler) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}

		return this._changeStreamHandler;
	}

	/** @throws {ConnectionError} if not initialized */
	private get lifecycleManager(): LifecycleManager {
		if (!this._lifecycleManager) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}

		return this._lifecycleManager;
	}

	/**
	 * Build the shared context for internal services.
	 */
	private buildContext(): SchedulerContext {
		if (!this.collection) {
			throw new ConnectionError('Collection not initialized');
		}

		return {
			collection: this.collection,
			options: this.options,
			instanceId: this.options.schedulerInstanceId,
			workers: this.workers,
			isRunning: () => this.isRunning,
			emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) =>
				this.emit(event, payload),
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
	 * - `{claimedBy, status}` - For finding jobs owned by a specific scheduler instance
	 * - `{lastHeartbeat, status}` - For monitoring/debugging queries (e.g., inspecting heartbeat age)
	 * - `{status, nextRunAt, claimedBy}` - For atomic claim queries (find unclaimed pending jobs)
	 * - `{lockedAt, lastHeartbeat, status}` - Supports recovery scans and monitoring access patterns
	 */
	private async createIndexes(): Promise<void> {
		if (!this.collection) {
			throw new ConnectionError('Collection not initialized');
		}

		await this.collection.createIndexes([
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
			// Compound index for finding jobs claimed by a specific scheduler instance.
			// Used for heartbeat updates and cleanup on shutdown.
			{ key: { claimedBy: 1, status: 1 }, background: true },
			// Compound index for monitoring/debugging via heartbeat timestamps.
			// Note: stale recovery uses lockedAt + lockTimeout as the source of truth.
			{ key: { lastHeartbeat: 1, status: 1 }, background: true },
			// Compound index for atomic claim queries.
			// Optimizes the findOneAndUpdate query that claims unclaimed pending jobs.
			{ key: { status: 1, nextRunAt: 1, claimedBy: 1 }, background: true },
			// Expanded index that supports recovery scans (status + lockedAt) plus heartbeat monitoring patterns.
			{ key: { status: 1, lockedAt: 1, lastHeartbeat: 1 }, background: true },
		]);
	}

	/**
	 * Recover stale jobs that were left in 'processing' status.
	 * A job is considered stale if its `lockedAt` timestamp exceeds the configured `lockTimeout`.
	 * Stale jobs are reset to 'pending' so they can be picked up by workers again.
	 */
	private async recoverStaleJobs(): Promise<void> {
		if (!this.collection) {
			return;
		}

		const staleThreshold = new Date(Date.now() - this.options.lockTimeout);

		const result = await this.collection.updateMany(
			{
				status: JobStatus.PROCESSING,
				lockedAt: { $lt: staleThreshold },
			},
			{
				$set: {
					status: JobStatus.PENDING,
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

		if (result.modifiedCount > 0) {
			// Emit event for recovered jobs
			this.emit('stale:recovered', {
				count: result.modifiedCount,
			});
		}
	}

	/**
	 * Check if another active instance is using the same schedulerInstanceId.
	 * Uses heartbeat staleness to distinguish active instances from crashed ones.
	 *
	 * Called after stale recovery to avoid false positives: stale recovery resets
	 * jobs with old `lockedAt`, so only jobs with recent heartbeats remain.
	 *
	 * @throws {ConnectionError} If an active instance with the same ID is detected
	 */
	private async checkInstanceCollision(): Promise<void> {
		if (!this.collection) {
			return;
		}

		// Look for any job currently claimed by this instance ID
		// that has a recent heartbeat (within 2× heartbeat interval = "alive" threshold)
		const aliveThreshold = new Date(Date.now() - this.options.heartbeatInterval * 2);

		const activeJob = await this.collection.findOne({
			claimedBy: this.options.schedulerInstanceId,
			status: JobStatus.PROCESSING,
			lastHeartbeat: { $gte: aliveThreshold },
		});

		if (activeJob) {
			throw new ConnectionError(
				`Another active Monque instance is using schedulerInstanceId "${this.options.schedulerInstanceId}". ` +
					`Found processing job "${activeJob['name']}" with recent heartbeat. ` +
					`Use a unique schedulerInstanceId or wait for the other instance to stop.`,
			);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Public API - Job Scheduling (delegates to JobScheduler)
	// ─────────────────────────────────────────────────────────────────────────────

	/** {@inheritDoc JobScheduler.enqueue} */
	async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
		this.ensureInitialized();
		return this.scheduler.enqueue(name, data, options);
	}

	/** {@inheritDoc JobScheduler.now} */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		this.ensureInitialized();
		return this.scheduler.now(name, data);
	}

	/** {@inheritDoc JobScheduler.schedule} */
	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options: ScheduleOptions = {},
	): Promise<PersistedJob<T>> {
		this.ensureInitialized();
		return this.scheduler.schedule(cron, name, data, options);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Public API - Job Management (delegates to JobManager)
	// ─────────────────────────────────────────────────────────────────────────────

	/** {@inheritDoc JobManager.cancelJob} */
	async cancelJob(jobId: string): Promise<PersistedJob<unknown> | null> {
		this.ensureInitialized();
		return this.manager.cancelJob(jobId);
	}

	/** {@inheritDoc JobManager.retryJob} */
	async retryJob(jobId: string): Promise<PersistedJob<unknown> | null> {
		this.ensureInitialized();
		return this.manager.retryJob(jobId);
	}

	/** {@inheritDoc JobManager.rescheduleJob} */
	async rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null> {
		this.ensureInitialized();
		return this.manager.rescheduleJob(jobId, runAt);
	}

	/** {@inheritDoc JobManager.deleteJob} */
	async deleteJob(jobId: string): Promise<boolean> {
		this.ensureInitialized();
		return this.manager.deleteJob(jobId);
	}

	/** {@inheritDoc JobManager.cancelJobs} */
	async cancelJobs(filter: JobSelector): Promise<BulkOperationResult> {
		this.ensureInitialized();
		return this.manager.cancelJobs(filter);
	}

	/** {@inheritDoc JobManager.retryJobs} */
	async retryJobs(filter: JobSelector): Promise<BulkOperationResult> {
		this.ensureInitialized();
		return this.manager.retryJobs(filter);
	}

	/** {@inheritDoc JobManager.deleteJobs} */
	async deleteJobs(filter: JobSelector): Promise<BulkOperationResult> {
		this.ensureInitialized();
		return this.manager.deleteJobs(filter);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Public API - Job Queries (delegates to JobQueryService)
	// ─────────────────────────────────────────────────────────────────────────────

	/** {@inheritDoc JobQueryService.getJob} */
	async getJob<T = unknown>(id: ObjectId): Promise<PersistedJob<T> | null> {
		this.ensureInitialized();
		return this.query.getJob<T>(id);
	}

	/** {@inheritDoc JobQueryService.getJobs} */
	async getJobs<T = unknown>(filter: GetJobsFilter = {}): Promise<PersistedJob<T>[]> {
		this.ensureInitialized();
		return this.query.getJobs<T>(filter);
	}

	/** {@inheritDoc JobQueryService.getJobsWithCursor} */
	async getJobsWithCursor<T = unknown>(options: CursorOptions = {}): Promise<CursorPage<T>> {
		this.ensureInitialized();
		return this.query.getJobsWithCursor<T>(options);
	}

	/** {@inheritDoc JobQueryService.getQueueStats} */
	async getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats> {
		this.ensureInitialized();
		return this.query.getQueueStats(filter);
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
	register<T>(name: string, handler: JobHandler<T>, options: WorkerOptions = {}): void {
		const concurrency = options.concurrency ?? this.options.workerConcurrency;

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
			activeJobs: new Map(),
		});
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Public API - Lifecycle
	// ─────────────────────────────────────────────────────────────────────────────

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
		if (this.isRunning) {
			return;
		}

		if (!this.isInitialized) {
			throw new ConnectionError('Monque not initialized. Call initialize() before start().');
		}

		this.isRunning = true;

		// Set up change streams as the primary notification mechanism
		this.changeStreamHandler.setup();

		// Delegate timer management to LifecycleManager
		this.lifecycleManager.startTimers({
			poll: () => this.processor.poll(),
			updateHeartbeats: () => this.processor.updateHeartbeats(),
		});
	}

	/**
	 * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
	 *
	 * Stops polling for new jobs and waits for all active jobs to finish processing.
	 * Times out after the configured `shutdownTimeout` (default: 30 seconds), emitting
	 * a `job:error` event with a `ShutdownTimeoutError` containing incomplete jobs.
	 * On timeout, jobs still in progress are left as `processing` for stale job recovery.
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
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		// Clear stats cache for clean state on restart
		this._query?.clearStatsCache();

		// Close change stream
		await this.changeStreamHandler.close();

		// Stop all lifecycle timers
		this.lifecycleManager.stopTimers();

		// Wait for all active jobs to complete (with timeout)
		const activeJobs = this.getActiveJobs();
		if (activeJobs.length === 0) {
			return;
		}

		// Create a promise that resolves when all jobs are done
		let checkInterval: ReturnType<typeof setInterval> | undefined;
		const waitForJobs = new Promise<undefined>((resolve) => {
			checkInterval = setInterval(() => {
				if (this.getActiveJobs().length === 0) {
					clearInterval(checkInterval);
					resolve(undefined);
				}
			}, 100);
		});

		// Race between job completion and timeout
		const timeout = new Promise<'timeout'>((resolve) => {
			setTimeout(() => resolve('timeout'), this.options.shutdownTimeout);
		});

		let result: undefined | 'timeout';

		try {
			result = await Promise.race([waitForJobs, timeout]);
		} finally {
			if (checkInterval) {
				clearInterval(checkInterval);
			}
		}

		if (result === 'timeout') {
			const incompleteJobs = this.getActiveJobsList();

			const error = new ShutdownTimeoutError(
				`Shutdown timed out after ${this.options.shutdownTimeout}ms with ${incompleteJobs.length} incomplete jobs`,
				incompleteJobs,
			);
			this.emit('job:error', { error });
		}
	}

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
		return this.isRunning && this.isInitialized && this.collection !== null;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Private Helpers
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Ensure the scheduler is initialized before operations.
	 *
	 * @private
	 * @throws {ConnectionError} If scheduler not initialized or collection unavailable
	 */
	private ensureInitialized(): void {
		if (!this.isInitialized || !this.collection) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}
	}

	/**
	 * Get array of active job IDs across all workers.
	 *
	 * @private
	 * @returns Array of job ID strings currently being processed
	 */
	private getActiveJobs(): string[] {
		const activeJobs: string[] = [];
		for (const worker of this.workers.values()) {
			activeJobs.push(...worker.activeJobs.keys());
		}
		return activeJobs;
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
