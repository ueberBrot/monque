import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Collection, Db, Document, WithId } from 'mongodb';

import { ConnectionError, WorkerRegistrationError } from '@/errors.js';
import type {
	EnqueueOptions,
	Job,
	JobHandler,
	JobStatusType,
	MonqueEventMap,
	MonqueOptions,
	MonquePublicAPI,
	PersistedJob,
	ScheduleOptions,
	WorkerOptions,
} from '@/types.js';
import { JobStatus } from '@/types.js';
import { calculateBackoff } from '@/utils/backoff.js';
import { getNextCronDate } from '@/utils/cron.js';

/**
 * Default configuration values
 */
const DEFAULTS = {
	collectionName: 'monque_jobs',
	pollInterval: 1000,
	maxRetries: 10,
	baseRetryInterval: 1000,
	shutdownTimeout: 30000,
	defaultConcurrency: 5,
	lockTimeout: 30000, // 30 seconds (aligned with heartbeat timing)
	recoverStaleJobs: true,
	heartbeatInterval: 5000, // 5 seconds
} as const;

/**
 * Internal worker registration with handler and options
 */
interface WorkerRegistration<T = unknown> {
	handler: JobHandler<T>;
	concurrency: number;
	activeJobs: Map<string, PersistedJob<T>>; // Track active jobs
}

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
 * interface EmailJob {
 *   to: string;
 *   subject: string;
 *   body: string;
 * }
 *
 * monque.worker<EmailJob>('send-email', async (job) => {
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
export class Monque extends EventEmitter implements MonquePublicAPI {
	private readonly db: Db;
	private readonly options: Required<Omit<MonqueOptions, 'maxBackoffDelay'>> &
		Pick<MonqueOptions, 'maxBackoffDelay'>;
	private collection: Collection<Document> | null = null;
	private workers: Map<string, WorkerRegistration> = new Map();
	private pollIntervalId: ReturnType<typeof setInterval> | null = null;
	private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
	private isRunning = false;
	private isInitialized = false;

	constructor(db: Db, options: MonqueOptions = {}) {
		super();
		this.db = db;
		this.options = {
			collectionName: options.collectionName ?? DEFAULTS.collectionName,
			pollInterval: options.pollInterval ?? DEFAULTS.pollInterval,
			maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
			baseRetryInterval: options.baseRetryInterval ?? DEFAULTS.baseRetryInterval,
			shutdownTimeout: options.shutdownTimeout ?? DEFAULTS.shutdownTimeout,
			defaultConcurrency: options.defaultConcurrency ?? DEFAULTS.defaultConcurrency,
			lockTimeout: options.lockTimeout ?? DEFAULTS.lockTimeout,
			recoverStaleJobs: options.recoverStaleJobs ?? DEFAULTS.recoverStaleJobs,
			maxBackoffDelay: options.maxBackoffDelay,
			schedulerInstanceId: options.schedulerInstanceId ?? crypto.randomUUID(),
			heartbeatInterval: options.heartbeatInterval ?? DEFAULTS.heartbeatInterval,
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

			// Create indexes for efficient queries
			await this.createIndexes();

			// Recover stale jobs if enabled
			if (this.options.recoverStaleJobs) {
				await this.recoverStaleJobs();
			}

			this.isInitialized = true;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown error during initialization';
			throw new ConnectionError(`Failed to initialize Monque: ${message}`);
		}
	}

	/**
	 * Create required MongoDB indexes for efficient job processing.
	 *
	 * The following indexes are created:
	 * - `{status, nextRunAt}` - For efficient job polling queries
	 * - `{name, uniqueKey}` - Partial unique index for deduplication (pending/processing only)
	 * - `{name, status}` - For job lookup by type
	 * - `{claimedBy, status}` - For finding jobs owned by a specific scheduler instance
	 * - `{lastHeartbeat, status}` - For detecting stale jobs via heartbeat timeout
	 * - `{status, nextRunAt, claimedBy}` - For atomic claim queries (find unclaimed pending jobs)
	 * - `{lockedAt, lastHeartbeat, status}` - For stale job recovery combining lock time and heartbeat
	 */
	private async createIndexes(): Promise<void> {
		if (!this.collection) {
			throw new ConnectionError('Collection not initialized');
		}

		// Compound index for job polling - status + nextRunAt for efficient queries
		await this.collection.createIndex({ status: 1, nextRunAt: 1 }, { background: true });

		// Partial unique index for deduplication - scoped by name + uniqueKey
		// Only enforced where uniqueKey exists and status is pending/processing
		await this.collection.createIndex(
			{ name: 1, uniqueKey: 1 },
			{
				unique: true,
				partialFilterExpression: {
					uniqueKey: { $exists: true },
					status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
				},
				background: true,
			},
		);

		// Index for job lookup by name
		await this.collection.createIndex({ name: 1, status: 1 }, { background: true });

		// Compound index for finding jobs claimed by a specific scheduler instance.
		// Used for heartbeat updates and cleanup on shutdown.
		await this.collection.createIndex({ claimedBy: 1, status: 1 }, { background: true });

		// Compound index for detecting stale jobs via heartbeat timeout.
		// Used to find processing jobs that have stopped sending heartbeats.
		await this.collection.createIndex({ lastHeartbeat: 1, status: 1 }, { background: true });

		// Compound index for atomic claim queries.
		// Optimizes the findOneAndUpdate query that claims unclaimed pending jobs.
		await this.collection.createIndex(
			{ status: 1, nextRunAt: 1, claimedBy: 1 },
			{ background: true },
		);

		// Expanded index for stale job recovery combining lock time and heartbeat.
		// Supports recovery queries that check both lockedAt and lastHeartbeat.
		await this.collection.createIndex(
			{ lockedAt: 1, lastHeartbeat: 1, status: 1 },
			{ background: true },
		);
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
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
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
	 */
	async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
		this.ensureInitialized();

		const now = new Date();
		const job: Omit<Job<T>, '_id'> = {
			name,
			data,
			status: JobStatus.PENDING,
			nextRunAt: options.runAt ?? now,
			failCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		if (options.uniqueKey) {
			job.uniqueKey = options.uniqueKey;
		}

		try {
			if (options.uniqueKey) {
				if (!this.collection) {
					throw new ConnectionError('Failed to enqueue job: collection not available');
				}

				// Use upsert with $setOnInsert for deduplication (scoped by name + uniqueKey)
				const result = await this.collection.findOneAndUpdate(
					{
						name,
						uniqueKey: options.uniqueKey,
						status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
					},
					{
						$setOnInsert: job,
					},
					{
						upsert: true,
						returnDocument: 'after',
					},
				);

				if (!result) {
					throw new ConnectionError('Failed to enqueue job: findOneAndUpdate returned no document');
				}

				return this.documentToPersistedJob<T>(result as WithId<Document>);
			}

			const result = await this.collection?.insertOne(job as Document);

			if (!result) {
				throw new ConnectionError('Failed to enqueue job: collection not available');
			}

			return { ...job, _id: result.insertedId } as PersistedJob<T>;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error during enqueue';

			throw new ConnectionError(`Failed to enqueue job: ${message}`);
		}
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
	 */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		return this.enqueue(name, data, { runAt: new Date() });
	}

	/**
	 * Schedule a recurring job with a cron expression.
	 *
	 * Creates a job that automatically re-schedules itself based on the cron pattern.
	 * Uses standard 5-field cron format: minute, hour, day of month, month, day of week.
	 * Also supports predefined expressions like `@daily`, `@weekly`, `@monthly`, etc.
	 * After successful completion, the job is reset to `pending` status and scheduled
	 * for its next run based on the cron expression.
	 *
	 * When a `uniqueKey` is provided, only one pending or processing job with that key
	 * can exist. This prevents duplicate scheduled jobs on application restart.
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param cron - Cron expression (5 fields or predefined expression)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler on each run
	 * @param options - Scheduling options (uniqueKey for deduplication)
	 * @returns Promise resolving to the created job document with `repeatInterval` set
	 * @throws {InvalidCronError} If cron expression is invalid
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
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
	 */
	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options: ScheduleOptions = {},
	): Promise<PersistedJob<T>> {
		this.ensureInitialized();

		// Validate cron and get next run date (throws InvalidCronError if invalid)
		const nextRunAt = getNextCronDate(cron);

		const now = new Date();
		const job: Omit<Job<T>, '_id'> = {
			name,
			data,
			status: JobStatus.PENDING,
			nextRunAt,
			repeatInterval: cron,
			failCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		if (options.uniqueKey) {
			job.uniqueKey = options.uniqueKey;
		}

		try {
			if (options.uniqueKey) {
				if (!this.collection) {
					throw new ConnectionError('Failed to schedule job: collection not available');
				}

				// Use upsert with $setOnInsert for deduplication (scoped by name + uniqueKey)
				const result = await this.collection.findOneAndUpdate(
					{
						name,
						uniqueKey: options.uniqueKey,
						status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
					},
					{
						$setOnInsert: job,
					},
					{
						upsert: true,
						returnDocument: 'after',
					},
				);

				if (!result) {
					throw new ConnectionError(
						'Failed to schedule job: findOneAndUpdate returned no document',
					);
				}

				return this.documentToPersistedJob<T>(result as WithId<Document>);
			}

			const result = await this.collection?.insertOne(job as Document);

			if (!result) {
				throw new ConnectionError('Failed to schedule job: collection not available');
			}

			return { ...job, _id: result.insertedId } as PersistedJob<T>;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error during schedule';
			throw new ConnectionError(`Failed to schedule job: ${message}`);
		}
	}

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
	 * monque.worker<EmailJob>('send-email', async (job) => {
	 *   await emailService.send(job.data.to, job.data.subject, job.data.body);
	 * });
	 * ```
	 *
	 * @example Worker with custom concurrency
	 * ```typescript
	 * // Limit to 2 concurrent video processing jobs (resource-intensive)
	 * monque.worker('process-video', async (job) => {
	 *   await videoProcessor.transcode(job.data.videoId);
	 * }, { concurrency: 2 });
	 * ```
	 *
	 * @example Replacing an existing worker
	 * ```typescript
	 * // Replace the existing handler for 'send-email'
	 * monque.worker('send-email', newEmailHandler, { replace: true });
	 * ```
	 *
	 * @example Worker with error handling
	 * ```typescript
	 * monque.worker('sync-user', async (job) => {
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
	worker<T>(name: string, handler: JobHandler<T>, options: WorkerOptions = {}): void {
		const concurrency = options.concurrency ?? this.options.defaultConcurrency;

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
	 * monque.worker('send-email', emailHandler);
	 * monque.worker('process-order', orderHandler);
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
		this.pollIntervalId = setInterval(() => {
			this.poll().catch((error: unknown) => {
				this.emit('job:error', { error: error as Error });
			});
		}, this.options.pollInterval);

		// Start heartbeat interval for claimed jobs
		this.heartbeatIntervalId = setInterval(() => {
			this.updateHeartbeats().catch((error: unknown) => {
				this.emit('job:error', { error: error as Error });
			});
		}, this.options.heartbeatInterval);

		// Run initial poll immediately
		this.poll().catch((error: unknown) => {
			this.emit('job:error', { error: error as Error });
		});
	}

	/**
	 * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
	 *
	 * Stops polling for new jobs and waits for all active jobs to finish processing.
	 * Times out after the configured `shutdownTimeout` (default: 30 seconds), emitting
	 * a `job:error` event with a `ShutdownTimeoutError` containing incomplete jobs.
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

		// Clear polling interval
		if (this.pollIntervalId) {
			clearInterval(this.pollIntervalId);
			this.pollIntervalId = null;
		}

		// Clear heartbeat interval
		if (this.heartbeatIntervalId) {
			clearInterval(this.heartbeatIntervalId);
			this.heartbeatIntervalId = null;
		}

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
			const { ShutdownTimeoutError } = await import('./errors.js');
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

	/**
	 * Poll for available jobs and process them.
	 *
	 * Called at regular intervals (configured by `pollInterval`). For each registered worker,
	 * attempts to acquire jobs up to the worker's available concurrency slots.
	 *
	 * @private
	 */
	private async poll(): Promise<void> {
		if (!this.isRunning || !this.collection) {
			return;
		}

		for (const [name, worker] of this.workers) {
			// Check if worker has capacity
			const availableSlots = worker.concurrency - worker.activeJobs.size;

			if (availableSlots <= 0) {
				continue;
			}

			// Try to acquire jobs up to available slots
			for (let i = 0; i < availableSlots; i++) {
				const job = await this.acquireJob(name);

				if (job) {
					this.processJob(job, worker).catch((error: unknown) => {
						this.emit('job:error', { error: error as Error, job });
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
	 * @private
	 * @param name - The job type to acquire
	 * @returns The acquired job with updated status, claimedBy, and heartbeat info, or `null` if no jobs available
	 */
	private async acquireJob(name: string): Promise<PersistedJob | null> {
		if (!this.collection) {
			return null;
		}

		const now = new Date();

		const result = await this.collection.findOneAndUpdate(
			{
				name,
				status: JobStatus.PENDING,
				nextRunAt: { $lte: now },
				$or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
			},
			{
				$set: {
					status: JobStatus.PROCESSING,
					claimedBy: this.options.schedulerInstanceId,
					lockedAt: now,
					lastHeartbeat: now,
					heartbeatInterval: this.options.heartbeatInterval,
					updatedAt: now,
				},
			},
			{
				sort: { nextRunAt: 1 },
				returnDocument: 'after',
			},
		);

		if (!result) {
			return null;
		}

		return this.documentToPersistedJob(result as WithId<Document>);
	}

	/**
	 * Execute a job using its registered worker handler.
	 *
	 * Tracks the job as active during processing, emits lifecycle events, and handles
	 * both success and failure cases. On success, calls `completeJob()`. On failure,
	 * calls `failJob()` which implements exponential backoff retry logic.
	 *
	 * @private
	 * @param job - The job to process
	 * @param worker - The worker registration containing the handler and active job tracking
	 */
	private async processJob(job: PersistedJob, worker: WorkerRegistration): Promise<void> {
		const jobId = job._id.toString();
		worker.activeJobs.set(jobId, job);

		const startTime = Date.now();
		this.emit('job:start', job);

		try {
			await worker.handler(job);

			// Job completed successfully
			const duration = Date.now() - startTime;
			await this.completeJob(job);
			this.emit('job:complete', { job, duration });
		} catch (error) {
			// Job failed
			const err = error instanceof Error ? error : new Error(String(error));
			await this.failJob(job, err);

			const willRetry = job.failCount + 1 < this.options.maxRetries;
			this.emit('job:fail', { job, error: err, willRetry });
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
	 * @private
	 * @param job - The job that completed successfully
	 */
	private async completeJob(job: Job): Promise<void> {
		if (!this.collection || !job._id) {
			return;
		}

		if (job.repeatInterval) {
			// Recurring job - schedule next run
			const nextRunAt = getNextCronDate(job.repeatInterval);
			await this.collection.updateOne(
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
			await this.collection.updateOne(
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
	 * @private
	 * @param job - The job that failed
	 * @param error - The error that caused the failure
	 */
	private async failJob(job: Job, error: Error): Promise<void> {
		if (!this.collection || !job._id) {
			return;
		}

		const newFailCount = job.failCount + 1;

		if (newFailCount >= this.options.maxRetries) {
			// Permanent failure
			await this.collection.updateOne(
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
				this.options.baseRetryInterval,
				this.options.maxBackoffDelay,
			);

			await this.collection.updateOne(
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
	 * Update heartbeats for all jobs claimed by this scheduler instance.
	 *
	 * This method runs periodically while the scheduler is running to indicate
	 * that jobs are still being actively processed. Other instances use the
	 * lastHeartbeat timestamp to detect stale jobs from crashed schedulers.
	 *
	 * @private
	 */
	private async updateHeartbeats(): Promise<void> {
		if (!this.collection || !this.isRunning) {
			return;
		}

		const now = new Date();

		await this.collection.updateMany(
			{
				claimedBy: this.options.schedulerInstanceId,
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
	 * Convert a MongoDB document to a typed PersistedJob object.
	 *
	 * Maps raw MongoDB document fields to the strongly-typed `PersistedJob<T>` interface,
	 * ensuring type safety and handling optional fields (`lockedAt`, `failReason`, etc.).
	 *
	 * @private
	 * @template T - The job data payload type
	 * @param doc - The raw MongoDB document with `_id`
	 * @returns A strongly-typed PersistedJob object with guaranteed `_id`
	 */
	private documentToPersistedJob<T>(doc: WithId<Document>): PersistedJob<T> {
		const job: PersistedJob<T> = {
			_id: doc._id,
			name: doc['name'] as string,
			data: doc['data'] as T,
			status: doc['status'] as JobStatusType,
			nextRunAt: doc['nextRunAt'] as Date,
			failCount: doc['failCount'] as number,
			createdAt: doc['createdAt'] as Date,
			updatedAt: doc['updatedAt'] as Date,
		};

		// Only set optional properties if they exist
		if (doc['lockedAt'] !== undefined) {
			job.lockedAt = doc['lockedAt'] as Date | null;
		}
		if (doc['claimedBy'] !== undefined) {
			job.claimedBy = doc['claimedBy'] as string | null;
		}
		if (doc['lastHeartbeat'] !== undefined) {
			job.lastHeartbeat = doc['lastHeartbeat'] as Date | null;
		}
		if (doc['heartbeatInterval'] !== undefined) {
			job.heartbeatInterval = doc['heartbeatInterval'] as number;
		}
		if (doc['failReason'] !== undefined) {
			job.failReason = doc['failReason'] as string;
		}
		if (doc['repeatInterval'] !== undefined) {
			job.repeatInterval = doc['repeatInterval'] as string;
		}
		if (doc['uniqueKey'] !== undefined) {
			job.uniqueKey = doc['uniqueKey'] as string;
		}

		return job;
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
