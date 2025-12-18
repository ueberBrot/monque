import { EventEmitter } from 'node:events';
import type { Collection, Db, Document, WithId } from 'mongodb';

import { ConnectionError } from '@/errors.js';
import type {
	EnqueueOptions,
	Job,
	JobHandler,
	JobStatusType,
	MonqueEventMap,
	MonqueOptions,
	MonquePublicAPI,
	PersistedJob,
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
	lockTimeout: 1800000, // 30 minutes
	recoverStaleJobs: true,
} as const;

/**
 * Internal worker registration with handler and options
 */
interface WorkerRegistration<T = unknown> {
	handler: JobHandler<T>;
	concurrency: number;
	activeJobs: Set<string>; // Track active job IDs
}

/**
 * Monque - MongoDB-backed job scheduler
 *
 * A job scheduler with atomic locking, exponential backoff, cron scheduling,
 * stale job recovery, and event-driven observability.
 *
 * @example
 * ```typescript
 * import { Monque } from '@monque/core';
 * import { MongoClient } from 'mongodb';
 *
 * const client = new MongoClient('mongodb://localhost:27017');
 * await client.connect();
 * const db = client.db('myapp');
 *
 * const monque = new Monque(db, {
 *   collectionName: 'jobs',
 *   pollInterval: 1000,
 * });
 *
 * // Register a worker
 * monque.worker('send-email', async (job) => {
 *   await sendEmail(job.data.to, job.data.subject);
 * });
 *
 * // Start processing
 * await monque.initialize();
 * monque.start();
 *
 * // Enqueue a job
 * await monque.enqueue('send-email', { to: 'user@example.com', subject: 'Hello' });
 * ```
 */
export class Monque extends EventEmitter implements MonquePublicAPI {
	private readonly db: Db;
	private readonly options: Required<Omit<MonqueOptions, 'maxBackoffDelay'>> &
		Pick<MonqueOptions, 'maxBackoffDelay'>;
	private collection: Collection<Document> | null = null;
	private workers: Map<string, WorkerRegistration> = new Map();
	private pollIntervalId: ReturnType<typeof setInterval> | null = null;
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
	 */
	private async createIndexes(): Promise<void> {
		if (!this.collection) {
			throw new ConnectionError('Collection not initialized');
		}

		// Compound index for job polling - status + nextRunAt for efficient queries
		await this.collection.createIndex({ status: 1, nextRunAt: 1 }, { background: true });

		// Partial unique index for deduplication - only where uniqueKey exists and status is pending/processing
		// Note: Cannot use both 'sparse' and 'partialFilterExpression' together
		await this.collection.createIndex(
			{ uniqueKey: 1 },
			{
				unique: true,
				partialFilterExpression: {
					uniqueKey: { $exists: true },
					status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
				},
				background: true,
			},
		);

		// Index for stale job recovery - lockedAt for timeout queries
		await this.collection.createIndex({ lockedAt: 1, status: 1 }, { background: true });

		// Index for job lookup by name
		await this.collection.createIndex({ name: 1, status: 1 }, { background: true });
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
					lockedAt: null,
					updatedAt: new Date(),
				},
			},
		);

		if (result.modifiedCount > 0) {
			// Emit event for recovered jobs (informational)
			this.emit('stale:recovered', {
				count: result.modifiedCount,
			});
		}
	}

	/**
	 * Enqueue a job for processing.
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

				// Use upsert with $setOnInsert for deduplication
				const result = await this.collection.findOneAndUpdate(
					{
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
	 * Enqueue a job for immediate processing (syntactic sugar).
	 */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		return this.enqueue(name, data, { runAt: new Date() });
	}

	/**
	 * Schedule a recurring job with a cron expression.
	 */
	async schedule<T>(cron: string, name: string, data: T): Promise<PersistedJob<T>> {
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

		try {
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
	 */
	worker<T>(name: string, handler: JobHandler<T>, options: WorkerOptions = {}): void {
		const concurrency = options.concurrency ?? this.options.defaultConcurrency;

		this.workers.set(name, {
			handler: handler as JobHandler,
			concurrency,
			activeJobs: new Set(),
		});
	}

	/**
	 * Start polling for and processing jobs.
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
			this.poll().catch((error) => {
				this.emit('job:error', { error });
			});
		}, this.options.pollInterval);

		// Run initial poll immediately
		this.poll().catch((error) => {
			this.emit('job:error', { error });
		});
	}

	/**
	 * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
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
	 */
	isHealthy(): boolean {
		return this.isRunning && this.isInitialized && this.collection !== null;
	}

	/**
	 * Poll for available jobs and process them.
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
					this.processJob(job, worker).catch((error) => {
						this.emit('job:error', { error, job });
					});
				} else {
					// No more jobs available for this worker
					break;
				}
			}
		}
	}

	/**
	 * Atomically acquire a pending job for processing.
	 * Uses MongoDB's `findOneAndUpdate` to ensure only one worker can claim a job.
	 * @param name - The job type to acquire
	 * @returns The acquired job, or null if no jobs are available
	 */
	private async acquireJob(name: string): Promise<Job | null> {
		if (!this.collection) {
			return null;
		}

		const now = new Date();

		const result = await this.collection.findOneAndUpdate(
			{
				name,
				status: JobStatus.PENDING,
				nextRunAt: { $lte: now },
			},
			{
				$set: {
					status: JobStatus.PROCESSING,
					lockedAt: now,
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
	 * Emits lifecycle events (`job:start`, `job:complete`, `job:fail`) during processing.
	 * @param job - The job to process
	 * @param worker - The worker registration containing the handler
	 */
	private async processJob(job: Job, worker: WorkerRegistration): Promise<void> {
		const jobId = job._id?.toString() ?? '';
		worker.activeJobs.add(jobId);

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
	 * For recurring jobs (with `repeatInterval`), schedules the next run instead of marking as completed.
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
						lockedAt: null,
						failCount: 0, // Reset fail count on successful completion
						updatedAt: new Date(),
					},
					$unset: {
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
						lockedAt: null,
						updatedAt: new Date(),
					},
					$unset: {
						failReason: '',
					},
				},
			);
		}
	}

	/**
	 * Handle job failure with exponential backoff retry logic.
	 * If max retries are exhausted, the job is marked as permanently failed.
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
						lockedAt: null,
						updatedAt: new Date(),
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
						lockedAt: null,
						updatedAt: new Date(),
					},
				},
			);
		}
	}

	/**
	 * Ensure the scheduler is initialized before operations.
	 */
	private ensureInitialized(): void {
		if (!this.isInitialized || !this.collection) {
			throw new ConnectionError('Monque not initialized. Call initialize() first.');
		}
	}

	/**
	 * Get count of active jobs across all workers.
	 */
	private getActiveJobs(): string[] {
		const activeJobs: string[] = [];
		for (const worker of this.workers.values()) {
			activeJobs.push(...worker.activeJobs);
		}
		return activeJobs;
	}

	/**
	 * Get list of active job documents (for shutdown timeout error).
	 */
	private getActiveJobsList(): Job[] {
		// Note: In a real implementation, we'd track the actual job objects.
		// For now, return empty as we only track job IDs.
		// The job IDs are tracked in worker.activeJobs but not the full job documents.
		// A more complete implementation would track the full job objects.
		return [];
	}

	/**
	 * Convert a MongoDB document to a typed PersistedJob object.
	 * @param doc - The raw MongoDB document
	 * @returns A strongly-typed PersistedJob object with guaranteed _id
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
