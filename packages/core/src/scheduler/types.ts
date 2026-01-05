/**
 * Configuration options for the Monque scheduler.
 *
 * @example
 * ```typescript
 * const monque = new Monque(db, {
 *   collectionName: 'jobs',
 *   pollInterval: 1000,
 *   maxRetries: 10,
 *   baseRetryInterval: 1000,
 *   shutdownTimeout: 30000,
 *   defaultConcurrency: 5,
 * });
 * ```
 */
export interface MonqueOptions {
	/**
	 * Name of the MongoDB collection for storing jobs.
	 * @default 'monque_jobs'
	 */
	collectionName?: string;

	/**
	 * Interval in milliseconds between polling for new jobs.
	 * @default 1000
	 */
	pollInterval?: number;

	/**
	 * Maximum number of retry attempts before marking a job as permanently failed.
	 * @default 10
	 */
	maxRetries?: number;

	/**
	 * Base interval in milliseconds for exponential backoff calculation.
	 * Actual delay = 2^failCount * baseRetryInterval
	 * @default 1000
	 */
	baseRetryInterval?: number;

	/**
	 * Maximum delay in milliseconds for exponential backoff.
	 * If calculated delay exceeds this value, it will be capped.
	 * @default undefined (no cap)
	 */
	maxBackoffDelay?: number | undefined;

	/**
	 * Timeout in milliseconds for graceful shutdown.
	 * @default 30000
	 */
	shutdownTimeout?: number;

	/**
	 * Default number of concurrent jobs per worker.
	 * @default 5
	 */
	defaultConcurrency?: number;

	/**
	 * Maximum time in milliseconds a job can be in 'processing' status before
	 * being considered stale and eligible for re-acquisition by other workers.
	 * When using heartbeat-based detection, this should be at least 2-3x the heartbeatInterval.
	 * @default 1800000 (30 minutes)
	 */
	lockTimeout?: number;

	/**
	 * Unique identifier for this scheduler instance.
	 * Used for atomic job claiming - each instance uses this ID to claim jobs.
	 * Defaults to a randomly generated UUID v4.
	 * @default crypto.randomUUID()
	 */
	schedulerInstanceId?: string;

	/**
	 * Interval in milliseconds for heartbeat updates during job processing.
	 * The scheduler periodically updates lastHeartbeat for all jobs it is processing
	 * to indicate liveness. Other instances use this to detect stale jobs.
	 * @default 30000 (30 seconds)
	 */
	heartbeatInterval?: number;

	/**
	 * Whether to recover stale processing jobs on scheduler startup.
	 * When true, jobs with lockedAt older than lockTimeout will be reset to pending.
	 * @default true
	 */
	recoverStaleJobs?: boolean;

	/**
	 * Configuration for automatic cleanup of completed and failed jobs.
	 * If undefined, no cleanup is performed.
	 */
	jobRetention?:
		| {
				/**
				 * Age in milliseconds after which completed jobs are deleted.
				 * Cleaned up based on 'updatedAt' timestamp.
				 */
				completed?: number;

				/**
				 * Age in milliseconds after which failed jobs are deleted.
				 * Cleaned up based on 'updatedAt' timestamp.
				 */
				failed?: number;

				/**
				 * Interval in milliseconds for running the cleanup job.
				 * @default 3600000 (1 hour)
				 */
				interval?: number;
		  }
		| undefined;
}
