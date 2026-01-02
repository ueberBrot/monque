import type { JobHandler, PersistedJob } from '@/jobs/types.js';

/**
 * Options for registering a worker.
 *
 * @example
 * ```typescript
 * monque.worker('send-email', emailHandler, {
 *   concurrency: 3,
 * });
 * ```
 */
export interface WorkerOptions {
	/**
	 * Number of concurrent jobs this worker can process.
	 * @default 5 (uses defaultConcurrency from MonqueOptions)
	 */
	concurrency?: number;

	/**
	 * Allow replacing an existing worker for the same job name.
	 * If false (default) and a worker already exists, throws WorkerRegistrationError.
	 * @default false
	 */
	replace?: boolean;
}

/**
 * Internal worker registration with handler and options.
 * Tracks the handler, concurrency limit, and currently active jobs.
 */
export interface WorkerRegistration<T = unknown> {
	/** The job handler function */
	handler: JobHandler<T>;
	/** Maximum concurrent jobs for this worker */
	concurrency: number;
	/** Map of active job IDs to their job data */
	activeJobs: Map<string, PersistedJob<T>>;
}
