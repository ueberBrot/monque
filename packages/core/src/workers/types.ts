import type { JobHandler, PersistedJob } from '@/jobs';
import type { MonqueOptions } from '@/scheduler/types';

export type RetryOptions = Pick<
	MonqueOptions,
	'maxRetries' | 'baseRetryInterval' | 'maxBackoffDelay'
>;

/**
 * Options for registering a worker. Retry options override scheduler defaults
 * for this job name; omitted values inherit those defaults.
 *
 * @example
 * ```typescript
 * monque.register('send-email', emailHandler, {
 *   concurrency: 3,
 * });
 * ```
 */
export interface WorkerOptions extends RetryOptions {
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
	/** Retry settings captured when this worker was registered */
	retryOptions?: RetryOptions;
	/** Map of active claim IDs to their job data */
	activeJobs: Map<string, PersistedJob<T>>;
}
