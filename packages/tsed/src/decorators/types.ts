/**
 * @monque/tsed - Decorator Types
 */

import type { WorkerOptions as CoreWorkerOptions, ScheduleOptions } from '@monque/core';

// ─────────────────────────────────────────────────────────────────────────────
// Job Decorator Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Job method decorator.
 *
 * Maps to @monque/core WorkerOptions. All standard Monque worker options
 * are exposed here for decorator-based configuration.
 */
export interface JobDecoratorOptions extends CoreWorkerOptions {}

// ─────────────────────────────────────────────────────────────────────────────
// Job Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single @Job decorated method.
 *
 * Stored in the JobStore and used by MonqueModule to register workers.
 */
export interface JobMetadata {
	/**
	 * Job name (without namespace prefix).
	 * Combined with controller namespace to form full job name.
	 */
	name: string;

	/**
	 * Method name on the controller class.
	 */
	method: string;

	/**
	 * Job options forwarded to Monque.register().
	 */
	opts: JobDecoratorOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Decorator Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Cron method decorator.
 *
 * Maps to @monque/core ScheduleOptions with additional metadata overrides.
 */
export interface CronDecoratorOptions extends ScheduleOptions {
	/**
	 * Override job name (defaults to method name).
	 */
	name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single @Cron decorated method.
 *
 * Stored in the JobStore and used by MonqueModule to schedule cron jobs.
 */
export interface CronMetadata {
	/**
	 * Cron expression (5-field standard or predefined like @daily).
	 */
	pattern: string;

	/**
	 * Job name (defaults to method name if not specified in options).
	 */
	name: string;

	/**
	 * Method name on the controller class.
	 */
	method: string;

	/**
	 * Schedule options forwarded to Monque.schedule().
	 */
	opts: CronDecoratorOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete metadata structure stored on @JobController classes.
 *
 * Accessed via `Store.from(Class).get(MONQUE)`.
 *
 * @example
 * ```typescript
 * const store = Store.from(EmailJobs).get<JobStore>(MONQUE);
 * console.log(store.namespace); // "email"
 * console.log(store.jobs); // [{ name: "send", method: "sendEmail", opts: {} }]
 * ```
 */
export interface JobStore {
	/**
	 * Type identifier for the store.
	 * Always "controller" for JobController.
	 */
	type: 'controller';

	/**
	 * Optional namespace prefix for all jobs in this controller.
	 * When set, job names become "{namespace}.{name}".
	 */
	namespace?: string;

	/**
	 * Job method registrations from @Job decorators.
	 */
	jobs: JobMetadata[];

	/**
	 * Cron job registrations from @Cron decorators.
	 */
	cronJobs: CronMetadata[];
}
