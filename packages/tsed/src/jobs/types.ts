import type { EnqueueOptions } from '@monque/core';

/**
 * Options for the `@JobController` class decorator.
 */
export interface JobControllerOptions {
	/**
	 * Optional namespace prefix for all jobs in this controller.
	 *
	 * When set, job names are prefixed with `{namespace}.{jobName}`.
	 * This helps organize jobs by feature or domain.
	 *
	 * @example
	 * ```typescript
	 * @JobController({ namespace: 'email' })
	 * class EmailJobs {
	 *   @Job('send-welcome')  // Registered as 'email.send-welcome'
	 *   async sendWelcome(data: WelcomeData) { ... }
	 * }
	 * ```
	 */
	namespace?: string;
}

/**
 * Options for the `@Job` method decorator.
 */
export interface MethodJobOptions extends Partial<EnqueueOptions> {
	/**
	 * Maximum number of concurrent executions for this job type.
	 *
	 * Limits how many instances of this job can run simultaneously per scheduler.
	 * Useful for resource-intensive jobs like video processing or API calls
	 * with rate limits.
	 *
	 * @default 5 (inherited from MonqueOptions.defaultConcurrency)
	 */
	concurrency?: number;
}

/**
 * Options for the `@Cron` method decorator.
 */
export interface CronOptions extends MethodJobOptions {
	/**
	 * Unique key for deduplication.
	 * By default, cron jobs use `{controller}.{method}` as the unique key
	 * to prevent duplicate scheduled jobs across restarts.
	 */
	uniqueKey?: string;
}

/**
 * Metadata structure stored on controller methods.
 * @internal
 */
export interface MethodJobMetadata {
	name: string;
	options?: MethodJobOptions | undefined;
}

/**
 * Metadata structure stored on controller methods for cron jobs.
 * @internal
 */
export interface CronJobMetadata {
	expression: string;
	name?: string | undefined;
	options?: CronOptions | undefined;
}

/**
 * Complete metadata store for a controller class.
 * @internal
 */
export interface ControllerStore {
	namespace?: string | undefined;
	jobs?: Record<string, MethodJobMetadata> | undefined;
	cron?: Record<string, CronJobMetadata> | undefined;
}
